/**
 * @file pdf-preview.js
 * @version 1.3.0
 * @description Large PDF preview with PDF.js — full-width pages, vertical scroll.
 * @changelog
 *   - v1.3.0: Initial — renderPdfPreview with page-by-page canvas rendering
 */
'use strict';

async function renderPdfPreview(pdfBytes, container, pdfjsLib) {
    container.innerHTML = '';

    const webWorker = new Worker('pdf.worker.min.mjs', { type: 'module' });
    const pdfWorker = new pdfjsLib.PDFWorker({ port: webWorker });

    let doc;
    try {
        doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(), worker: pdfWorker }).promise;
    } catch (err) {
        container.innerHTML = '<div class="v2-preview-placeholder">Error al cargar PDF: ' + escapeHtml(err.message) + '</div>';
        webWorker.terminate();
        return { destroy: function() {} };
    }

    const numPages = doc.numPages;

    for (let p = 1; p <= numPages; p++) {
        const page = await doc.getPage(p);
        const baseViewport = page.getViewport({ scale: 1 });

        const containerWidth = container.clientWidth - 48;
        const scale = Math.max(containerWidth / baseViewport.width, 1);
        const viewport = page.getViewport({ scale });

        const pageDiv = document.createElement('div');
        pageDiv.className = 'v2-page';
        pageDiv.style.width = Math.floor(viewport.width) + 'px';

        var label = document.createElement('div');
        label.className = 'v2-page-label';
        label.textContent = 'Página ' + p + ' de ' + numPages;
        pageDiv.appendChild(label);

        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pageDiv.appendChild(canvas);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

        container.appendChild(pageDiv);
    }

    return {
        numPages: numPages,
        destroy: function() {
            pdfWorker.destroy();
            webWorker.terminate();
            container.innerHTML = '';
        },
    };
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { renderPdfPreview };
