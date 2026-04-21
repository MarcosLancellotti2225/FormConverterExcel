/**
 * Pipeline Orchestrator
 * Pure in-memory pipeline. Takes buffers (no I/O) and returns the Lovable JSON.
 * Reused by both the Node CLI (src/index.js) and the browser build (src/browser.js).
 *
 * Supports any number of forms — no hardcoded product list.
 * The matrix "Código Formulario" column groups rows per form.
 */
'use strict';

const { parseMatrixFromBuffer, groupFieldsByFormCode } = require('./parsers/excel-parser');
const { parseCatalogsFromBuffer }      = require('./parsers/catalogs-parser');
const { parsePdfFromBuffer, bufferToBase64 } = require('./parsers/pdf-analyzer');
const { applyRules }                   = require('./parsers/rule-parser');
const { mergeCatalogs }                = require('./transformers/merge-catalogs');
const { mergePdfCoords }               = require('./transformers/merge-pdf-coords');
const { groupBySections, resolveTriggerConditionals } = require('./transformers/section-grouper');
const { enrichLovableWithMatrix }      = require('./transformers/enrich-lovable');
const { buildLovableJson }             = require('./builders/json-builder');
const { loadClientPathsFromText, validateLovableJson } = require('./validators/prefillkey-validator');

/**
 * Run the full pipeline for ONE form (identified by formCode).
 *
 * @param {Object} inputs
 * @param {Field[]} inputs.fields                                     pre-filtered fields for this form
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.catalogsBuffer]     (optional)
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.pdfBuffer]          (optional)
 * @param {string}  [inputs.clientJsonText]                            (optional)
 * @param {string}  inputs.formCode                                    form identifier (matches PDF filename)
 * @param {string}  [inputs.pdfFileName]                               original upload name
 * @param {Object}  [options]
 * @param {boolean} [options.embedPdf=true]
 * @param {string}  [options.strategy='pdf_page']
 * @returns {Promise<{ json:Object, warnings:Array, issues:Array }>}
 */
async function runPipelineForForm(inputs, options = {}) {
    const {
        fields: inputFields,
        catalogsBuffer,
        pdfBuffer,
        clientJsonText,
        formCode,
        pdfFileName
    } = inputs;

    const {
        embedPdf = true,
        strategy = 'pdf_page'
    } = options;

    if (!inputFields || !inputFields.length) throw new Error('fields[] is required and must not be empty');
    if (!formCode) throw new Error('formCode is required');

    const warnings = [];

    // Deep-clone
    let fields = inputFields.map(cloneField);

    // Parse catalogs + resolve options (optional)
    const catalogs = catalogsBuffer ? parseCatalogsFromBuffer(catalogsBuffer) : {};
    mergeCatalogs(fields, catalogs);

    // Apply rules (validations + conditionals)
    const ruleResult = applyRules(fields);
    for (const w of ruleResult.warnings) warnings.push({ stage: 'rules', ...w });

    // Parse PDF coordinates (optional)
    let pdfBase64 = null;
    let pdfData = null;
    if (pdfBuffer) {
        pdfData = await parsePdfFromBuffer(pdfBuffer);
        const mergeResult = mergePdfCoords(fields, pdfData);
        for (const w of mergeResult.warnings) warnings.push({ stage: 'pdf', ...w });
        if (embedPdf) {
            pdfBase64 = bufferToBase64(pdfBuffer);
        }
    }

    // Group sections + resolve triggers
    const sections = groupBySections(fields, strategy);
    resolveTriggerConditionals(sections);

    // Build final JSON (Lovable shape)
    const json = buildLovableJson({
        sections,
        pdfId: formCode,
        pdfBase64,
        pdfData,
        pdfFileName: pdfFileName || (pdfData ? `${formCode}.pdf` : null),
        meta: { productName: formCode },
        catalogs
    });

    // Validate prefillKeys against client JSON
    let issues = [];
    if (clientJsonText) {
        const clientPaths = loadClientPathsFromText(clientJsonText);
        issues = validateLovableJson(json, clientPaths);
    }

    return { json, warnings, issues };
}

/**
 * High-level: parse the matrix, group by formCode, and run the pipeline
 * for every form that has a matching PDF (or for all forms if no PDFs given).
 *
 * @param {Object} inputs
 * @param {ArrayBuffer|Uint8Array|Buffer} inputs.matrixBuffer
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.catalogsBuffer]
 * @param {Object<string, { buffer, fileName }>} [inputs.pdfMap]   formCode → { buffer, fileName }
 * @param {string} [inputs.clientJsonText]
 * @param {Object} [options]
 * @returns {Promise<{ results:Array, formCodes:string[], hasFormCodeColumn:boolean }>}
 */
