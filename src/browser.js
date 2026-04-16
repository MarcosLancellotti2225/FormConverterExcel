/**
 * Browser entry — exposes the pipeline to the page as `window.InsPipeline`.
 * Bundled with esbuild: see `npm run build:web`.
 */
'use strict';

const { runPipeline, KNOWN_PRODUCTS } = require('./pipeline');

/**
 * @param {File} file
 * @returns {Promise<Uint8Array>}
 */
async function fileToUint8Array(file) {
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
async function fileToText(file) {
    return await file.text();
}

/**
 * Run the full pipeline for every product the user provided.
 * @param {Object} inputs
 * @param {File}   inputs.matrixFile      (required)
 * @param {File}   [inputs.catalogsFile]  (optional)
 * @param {Object<string, File>} [inputs.pdfFiles]  map pdfId → File
 * @param {File}   [inputs.clientJsonFile]
 * @param {Object} [options]
 * @returns {Promise<Array<{ pdfId:string, json:Object, warnings:Array, issues:Array }>>}
 */
async function runAll(inputs, options = {}) {
    const { matrixFile, catalogsFile, pdfFiles = {}, clientJsonFile } = inputs;
    if (!matrixFile) throw new Error('matrixFile is required');

    const matrixBuffer   = await fileToUint8Array(matrixFile);
    const catalogsBuffer = catalogsFile ? await fileToUint8Array(catalogsFile) : null;
    const clientJsonText = clientJsonFile ? await fileToText(clientJsonFile) : null;

    // If the user provided at least one PDF, iterate over those; otherwise all known products
    const pdfIds = Object.keys(pdfFiles).length ? Object.keys(pdfFiles) : Object.keys(KNOWN_PRODUCTS);

    const results = [];
    for (const pdfId of pdfIds) {
        const pdfFile = pdfFiles[pdfId];
        const pdfBuffer = pdfFile ? await fileToUint8Array(pdfFile) : null;
        const pdfFileName = pdfFile ? pdfFile.name : null;
        const result = await runPipeline({
            matrixBuffer,
            catalogsBuffer,
            pdfBuffer,
            clientJsonText,
            pdfId,
            pdfFileName
        }, options);
        results.push({ pdfId, ...result });
    }
    return results;
}

/**
 * Turn a result into a downloadable Blob.
 */
function jsonToBlob(json) {
    return new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
}

/**
 * Trigger a download in the browser.
 */
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Attach to window for non-module usage
if (typeof window !== 'undefined') {
    window.InsPipeline = { runAll, KNOWN_PRODUCTS, jsonToBlob, downloadBlob };
}

module.exports = { runAll, KNOWN_PRODUCTS, jsonToBlob, downloadBlob };
