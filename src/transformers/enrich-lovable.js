'use strict';

/**
 * Enrich a Lovable JSON (from Lovable's PDF scanner) with business rules,
 * validations, prefillKeys, and options from the Excel matrix + catalogs.
 *
 * Match key: lovableField.sourceMeta.sourceName ↔ excelField.pdfFieldName
 */

function enrichLovableWithMatrix(lovableJson, excelFields, options = {}) {
    const { catalogs = {}, clientPaths = null } = options;

    const warnings = [];
    const excelIndex = buildExcelIndex(excelFields);
    const enriched = JSON.parse(JSON.stringify(lovableJson));
    const sections = extractSections(enriched);

    let matchCount = 0;
    let missCount = 0;

    for (const section of sections) {
        for (const field of section.fields) {
            const sourceName = field.sourceMeta?.sourceName;
            if (!sourceName) {
                warnings.push({
                    stage: 'enrich', type: 'no_source_name',
                    field: field.label || field.id,
                    reason: 'Field has no sourceMeta.sourceName — cannot match with Excel'
                });
                missCount++;
                continue;
            }

            const excelMatch = findExcelMatch(sourceName, excelIndex);
            if (!excelMatch) {
                warnings.push({
                    stage: 'enrich', type: 'no_excel_match',
                    field: field.label || field.id,
                    reason: `sourceName "${sourceName}" not found in Excel "Nombre del Campo en PDF" column`
                });
                missCount++;
                continue;
            }

            applyExcelData(field, excelMatch);
            matchCount++;
        }
    }

    // Report unmatched Excel rows
    const matchedExcelIds = new Set();
    for (const section of sections) {
        for (const field of section.fields) {
            const sn = field.sourceMeta?.sourceName;
            if (sn) matchedExcelIds.add(normalizeKey(sn));
        }
    }
    for (const ef of excelFields) {
        if (ef.pdfFieldName && !matchedExcelIds.has(normalizeKey(ef.pdfFieldName))) {
            warnings.push({
                stage: 'enrich', type: 'excel_field_unused',
                field: ef.label || ef.pdfFieldName,
                reason: `Excel row "${ef.pdfFieldName}" has no matching field in the Lovable JSON`
            });
        }
    }

    writeSectionsBack(enriched, sections);

    return {
        json: enriched,
        warnings,
        stats: { matchCount, missCount, totalLovable: countFields(sections), totalExcel: excelFields.length }
    };
}

function extractSections(json) {
    if (json?.data?.jsonDefinition?.sections) return json.data.jsonDefinition.sections;
    if (json?.sections) return json.sections;
    if (json?.jsonDefinition?.sections) return json.jsonDefinition.sections;
    throw new Error('Could not find sections[] in Lovable JSON');
}

function writeSectionsBack(json, sections) {
    if (json?.data?.jsonDefinition?.sections) { json.data.jsonDefinition.sections = sections; return; }
    if (json?.sections) { json.sections = sections; return; }
    if (json?.jsonDefinition?.sections) { json.jsonDefinition.sections = sections; return; }
}

function buildExcelIndex(fields) {
    const byExact = new Map();
    const byNormalized = new Map();

    for (const f of fields) {
        if (f.pdfFieldName) {
            byExact.set(f.pdfFieldName, f);
            byNormalized.set(normalizeKey(f.pdfFieldName), f);
        }
        if (f.pdfLabel) {
            byNormalized.set(normalizeKey(f.pdfLabel), f);
        }
        if (f.label) {
            byNormalized.set(normalizeKey(f.label), f);
        }
    }

    return { byExact, byNormalized };
}

function findExcelMatch(sourceName, index) {
    if (index.byExact.has(sourceName)) return index.byExact.get(sourceName);

    const norm = normalizeKey(sourceName);
    if (index.byNormalized.has(norm)) return index.byNormalized.get(norm);

    return null;
}

function applyExcelData(lovableField, excelField) {
    if (excelField.required !== undefined) {
        lovableField.required = !!excelField.required;
    }

    if (excelField.validationPattern) {
        lovableField.validationPattern = excelField.validationPattern;
    }

    if (excelField.conditionalVisibility) {
        lovableField.conditionalVisibility = excelField.conditionalVisibility;
    }

    if (excelField.jsonName) {
        const key = resolveKey(excelField.jsonName);
        if (key) {
            lovableField.prefillKey = key;
            lovableField.prefillMode = lovableField.required ? 'required' : 'optional';
        }
    }

    if (excelField.options && excelField.options.length) {
        lovableField.options = excelField.options.map(o => {
            if (typeof o === 'string') return o;
            return o.label || o.code || '';
        }).filter(Boolean);
    }

    if (excelField.readOnly) {
        lovableField.readOnly = true;
    }

    if (excelField.hidden) {
        lovableField.hidden = true;
    }

    if (excelField.maxLength) {
        lovableField.maxLength = excelField.maxLength;
    }

    if (excelField.rule) {
        lovableField._excelRule = excelField.rule;
    }

    if (excelField.obs) {
        lovableField._excelObs = excelField.obs;
    }

    if (excelField.step || excelField.section) {
        lovableField._excelStep = excelField.step || '';
        lovableField._excelSection = excelField.section || '';
    }
}

function resolveKey(raw) {
    const s = (raw || '').trim();
    if (!s) return null;
    return s.split(/[,;/]|\s+y\s+/i)[0].trim() || null;
}

function normalizeKey(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\[\d+\]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function countFields(sections) {
    return sections.reduce((n, s) => n + s.fields.length, 0);
}

module.exports = { enrichLovableWithMatrix };