async function runPipelineAll(inputs, options = {}) {
    const { matrixBuffer, catalogsBuffer, pdfMap = {}, clientJsonText } = inputs;
    if (!matrixBuffer) throw new Error('matrixBuffer is required');

    const { fields: allFields, formCodes, hasFormCodeColumn } = parseMatrixFromBuffer(matrixBuffer);
    const groups = groupFieldsByFormCode(allFields);

    // Decide which form codes to process
    let codesToProcess;
    const pdfCodes = Object.keys(pdfMap);

    if (pdfCodes.length > 0) {
        codesToProcess = pdfCodes;
    } else {
        codesToProcess = [...groups.keys()];
    }

    const results = [];
    for (const code of codesToProcess) {
        const fields = groups.get(code) || groups.get('_all') || [];
        if (!fields.length) continue;

        const pdf = pdfMap[code];
        const result = await runPipelineForForm({
            fields,
            catalogsBuffer,
            pdfBuffer: pdf?.buffer || null,
            clientJsonText,
            formCode: code,
            pdfFileName: pdf?.fileName || null
        }, options);

        results.push({ formCode: code, ...result });
    }

    return { results, formCodes, hasFormCodeColumn };
}

/**
 * Enrich a Lovable JSON (from Lovable's PDF scanner) with data from the Excel matrix.
 * The Lovable JSON provides field coordinates; the Excel provides business rules.
 *
 * @param {Object} inputs
 * @param {string} inputs.lovableJsonText               Lovable JSON string
 * @param {Field[]} inputs.fields                       Excel fields for this form
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.catalogsBuffer]
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.pdfBuffer]
 * @param {string} [inputs.clientJsonText]
 * @param {string} inputs.formCode
 * @param {string} [inputs.pdfFileName]
 * @param {Object} [options]
 * @returns {Promise<{ json:Object, warnings:Array, issues:Array }>}
 */
async function runEnrichPipeline(inputs, options = {}) {
    const {
        lovableJsonText,
        fields: inputFields,
        catalogsBuffer,
        pdfBuffer,
        clientJsonText,
        formCode,
        pdfFileName
    } = inputs;

    const { embedPdf = true } = options;

    const lovableJson = JSON.parse(lovableJsonText);
    const warnings = [];

    let fields = inputFields.map(cloneField);

    const catalogs = catalogsBuffer ? parseCatalogsFromBuffer(catalogsBuffer) : {};
    mergeCatalogs(fields, catalogs);

    const ruleResult = applyRules(fields);
    for (const w of ruleResult.warnings) warnings.push({ stage: 'rules', ...w });

    const enrichResult = enrichLovableWithMatrix(lovableJson, fields, { catalogs });
    for (const w of enrichResult.warnings) warnings.push(w);

    let enrichedJson = enrichResult.json;

    if (pdfBuffer && embedPdf) {
        const pdfBase64 = bufferToBase64(pdfBuffer);
        const pdfData = await parsePdfFromBuffer(pdfBuffer);
        const jd = enrichedJson?.data?.jsonDefinition
                || enrichedJson?.jsonDefinition
                || enrichedJson;
        if (jd._sourcePdf) {
            jd._sourcePdf.b64 = pdfBase64;
        } else {
            jd._sourcePdf = {
                fileName: pdfFileName || `${formCode}.pdf`,
                pageCount: pdfData.numPages,
                b64: pdfBase64
            };
        }
    }

    let issues = [];
    if (clientJsonText) {
        const clientPaths = loadClientPathsFromText(clientJsonText);
        issues = validateLovableJson(enrichedJson, clientPaths);
    }

    return { json: enrichedJson, warnings, issues, stats: enrichResult.stats };
}

/**
 * High-level: run enrichment for all Lovable JSONs provided.
 *
 * @param {Object} inputs
 * @param {ArrayBuffer|Uint8Array|Buffer} inputs.matrixBuffer
 * @param {Object<string, string>} inputs.lovableJsonMap    formCode → JSON text
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.catalogsBuffer]
 * @param {Object<string, { buffer, fileName }>} [inputs.pdfMap]
 * @param {string} [inputs.clientJsonText]
 * @param {Object} [options]
 * @returns {Promise<{ results:Array, formCodes:string[], hasFormCodeColumn:boolean }>}
 */
async function runEnrichAll(inputs, options = {}) {
    const { matrixBuffer, lovableJsonMap, catalogsBuffer, pdfMap = {}, clientJsonText } = inputs;
    if (!matrixBuffer) throw new Error('matrixBuffer is required');
    if (!lovableJsonMap || !Object.keys(lovableJsonMap).length) {
        throw new Error('At least one Lovable JSON is required for enrichment');
    }

    const { fields: allFields, formCodes, hasFormCodeColumn } = parseMatrixFromBuffer(matrixBuffer);
    const groups = groupFieldsByFormCode(allFields);

    const results = [];
    for (const [code, jsonText] of Object.entries(lovableJsonMap)) {
        const fields = groups.get(code) || groups.get('_all') || [];

        const pdf = pdfMap[code];
        const result = await runEnrichPipeline({
            lovableJsonText: jsonText,
            fields,
            catalogsBuffer,
            pdfBuffer: pdf?.buffer || null,
            clientJsonText,
            formCode: code,
            pdfFileName: pdf?.fileName || null
        }, options);

        results.push({ formCode: code, ...result });
    }

    return { results, formCodes, hasFormCodeColumn };
}

function cloneField(f) {
    return {
        ...f,
        options: f.options ? f.options.map(o => ({ ...o })) : [],
        productScope: [...f.productScope]
    };
}

module.exports = { runPipelineForForm, runPipelineAll, runEnrichPipeline, runEnrichAll, parseMatrixFromBuffer, groupFieldsByFormCode };
