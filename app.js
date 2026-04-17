/* global InsPipelineBundle */
(function () {
    'use strict';

    const state = {
        matrix: null,
        catalogs: null,
        client: null,
        pdfs: []    // File[]
    };

    let lastResults = null;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    function init() {
        wireSingleFileInputs();
        wirePdfDropZone();
        wireButtons();
    }

    // --- Single-file inputs (matrix, catalogs, client) ---

    function wireSingleFileInputs() {
        $$('input[data-input]').forEach(input => {
            if (input.dataset.input === 'pdf') return; // handled by drop zone
            input.addEventListener('change', handleSingleFile);
        });
    }

    function handleSingleFile(e) {
        const input = e.target;
        const file = input.files[0];
        const slot = input.closest('.file-slot');
        const statusEl = slot.querySelector('.file-status');
        const kind = input.dataset.input;

        if (!file) {
            slot.classList.remove('loaded');
            statusEl.textContent = '';
            state[kind] = null;
            refreshButtons();
            return;
        }

        state[kind] = file;
        slot.classList.add('loaded');
        statusEl.textContent = '\u2713 ' + file.name + ' (' + formatSize(file.size) + ')';
        refreshButtons();
    }

    // --- PDF drop zone ---

    function wirePdfDropZone() {
        const zone = $('#pdfDropZone');
        const fileInput = $('#pdfFileInput');
        const browseBtn = $('#pdfBrowseBtn');

        browseBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            fileInput.click();
        });

        fileInput.addEventListener('change', function() {
            addPdfFiles(Array.from(fileInput.files));
            fileInput.value = '';
        });

        zone.addEventListener('dragover', function(e) {
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', function() {
            zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            zone.classList.remove('drag-over');
            var files = Array.from(e.dataTransfer.files).filter(function(f) {
                return /\.pdf$/i.test(f.name);
            });
            addPdfFiles(files);
        });
    }

    function addPdfFiles(files) {
        var existingNames = new Set(state.pdfs.map(function(f) { return f.name; }));
        for (var i = 0; i < files.length; i++) {
            if (!existingNames.has(files[i].name)) {
                state.pdfs.push(files[i]);
            }
        }
        renderPdfList();
        refreshButtons();
    }

    function removePdf(index) {
        state.pdfs.splice(index, 1);
        renderPdfList();
        refreshButtons();
    }

    function renderPdfList() {
        var list = $('#pdfList');
        list.innerHTML = '';
        if (!state.pdfs.length) return;

        for (var i = 0; i < state.pdfs.length; i++) {
            (function(idx) {
                var f = state.pdfs[idx];
                var tag = document.createElement('div');
                tag.className = 'pdf-tag';

                var codeSpan = document.createElement('span');
                codeSpan.className = 'pdf-tag-code';
                codeSpan.textContent = f.name.replace(/\.pdf$/i, '');
                tag.appendChild(codeSpan);

                var sizeSpan = document.createElement('span');
                sizeSpan.className = 'pdf-tag-size';
                sizeSpan.textContent = formatSize(f.size);
                tag.appendChild(sizeSpan);

                var removeBtn = document.createElement('button');
                removeBtn.className = 'pdf-tag-remove';
                removeBtn.textContent = '\u00d7';
                removeBtn.title = 'Quitar';
                removeBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    removePdf(idx);
                });
                tag.appendChild(removeBtn);

                list.appendChild(tag);
            })(i);
        }
    }

    // --- Buttons ---

    function wireButtons() {
        $('#btnRun').addEventListener('click', run);
        $('#btnDownloadAll').addEventListener('click', downloadAllAsZip);
    }

    function refreshButtons() {
        var ready = !!state.matrix;
        $('#btnRun').disabled = !ready;
    }

    // --- Run pipeline ---

    async function run() {
        var statusEl = $('#status');
        statusEl.className = 'status active';
        statusEl.textContent = '\u27f3 Procesando...';

        var options = {
            embedPdf: $('#optEmbedPdf').checked,
            strategy: $('#optStrategy').value
        };

        try {
            var t0 = performance.now();
            var out = await InsPipelineBundle.runAll({
                matrixFile:     state.matrix,
                pdfFiles:       state.pdfs,
                catalogsFile:   state.catalogs,
                clientJsonFile: state.client
            }, options);
            var t1 = performance.now();

            lastResults = out.results;
            renderResults(out.results);
            renderWarnings(out.results, $('#optVerbose').checked);

            var msg = '\u2713 Listo. ' + out.results.length + ' JSON generado(s) en ' + Math.round(t1 - t0) + 'ms.';
            if (!out.hasFormCodeColumn) {
                msg += ' (Tip: Agrega la columna "C\u00f3digo Formulario" a la matriz para agrupar campos por PDF.)';
            }
            statusEl.className = 'status active success';
            statusEl.textContent = msg;

            $('#btnDownloadAll').hidden = out.results.length < 2;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '\u2717 ' + err.message;
        }
    }

    // --- Render results ---

    function renderResults(results) {
        var panel = $('#resultsPanel');
        var container = $('#results');
        container.innerHTML = '';

        for (var i = 0; i < results.length; i++) {
            (function(r) {
                var sections = (r.json && r.json.data && r.json.data.jsonDefinition && r.json.data.jsonDefinition.sections) || [];
                var fieldCount = sections.reduce(function(n, s) { return n + s.fields.length; }, 0);
                var card = document.createElement('div');
                card.className = 'result-card';
                card.innerHTML =
                    '<div class="meta">' +
                        '<span class="product-id">' + escapeHtml(r.formCode) + '</span>' +
                        '<span class="product-stats">' +
                            fieldCount + ' campos \u00b7 ' + sections.length + ' secciones' +
                            ' \u00b7 ' + r.warnings.length + ' warnings' +
                            ' \u00b7 ' + r.issues.length + ' prefillKey mismatches' +
                        '</span>' +
                    '</div>' +
                    '<div class="buttons">' +
                        '<button class="secondary" data-action="preview">Ver JSON</button>' +
                        '<button class="primary" data-action="download">Descargar</button>' +
                    '</div>';

                card.querySelector('[data-action="download"]').addEventListener('click', function() {
                    var blob = InsPipelineBundle.jsonToBlob(r.json);
                    InsPipelineBundle.downloadBlob(blob, r.formCode + '.json');
                });
                card.querySelector('[data-action="preview"]').addEventListener('click', function() {
                    var w = window.open('', '_blank');
                    w.document.write('<pre style="font-family:monospace;font-size:11px;background:#0d1117;color:#c9d1d9;padding:1rem;">' +
                        escapeHtml(JSON.stringify(r.json, null, 2)) + '</pre>');
                    w.document.title = r.formCode + '.json';
                });
                container.appendChild(card);
            })(results[i]);
        }
        panel.hidden = false;
    }

    function renderWarnings(results, verbose) {
        var panel = $('#warningsPanel');
        var summary = $('#warningsSummary');
        var log = $('#warningsLog');

        var lines = [];
        var totalW = 0;
        var totalI = 0;

        for (var ri = 0; ri < results.length; ri++) {
            var r = results[ri];
            totalW += r.warnings.length;
            totalI += r.issues.length;
            if (!verbose && !r.warnings.length && !r.issues.length) continue;

            lines.push('\u2500\u2500 ' + r.formCode + ' \u2500\u2500');
            for (var wi = 0; wi < r.warnings.length; wi++) {
                var w = r.warnings[wi];
                lines.push('  [' + w.stage + ':' + w.type + '] ' + (w.field || '') + ' \u2014 ' + (w.reason || ''));
            }
            for (var ii = 0; ii < r.issues.length; ii++) {
                var issue = r.issues[ii];
                lines.push('  [prefillKey] ' + issue.field + ' (' + issue.prefillKey + ') \u2014 ' + issue.reason);
            }
            lines.push('');
        }

        if (totalW === 0 && totalI === 0) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        summary.textContent = totalW + ' warnings \u00b7 ' + totalI + ' prefillKey mismatches';
        log.textContent = lines.join('\n') || 'Sin detalles.';
    }

    // --- Download all as ZIP ---

    async function downloadAllAsZip() {
        if (!lastResults || lastResults.length < 2) return;
        // Inline minimal ZIP builder (no dependencies)
        var files = lastResults.map(function(r) {
            return {
                name: r.formCode + '.json',
                content: JSON.stringify(r.json, null, 2)
            };
        });
        var blob = buildZipBlob(files);
        InsPipelineBundle.downloadBlob(blob, 'lovable-jsons.zip');
    }

    function buildZipBlob(files) {
        var localHeaders = [];
        var centralHeaders = [];
        var offset = 0;

        for (var i = 0; i < files.length; i++) {
            var nameBytes = new TextEncoder().encode(files[i].name);
            var contentBytes = new TextEncoder().encode(files[i].content);
            var crc = crc32(contentBytes);

            // Local file header
            var local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
            var lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true); // sig
            lv.setUint16(4, 20, true); // version
            lv.setUint16(6, 0, true);  // flags
            lv.setUint16(8, 0, true);  // compression (store)
            lv.setUint16(10, 0, true); // mod time
            lv.setUint16(12, 0, true); // mod date
            lv.setUint32(14, crc, true);
            lv.setUint32(18, contentBytes.length, true); // compressed
            lv.setUint32(22, contentBytes.length, true); // uncompressed
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true); // extra length
            local.set(nameBytes, 30);
            local.set(contentBytes, 30 + nameBytes.length);
            localHeaders.push(local);

            // Central directory header
            var central = new Uint8Array(46 + nameBytes.length);
            var cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, 0, true);
            cv.setUint16(14, 0, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, contentBytes.length, true);
            cv.setUint32(24, contentBytes.length, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0x20, true); // external attrs
            cv.setUint32(42, offset, true);
            central.set(nameBytes, 46);
            centralHeaders.push(central);

            offset += local.length;
        }

        var centralSize = centralHeaders.reduce(function(s, c) { return s + c.length; }, 0);
        // End of central directory
        var eocd = new Uint8Array(22);
        var ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true);

        var parts = localHeaders.concat(centralHeaders).concat([eocd]);
        return new Blob(parts, { type: 'application/zip' });
    }

    function crc32(bytes) {
        var table = crc32.table;
        if (!table) {
            table = crc32.table = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                table[n] = c;
            }
        }
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // --- Utilities ---

    function formatSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, function(c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
