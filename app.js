/* global InsPipelineBundle */
(function () {
    'use strict';

    const state = {
        matrix: null,
        catalogs: null,
        client: null,
        pdfs: {}          // { '1009052': File, 'D0306': File, ... }
    };

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    function init() {
        buildPdfSlots();
        wireFileInputs();
        wireButtons();
    }

    function buildPdfSlots() {
        const grid = $('#pdfGrid');
        const products = InsPipelineBundle.KNOWN_PRODUCTS;
        for (const [pdfId, meta] of Object.entries(products)) {
            const slot = document.createElement('label');
            slot.className = 'file-slot';
            slot.dataset.slot = `pdf-${pdfId}`;
            slot.innerHTML = `
                <span class="label">${pdfId}</span>
                <span class="desc">${meta.productName}</span>
                <input type="file" accept=".pdf" data-input="pdf" data-pdf-id="${pdfId}">
                <span class="file-status"></span>
            `;
            grid.appendChild(slot);
        }
    }

    function wireFileInputs() {
        $$('input[type="file"]').forEach(input => {
            input.addEventListener('change', handleFileInput);
        });
    }

    function handleFileInput(e) {
        const input = e.target;
        const file = input.files[0];
        const slot = input.closest('.file-slot');
        const statusEl = slot.querySelector('.file-status');
        const kind = input.dataset.input;

        if (!file) {
            slot.classList.remove('loaded');
            statusEl.textContent = '';
            if (kind === 'pdf') delete state.pdfs[input.dataset.pdfId];
            else state[kind] = null;
            refreshButtons();
            return;
        }

        if (kind === 'pdf') {
            state.pdfs[input.dataset.pdfId] = file;
        } else {
            state[kind] = file;
        }
        slot.classList.add('loaded');
        statusEl.textContent = `✓ ${file.name} (${formatSize(file.size)})`;
        refreshButtons();
    }

    function wireButtons() {
        $('#btnRun').addEventListener('click', () => run({ all: false }));
        $('#btnRunAll').addEventListener('click', () => run({ all: true }));
    }

    function refreshButtons() {
        const ready = state.matrix && state.catalogs;
        const hasAnyPdf = Object.keys(state.pdfs).length > 0;
        $('#btnRun').disabled = !ready || !hasAnyPdf;
        $('#btnRunAll').disabled = !ready;
    }

    async function run({ all }) {
        const statusEl = $('#status');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Procesando…';

        const options = {
            embedPdf: $('#optEmbedPdf').checked,
            strategy: $('#optStrategy').value
        };

        let pdfFiles = state.pdfs;
        if (all) {
            // If user hit "los 3 productos" but only uploaded some PDFs, we still run
            // all three — the missing ones get coordinates skipped.
            pdfFiles = {};
            for (const pdfId of Object.keys(InsPipelineBundle.KNOWN_PRODUCTS)) {
                pdfFiles[pdfId] = state.pdfs[pdfId] || null;
            }
        }

        try {
            const t0 = performance.now();
            const results = await InsPipelineBundle.runAll({
                matrixFile:     state.matrix,
                catalogsFile:   state.catalogs,
                pdfFiles,
                clientJsonFile: state.client
            }, options);
            const t1 = performance.now();

            renderResults(results);
            renderWarnings(results, $('#optVerbose').checked);

            statusEl.className = 'status active success';
            statusEl.textContent = `✓ Listo. ${results.length} JSON generado(s) en ${Math.round(t1 - t0)}ms.`;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = `✗ ${err.message}`;
        }
    }

    function renderResults(results) {
        const panel = $('#resultsPanel');
        const container = $('#results');
        container.innerHTML = '';
        for (const r of results) {
            const meta = InsPipelineBundle.KNOWN_PRODUCTS[r.pdfId] || { productName: r.pdfId };
            const fieldCount = r.json.sections.reduce((n, s) => n + s.fields.length, 0);
            const card = document.createElement('div');
            card.className = 'result-card';
            card.innerHTML = `
                <div class="meta">
                    <span class="product-id">${r.pdfId}</span>
                    <span class="product-name">${meta.productName}</span>
                    <span class="product-stats">
                        ${fieldCount} campos · ${r.json.sections.length} secciones
                        · ${r.warnings.length} warnings
                        · ${r.issues.length} prefillKey mismatches
                    </span>
                </div>
                <div class="buttons">
                    <button class="secondary" data-action="preview">Ver JSON</button>
                    <button class="primary"   data-action="download">Descargar</button>
                </div>
            `;
            card.querySelector('[data-action="download"]').addEventListener('click', () => {
                const blob = InsPipelineBundle.jsonToBlob(r.json);
                InsPipelineBundle.downloadBlob(blob, `${r.pdfId}.json`);
            });
            card.querySelector('[data-action="preview"]').addEventListener('click', () => {
                const w = window.open('', '_blank');
                w.document.write('<pre style="font-family:monospace;font-size:11px;background:#0d1117;color:#c9d1d9;padding:1rem;">' +
                    escapeHtml(JSON.stringify(r.json, null, 2)) + '</pre>');
                w.document.title = `${r.pdfId}.json`;
            });
            container.appendChild(card);
        }
        panel.hidden = false;
    }

    function renderWarnings(results, verbose) {
        const panel = $('#warningsPanel');
        const summary = $('#warningsSummary');
        const log = $('#warningsLog');

        const lines = [];
        let totalW = 0;
        let totalI = 0;

        for (const r of results) {
            totalW += r.warnings.length;
            totalI += r.issues.length;
            if (!verbose && !r.warnings.length && !r.issues.length) continue;

            lines.push(`── ${r.pdfId} ──`);
            for (const w of r.warnings) {
                lines.push(`  [${w.stage}:${w.type}] ${w.field || ''} — ${w.reason || ''}`);
            }
            for (const i of r.issues) {
                lines.push(`  [prefillKey] ${i.field} (${i.prefillKey}) — ${i.reason}`);
            }
            lines.push('');
        }

        if (totalW === 0 && totalI === 0) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        summary.textContent = `${totalW} warnings · ${totalI} prefillKey mismatches`;
        log.textContent = lines.join('\n') || 'Sin detalles.';
    }

    function formatSize(n) {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1024 / 1024).toFixed(1)} MB`;
    }

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
