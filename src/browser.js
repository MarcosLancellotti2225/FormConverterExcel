/**
 * Browser entry — exposes the pipeline to the page as `window.InsPipeline`.
 * Bundled with esbuild: see `npm run build:web`.
 */
'use strict';

const { runPipelineAll } = require('./pipeline');

async function fileToUint8Array(file) {
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
}

async function fileToText(file) {
    return await file.text();
}

/**
 * Derive formCode from a PDF filename: strip extension and path.
 * "1009052.pdf" → "1009052", "D0306_v2.pdf" → "D0306_v2"
 */
function formCodeFromFile(file) {
    return file.name.replace(/\.pdf$/i, '');
}

/**
 * Run the full pipeline for all uploaded PDFs.
 *
 * @param {Object} inputs
 * @param {File}   inputs.matrixFile           (required)
 * @param {File[]} [inputs.pdfFiles]           array of PDF File objects (any number)
 * @param {File}   [inputs.catalogsFile]       (optional)
 * @param {File}   [inputs.clientJsonFile]     (optional)
 * @param {Object} [options]
 * @returns {Promise<{ results, formCodes, hasFormCodeColumn }>}
 */
async function runAll(inputs, options = {}) {
    const { matrixFile, pdfFiles = [], catalogsFile, clientJsonFile } = inputs;
    if (!matrixFile) throw new Error('matrixFile is required');

    const matrixBuffer   = await fileToUint8Array(matrixFile);
    const catalogsBuffer = catalogsFile ? await fileToUint8Array(catalogsFile) : null;
    const clientJsonText = clientJsonFile ? await fileToText(clientJsonFile) : null;

    // Build pdfMap: formCode → { buffer, fileName }
    const pdfMap = {};
    for (const pdfFile of pdfFiles) {
        const code = formCodeFromFile(pdfFile);
        pdfMap[code] = {
            buffer: await fileToUint8Array(pdfFile),
            fileName: pdfFile.name
        };
    }

    return runPipelineAll({
        matrixBuffer,
        catalogsBuffer,
        pdfMap,
        clientJsonText
    }, options);
}

function jsonToBlob(json) {
    return new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
}

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

if (typeof window !== 'undefined') {
    window.InsPipeline = { runAll, jsonToBlob, downloadBlob };
}

module.exports = { runAll, jsonToBlob, downloadBlob };
