/**
 * Pipeline Orchestrator
 * Pure in-memory pipeline. Takes buffers (no I/O) and returns the Lovable JSON.
 * Reused by both the Node CLI (src/index.js) and the browser build (src/browser.js).
 */
'use strict';

const { parseMatrixFromBuffer }        = require('./parsers/excel-parser');
const { parseCatalogsFromBuffer }      = require('./parsers/catalogs-parser');
const { parsePdfFromBuffer, bufferToBase64 } = require('./parsers/pdf-analyzer');
const { applyRules }                   = require('./parsers/rule-parser');
const { mergeCatalogs }                = require('./transformers/merge-catalogs');
const { mergePdfCoords }               = require('./transformers/merge-pdf-coords');
const { groupBySections, resolveTriggerConditionals } = require('./transformers/section-grouper');
const { buildLovableJson }             = require('./builders/json-builder');
const { loadClientPathsFromText, validateLovableJson } = require('./validators/prefillkey-validator');

const KNOWN_PRODUCTS = {
    '1009052': { productName: 'Vida Colectiva',       productKey: 'vida_colectiva' },
    'D0306':   { productName: 'Vida Universal Plus',  productKey: 'vida_universal' },
    'D0309':   { productName: 'Protección Crediticia', productKey: 'proteccion_crediticia' }
};

/**
 * Run the full pipeline for ONE product.
 *
 * @param {Object} inputs
 * @param {ArrayBuffer|Uint8Array|Buffer} inputs.matrixBuffer       (required)
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.catalogsBuffer]   (optional — options inferred from matrix if absent)
 * @param {ArrayBuffer|Uint8Array|Buffer} [inputs.pdfBuffer]        (optional — no coordinates without it)
 * @param {string}  [inputs.clientJsonText]                          (optional — enables prefillKey validation)
 * @param {string}  inputs.pdfId                                     (1009052 | D0306 | D0309 | any)
 * @param {string}  [inputs.pdfFileName]                             original upload name, used in _sourcePdf
 * @param {Object}  [options]
 * @param {boolean} [options.embedPdf=true]    include _sourcePdf.b64 in output
 * @param {string}  [options.strategy='pdf_page']  section-grouper strategy
 * @returns {Promise<{ json:Object, warnings:Array, issues:Array }>}
 */
async function runPipeline(inputs, options = {}) {
    const {
        matrixBuffer,
        catalogsBuffer,
        pdfBuffer,
        clientJsonText,
        pdfId,
        pdfFileName
    } = inputs;

    const {
        embedPdf = true,
        strategy = 'pdf_page'
    } = options;

    if (!matrixBuffer) throw new Error('matrixBuffer is required');
    if (!pdfId)        throw new Error('pdfId is required');

    const productMeta = KNOWN_PRODUCTS[pdfId] || { productName: pdfId, productKey: null };
    const warnings = [];

    // 1. Parse matrix
    const { fields: baseFields } = parseMatrixFromBuffer(matrixBuffer);

    // Deep-clone so the caller can reuse baseFields across products
    let fields = baseFields.map(cloneField);

    // 2. Filter by productScope
    if (productMeta.productKey) {
        fields = fields.filter(f =>
            f.productScope.includes('all') || f.productScope.includes(productMeta.productKey)
        );
    }

    // 3. Parse catalogs + resolve options (optional)
    const catalogs = catalogsBuffer ? parseCatalogsFromBuffer(catalogsBuffer) : {};
    mergeCatalogs(fields, catalogs);

    // 4. Apply rules (validations + conditionals)
    const ruleResult = applyRules(fields);
    for (const w of ruleResult.warnings) warnings.push({ stage: 'rules', ...w });

    // 5. Parse PDF coordinates (optional)
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

    // 6. Group sections + resolve triggers
    const sections = groupBySections(fields, strategy);
    resolveTriggerConditionals(sections);

    // 7. Build final JSON (Lovable shape)
    const json = buildLovableJson({
        sections,
        pdfId,
        pdfBase64,
        pdfData,
        pdfFileName: pdfFileName || (pdfData ? `${pdfId}.pdf` : null),
        meta: productMeta,
        catalogs
    });

    // 8. Validate prefillKeys against client JSON
    let issues = [];
    if (clientJsonText) {
        const clientPaths = loadClientPathsFromText(clientJsonText);
        issues = validateLovableJson(json, clientPaths);
    }

    return { json, warnings, issues };
}

function cloneField(f) {
    return {
        ...f,
        options: f.options ? f.options.map(o => ({ ...o })) : [],
        productScope: [...f.productScope]
    };
}

module.exports = { runPipeline, KNOWN_PRODUCTS };
