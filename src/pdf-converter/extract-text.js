'use strict';

let _pdfjsLib = null;
let _pdfWorker = null;

async function extractText(pdfBytes) {
    const pdfjsLib = await loadPdfjs();
    const worker = await getWorker(pdfjsLib);
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(), worker });
    const pdf = await loadingTask.promise;
    const textItems = [];

    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        for (const item of content.items) {
            if (!item.str || !item.str.trim()) continue;
            textItems.push({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
                height: item.height || Math.abs(item.transform[3]) || 10,
                page: p - 1,
            });
        }
    }

    return textItems;
}

async function loadPdfjs() {
    if (_pdfjsLib) return _pdfjsLib;
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    _pdfjsLib = pdfjsLib;
    return pdfjsLib;
}

async function getWorker(pdfjsLib) {
    if (_pdfWorker && !_pdfWorker.destroyed) return _pdfWorker;
    const webWorker = new Worker('pdf.worker.min.mjs', { type: 'module' });
    _pdfWorker = new pdfjsLib.PDFWorker({ port: webWorker });
    return _pdfWorker;
}

module.exports = { extractText };
