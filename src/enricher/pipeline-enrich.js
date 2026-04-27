'use strict';

const { parseEnrichExcel, buildCascadeIndex, matchField, collectComboOptions, isPdfLabelNoise } = require('./index-excel');
const { parseCatalogsFromBuffer } = require('../parsers/catalogs-parser');
const { loadClientPathsFromText, validateLovableJson } = require('../validators/prefillkey-validator');
const { applyType, applyReadOnly, applyRequired } = require('./apply-type');
const { applyValidations } = require('./apply-validations');
const { applyOptions } = require('./apply-options');
const { applyPrefill } = require('./apply-prefill');
const { applyConditionals, resolveTriggers } = require('./apply-conditionals');
const { regroupSections } = require('./regroup-sections');

async function runEnrichPipeline(inputs) {
    const {
        lovableJsonText,
        matrixBuffer,
        catalogsBuffer,
        clientJsonText,
    } = inputs;

    if (!lovableJsonText) throw new Error('Lovable JSON is required');
    if (!matrixBuffer) throw new Error('Excel matrix is required');

    const lovableJson = JSON.parse(lovableJsonText);
    const warnings = [];

    const excelRows = parseEnrichExcel(matrixBuffer);
    const index = buildCascadeIndex(excelRows);
    const catalogs = catalogsBuffer ? parseCatalogsFromBuffer(catalogsBuffer) : {};

    const isNewFormat = excelRows.length > 0 && excelRows[0]._isNewFormat;
    warnings.push({
        stage: 'enrich', type: 'format-info',
        field: null,
        reason: isNewFormat
            ? `Formato: Excel ajustado (19 columnas). Filas: ${excelRows.length}. Indices: byPdfFieldName=${index.byPdfFieldName.size}, byPdfLabel=${index.byPdfLabel.size}, byFormLabel=${index.byFormLabel.size}, byJsonLeaf=${index.byJsonLeaf.size}`
            : `Formato: Excel original (cliente). Filas: ${excelRows.length}. Indices: byPdfFieldName=${index.byPdfFieldName.size}, byPdfLabel=${index.byPdfLabel.size}, byFormLabel=${index.byFormLabel.size}, byJsonLeaf=${index.byJsonLeaf.size}`,
    });

    const sections = extractSections(lovableJson);
    const allFields = sections.flatMap(s => s.fields);

    const matchMap = new Map();
    const triggers = [];
    let matchCount = 0;
    let missCount = 0;
    let noiseCount = 0;
    const matchSources = {};

    const fieldLookup = buildFieldLookup(allFields);

    for (const field of allFields) {
        const sn = field.sourceMeta?.sourceName || '';

        if (isPdfLabelNoise(sn)) {
            noiseCount++;
            warnings.push({
                stage: 'enrich', type: 'pdf-label-noise',
                field: field.label || field.id,
                reason: `sourceName "${sn}" parece ser un label/header del PDF, no un campo de datos`,
            });
            field._isPdfNoise = true;
            cleanLabel(field);
            continue;
        }

        const match = matchField(field, index);

        if (!match) {
            missCount++;
            warnings.push({
                stage: 'enrich', type: 'no-match',
                field: field.label || field.id,
                reason: `sourceName "${sn || '?'}" not found in Excel`,
            });
            cleanLabel(field);
            continue;
        }

        matchMap.set(field.id, match);
        matchSources[match.source] = (matchSources[match.source] || 0) + 1;

        if (match.confidence < 70) {
            warnings.push({
                stage: 'enrich', type: 'low-confidence',
                field: field.label || field.id,
                reason: `Match via ${match.source} (confidence ${match.confidence}%) to Excel row ${match.row._rowIndex}`,
            });
        }

        const excelRow = match.row;
        matchCount++;

        if (match.source === 'catalog-value-match') {
            field._isOptionOf = excelRow.fieldLabel || excelRow.pdfLabel || '';
            field._optionValue = match._matchedOption || sn;
        }

        applyType(field, excelRow);
        applyRequired(field, excelRow);
        applyReadOnly(field, excelRow);
        applyValidations(field, excelRow);

        const comboOptions = collectComboOptions(excelRow, index);
        applyOptions(field, excelRow, comboOptions, catalogs);

        applyPrefill(field, excelRow);

        const trigger = applyConditionals(field, excelRow, fieldLookup);
        if (trigger) triggers.push(trigger);

        applyLabel(field, excelRow);

        if (excelRow.obs && /concatenar?\s*auto/i.test(excelRow.obs)) {
            field.readOnly = true;
            field.computed = { type: 'concat', note: excelRow.obs };
        }
    }

    resolveTriggers(triggers, allFields, warnings);

    const newSections = regroupSections(allFields, matchMap);

    const enriched = JSON.parse(JSON.stringify(lovableJson));
    writeSections(enriched, newSections);

    let issues = [];
    if (clientJsonText) {
        const clientPaths = loadClientPathsFromText(clientJsonText);
        issues = validatePrefillKeys(enriched, clientPaths, warnings);
    }

    return {
        json: enriched,
        warnings,
        issues,
        stats: {
            matchCount,
            missCount,
            noiseCount,
            matchSources,
            totalLovable: allFields.length,
            totalExcel: excelRows.length,
            sectionsCreated: newSections.length,
        },
    };
}

function extractSections(json) {
    if (json?.data?.jsonDefinition?.sections) return json.data.jsonDefinition.sections;
    if (json?.sections) return json.sections;
    if (json?.jsonDefinition?.sections) return json.jsonDefinition.sections;
    throw new Error('Could not find sections[] in Lovable JSON');
}

function writeSections(json, sections) {
    if (json?.data?.jsonDefinition?.sections) { json.data.jsonDefinition.sections = sections; return; }
    if (json?.sections) { json.sections = sections; return; }
    if (json?.jsonDefinition?.sections) { json.jsonDefinition.sections = sections; return; }
}

function buildFieldLookup(allFields) {
    const byLabel = new Map();
    for (const f of allFields) {
        const nl = (f.label || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ').trim();
        if (nl) byLabel.set(nl, f);
        const sn = (f.sourceMeta?.sourceName || '').replace(/_/g, ' ').toLowerCase();
        if (sn) byLabel.set(sn, f);
    }

    return function lookup(label) {
        const nl = (label || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ').trim();
        return byLabel.get(nl) || null;
    };
}

function cleanLabel(field) {
    let label = field.label || '';
    label = label.replace(/_Row_\d+$/i, '');
    label = label.replace(/:_?$/, '');
    label = label.replace(/_/g, ' ');
    field.label = capitalize(label.trim());
}

function applyLabel(field, excelRow) {
    if (excelRow.fieldLabel) {
        field.label = excelRow.fieldLabel;
    } else if (excelRow.pdfLabel) {
        field.label = excelRow.pdfLabel;
    } else {
        cleanLabel(field);
    }
}

function capitalize(s) {
    if (!s) return s;
    if (s === s.toUpperCase() || s === s.toLowerCase()) {
        return s.replace(/\b\w/g, c => c.toUpperCase());
    }
    return s;
}

function validatePrefillKeys(json, clientPaths, warnings) {
    const issues = validateLovableJson(json, clientPaths);
    for (const issue of issues) {
        warnings.push({
            stage: 'enrich', type: 'prefillkey-invalid',
            field: issue.field,
            reason: `prefillKey "${issue.prefillKey}" not found in client JSON`,
        });
    }
    return issues;
}

module.exports = { runEnrichPipeline };
