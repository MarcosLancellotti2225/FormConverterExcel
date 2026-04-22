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

async function renderPreview(pdfBytes, matches, container) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const webWorker = new Worker('pdf.worker.min.mjs', { type: 'module' });
    const pdfWorker = new pdfjsLib.PDFWorker({ port: webWorker });
    const doc = await pdfjsLib.getDocument({ data: pdfBytes, worker: pdfWorker }).promise;

    const fieldsByPage = {};
    for (const m of matches) {
        if (!fieldsByPage[m.page]) fieldsByPage[m.page] = [];
        fieldsByPage[m.page].push(m);
    }

    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const baseVp = page.getViewport({ scale: 1 });
        const cw = container.clientWidth - 24;
        const scale = Math.min(cw / baseVp.width, 1.5);
        const viewport = page.getViewport({ scale });

        const pageDiv = document.createElement('div');
        pageDiv.className = 'preview-page';
        pageDiv.style.width = Math.floor(viewport.width) + 'px';
        pageDiv.style.height = Math.floor(viewport.height) + 'px';

        const pageLabel = document.createElement('div');
        pageLabel.className = 'preview-page-label';
        pageLabel.textContent = 'Pag ' + p;
        pageDiv.appendChild(pageLabel);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pageDiv.appendChild(canvas);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const pageFields = fieldsByPage[p - 1] || [];
        for (const m of pageFields) {
            const r = m.rect;
            const [x1, y1] = viewport.convertToViewportPoint(r.x, r.y + r.height);
            const [x2, y2] = viewport.convertToViewportPoint(r.x + r.width, r.y);
            const left = Math.min(x1, x2);
            const top = Math.min(y1, y2);
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);

            const fd = document.createElement('div');
            fd.className = 'preview-field' + (m.source === 'unchanged' ? ' unmatched' : '');
            fd.dataset.fieldName = m.originalName;
            fd.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px';

            const tip = document.createElement('span');
            tip.className = 'preview-tooltip';
            tip.textContent = m.newName || m.originalName;
            fd.appendChild(tip);
            pageDiv.appendChild(fd);
        }

        container.appendChild(pageDiv);
    }

    return {
        highlightField(originalName) {
            container.querySelectorAll('.preview-field.highlighted').forEach(el => el.classList.remove('highlighted'));
            const sel = '.preview-field[data-field-name="' + CSS.escape(originalName) + '"]';
            const target = container.querySelector(sel);
            if (target) {
                target.classList.add('highlighted');
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },
        clearHighlights() {
            container.querySelectorAll('.preview-field.highlighted').forEach(el => el.classList.remove('highlighted'));
        },
        onFieldClick(callback) {
            container.addEventListener('click', e => {
                const fd = e.target.closest('.preview-field');
                if (fd) callback(fd.dataset.fieldName);
            });
        },
        destroy() {
            pdfWorker.destroy();
            webWorker.terminate();
            container.innerHTML = '';
        }
    };
}

if (typeof window !== 'undefined') {
    window.InsPipeline = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate, renderPreview };
}

module.exports = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate, renderPreview };
