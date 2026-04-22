'use strict';

async function extractText(pdfBytes) {
    const pdfjsLib = await loadPdfjs();
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
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

let _pdfjsLib = null;

async function loadPdfjs() {
    if (_pdfjsLib) return _pdfjsLib;

    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';
    }
    _pdfjsLib = pdfjsLib;
    return pdfjsLib;
}

module.exports = { extractText };
