/**
 * Browser entry — exposes the pipeline to the page as `window.InsPipeline`.
 * Bundled with esbuild: see `npm run build:web`.
 */
'use strict';

const { runPipelineAll, runEnrichAll } = require('./pipeline');
const { analyzePdf, generatePdf } = require('./pdf-converter/pipeline-convert-pdf');

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
 * Derive formCode from a Lovable JSON file.
 * Tries to extract from _sourcePdf.fileName, falls back to file name.
 */
function formCodeFromLovableJson(jsonText, fileName) {
    try {
        const parsed = JSON.parse(jsonText);
        const sp = parsed?._sourcePdf || parsed?.data?.jsonDefinition?._sourcePdf || parsed?.jsonDefinition?._sourcePdf;
        if (sp?.fileName) {
            return sp.fileName.replace(/\.pdf$/i, '').replace(/_v\d+$/i, '');
        }
    } catch { /* fall through */ }
    return fileName.replace(/\.json$/i, '');
}

/**
 * Run the full pipeline for all uploaded PDFs.
 * When Lovable JSON files are provided, runs enrichment mode instead.
 *
 * @param {Object} inputs
 * @param {File}   inputs.matrixFile           (required)
 * @param {File[]} [inputs.pdfFiles]           array of PDF File objects (any number)
 * @param {File}   [inputs.catalogsFile]       (optional)
 * @param {File}   [inputs.clientJsonFile]     (optional)
 * @param {File[]} [inputs.lovableJsonFiles]   (optional) Lovable JSON files for enrichment
 * @param {Object} [options]
 * @returns {Promise<{ results, formCodes, hasFormCodeColumn }>}
 */
async function runAll(inputs, options = {}) {
    const { matrixFile, pdfFiles = [], catalogsFile, clientJsonFile, lovableJsonFiles = [] } = inputs;
    if (!matrixFile) throw new Error('matrixFile is required');

    const matrixBuffer   = await fileToUint8Array(matrixFile);
    const catalogsBuffer = catalogsFile ? await fileToUint8Array(catalogsFile) : null;
    const clientJsonText = clientJsonFile ? await fileToText(clientJsonFile) : null;

    const pdfMap = {};
    for (const pdfFile of pdfFiles) {
        const code = formCodeFromFile(pdfFile);
        pdfMap[code] = {
            buffer: await fileToUint8Array(pdfFile),
            fileName: pdfFile.name
        };
    }

    if (lovableJsonFiles.length > 0) {
        const lovableJsonMap = {};
        for (const file of lovableJsonFiles) {
            const text = await fileToText(file);
            const code = formCodeFromLovableJson(text, file.name);
            lovableJsonMap[code] = text;
        }

        return runEnrichAll({
            matrixBuffer,
            lovableJsonMap,
            catalogsBuffer,
            pdfMap,
            clientJsonText
        }, options);
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

async function runConvertAnalysis(inputs) {
    const { pdfFile, matrixFile, referenceJsonFile } = inputs;
    if (!pdfFile) throw new Error('PDF file is required');
    if (!matrixFile) throw new Error('Excel matrix is required');

    const pdfBytes = await fileToUint8Array(pdfFile);
    const excelBuffer = await fileToUint8Array(matrixFile);
    const referenceJsonText = referenceJsonFile ? await fileToText(referenceJsonFile) : null;

    const result = await analyzePdf({ pdfBytes, excelBuffer, referenceJsonText });
    return { ...result, pdfBytes };
}

async function runConvertGenerate(pdfBytes, finalMatches) {
    const result = await generatePdf(pdfBytes, finalMatches);
    return result;
}

if (typeof window !== 'undefined') {
    window.InsPipeline = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate };
}

module.exports = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate };
