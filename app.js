/* global InsPipelineBundle */
(function () {
    'use strict';

    // ==================== SHARED ====================

    var currentMode = null;

    var $ = function(sel, root) { return (root || document).querySelector(sel); };
    var $$ = function(sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

    function init() {
        wireModeSelector();
        wireBackButton();
        initGenerateJsonFlow();
        initConvertPdfFlow();
        initPdfToHtmlFlow();
    }

    function wireModeSelector() {
        $$('.mode-card').forEach(function(card) {
            card.addEventListener('click', function() {
                selectMode(card.dataset.mode);
            });
        });
    }

    function wireBackButton() {
        $('#btnBackToHome').addEventListener('click', function() {
            selectMode(null);
        });
    }

    function selectMode(mode) {
        currentMode = mode;
        $('#modeSelector').hidden = !!mode;
        $('#convertPdfFlow').hidden = mode !== 'convert-pdf';
        $('#pdfToHtmlFlow').hidden = mode !== 'pdf-to-html';
        $('#generateJsonFlow').hidden = mode !== 'generate-json';
        $('#btnBackToHome').hidden = !mode;
    }

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

    // ==================== GENERATE JSON FLOW ====================

    var genState = {
        matrix: null,
        catalogs: null,
        client: null,
        pdfs: [],
        lovableJsons: []
    };
    var lastResults = null;

    function initGenerateJsonFlow() {
        $$('#generateJsonFlow input[data-input]').forEach(function(input) {
            input.addEventListener('change', handleGenSingleFile);
        });
        wireLovableDropZone();
        wirePdfDropZone();
        $('#btnRun').addEventListener('click', runGenerate);
        $('#btnDownloadAll').addEventListener('click', downloadAllAsZip);
    }

    function handleGenSingleFile(e) {
        var input = e.target;
        var file = input.files[0];
        var slot = input.closest('.file-slot');
        var statusEl = slot.querySelector('.file-status');
        var kind = input.dataset.input;

        if (!file) {
            slot.classList.remove('loaded');
            statusEl.textContent = '';
            genState[kind] = null;
            refreshGenButtons();
            return;
        }

        genState[kind] = file;
        slot.classList.add('loaded');
        statusEl.textContent = '✓ ' + file.name + ' (' + formatSize(file.size) + ')';
        refreshGenButtons();
    }

    function wireLovableDropZone() {
        var zone = $('#lovableDropZone');
        var fileInput = $('#lovableFileInput');
        var browseBtn = $('#lovableBrowseBtn');

        browseBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); fileInput.click(); });
        fileInput.addEventListener('change', function() { addLovableFiles(Array.from(fileInput.files)); fileInput.value = ''; });
        zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', function() { zone.classList.remove('drag-over'); });
        zone.addEventListener('drop', function(e) {
            e.preventDefault(); zone.classList.remove('drag-over');
            addLovableFiles(Array.from(e.dataTransfer.files).filter(function(f) { return /\.json$/i.test(f.name); }));
        });
    }

    function addLovableFiles(files) {
        var existing = new Set(genState.lovableJsons.map(function(f) { return f.name; }));
        for (var i = 0; i < files.length; i++) { if (!existing.has(files[i].name)) genState.lovableJsons.push(files[i]); }
        renderDropList('#lovableList', genState.lovableJsons, '.json', function(idx) { genState.lovableJsons.splice(idx, 1); renderDropList('#lovableList', genState.lovableJsons, '.json', arguments.callee); refreshGenButtons(); });
        refreshGenButtons();
    }

    function wirePdfDropZone() {
        var zone = $('#pdfDropZone');
        var fileInput = $('#pdfFileInput');
        var browseBtn = $('#pdfBrowseBtn');

        browseBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); fileInput.click(); });
        fileInput.addEventListener('change', function() { addPdfFiles(Array.from(fileInput.files)); fileInput.value = ''; });
        zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', function() { zone.classList.remove('drag-over'); });
        zone.addEventListener('drop', function(e) {
            e.preventDefault(); zone.classList.remove('drag-over');
            addPdfFiles(Array.from(e.dataTransfer.files).filter(function(f) { return /\.pdf$/i.test(f.name); }));
        });
    }

    function addPdfFiles(files) {
        var existing = new Set(genState.pdfs.map(function(f) { return f.name; }));
        for (var i = 0; i < files.length; i++) { if (!existing.has(files[i].name)) genState.pdfs.push(files[i]); }
        renderDropList('#pdfList', genState.pdfs, '.pdf', function(idx) { genState.pdfs.splice(idx, 1); renderDropList('#pdfList', genState.pdfs, '.pdf', arguments.callee); refreshGenButtons(); });
        refreshGenButtons();
    }

    function renderDropList(selector, files, ext, onRemove) {
        var list = $(selector);
        list.innerHTML = '';
        for (var i = 0; i < files.length; i++) {
            (function(idx) {
                var f = files[idx];
                var tag = document.createElement('div');
                tag.className = 'pdf-tag';
                tag.innerHTML = '<span class="pdf-tag-code">' + escapeHtml(f.name.replace(new RegExp(ext.replace('.', '\\.') + '$', 'i'), '')) + '</span>' +
                    '<span class="pdf-tag-size">' + formatSize(f.size) + '</span>';
                var btn = document.createElement('button');
                btn.className = 'pdf-tag-remove';
                btn.textContent = '×';
                btn.title = 'Quitar';
                btn.addEventListener('click', function(e) { e.stopPropagation(); onRemove(idx); });
                tag.appendChild(btn);
                list.appendChild(tag);
            })(i);
        }
    }

    function refreshGenButtons() {
        $('#btnRun').disabled = !genState.matrix;
    }

    async function runGenerate() {
        var statusEl = $('#status');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Procesando...';

        var options = {
            embedPdf: $('#optEmbedPdf').checked,
            strategy: $('#optStrategy').value
        };

        try {
            var t0 = performance.now();
            var out = await InsPipelineBundle.runAll({
                matrixFile: genState.matrix,
                pdfFiles: genState.pdfs,
                catalogsFile: genState.catalogs,
                clientJsonFile: genState.client,
                lovableJsonFiles: genState.lovableJsons
            }, options);
            var t1 = performance.now();

            lastResults = out.results;
            renderResults(out.results);
            renderWarnings(out.results, $('#optVerbose').checked);

            var isEnrich = genState.lovableJsons.length > 0;
            var modeLabel = isEnrich ? 'enriquecido(s)' : 'generado(s)';
            var msg = '✓ Listo. ' + out.results.length + ' JSON ' + modeLabel + ' en ' + Math.round(t1 - t0) + 'ms.';
            if (isEnrich) {
                var totalStats = out.results.reduce(function(acc, r) {
                    if (r.stats) { acc.matched += r.stats.matchCount; acc.missed += r.stats.missCount; }
                    return acc;
                }, { matched: 0, missed: 0 });
                msg += ' (' + totalStats.matched + ' campos matcheados, ' + totalStats.missed + ' sin match)';
            }
            if (!out.hasFormCodeColumn) {
                msg += ' (Tip: Agrega la columna "Código Formulario" a la matriz.)';
            }
            statusEl.className = 'status active success';
            statusEl.textContent = msg;
            $('#btnDownloadAll').hidden = out.results.length < 2;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderResults(results) {
        var panel = $('#resultsPanel');
        var container = $('#results');
        container.innerHTML = '';

        for (var i = 0; i < results.length; i++) {
            (function(r) {
                var sections = (r.json && r.json.data && r.json.data.jsonDefinition && r.json.data.jsonDefinition.sections)
                    || (r.json && r.json.sections)
                    || (r.json && r.json.jsonDefinition && r.json.jsonDefinition.sections)
                    || [];
                var fieldCount = sections.reduce(function(n, s) { return n + s.fields.length; }, 0);
                var card = document.createElement('div');
                card.className = 'result-card';
                card.innerHTML =
                    '<div class="meta">' +
                        '<span class="product-id">' + escapeHtml(r.formCode) + '</span>' +
                        '<span class="product-stats">' +
                            fieldCount + ' campos · ' + sections.length + ' secciones' +
                            ' · ' + r.warnings.length + ' warnings' +
                            ' · ' + r.issues.length + ' prefillKey mismatches' +
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

            lines.push('── ' + r.formCode + ' ──');
            for (var wi = 0; wi < r.warnings.length; wi++) {
                var w = r.warnings[wi];
                lines.push('  [' + w.stage + ':' + w.type + '] ' + (w.field || '') + ' — ' + (w.reason || ''));
            }
            for (var ii = 0; ii < r.issues.length; ii++) {
                var issue = r.issues[ii];
                lines.push('  [prefillKey] ' + issue.field + ' (' + issue.prefillKey + ') — ' + issue.reason);
            }
            lines.push('');
        }

        if (totalW === 0 && totalI === 0) { panel.hidden = true; return; }
        panel.hidden = false;
        summary.textContent = totalW + ' warnings · ' + totalI + ' prefillKey mismatches';
        log.textContent = lines.join('\n') || 'Sin detalles.';
    }

    async function downloadAllAsZip() {
        if (!lastResults || lastResults.length < 2) return;
        var files = lastResults.map(function(r) {
            return { name: r.formCode + '.json', content: JSON.stringify(r.json, null, 2) };
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
            var local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
            var lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
            lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
            lv.setUint32(14, crc, true); lv.setUint32(18, contentBytes.length, true);
            lv.setUint32(22, contentBytes.length, true); lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true); local.set(nameBytes, 30); local.set(contentBytes, 30 + nameBytes.length);
            localHeaders.push(local);
            var central = new Uint8Array(46 + nameBytes.length);
            var cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
            cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true);
            cv.setUint16(14, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, contentBytes.length, true);
            cv.setUint32(24, contentBytes.length, true); cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true); cv.setUint32(38, 0x20, true); cv.setUint32(42, offset, true);
            central.set(nameBytes, 46); centralHeaders.push(central);
            offset += local.length;
        }
        var centralSize = centralHeaders.reduce(function(s, c) { return s + c.length; }, 0);
        var eocd = new Uint8Array(22);
        var ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
        ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
        return new Blob(localHeaders.concat(centralHeaders).concat([eocd]), { type: 'application/zip' });
    }

    function crc32(bytes) {
        var table = crc32.table;
        if (!table) {
            table = crc32.table = new Uint32Array(256);
            for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); } table[n] = c; }
        }
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) { crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8); }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // ==================== CONVERT PDF FLOW ====================

    var convState = {
        pdf: null,
        excel: null,
        refJson: null,
        pdfBytes: null,
        matches: null,
        preview: null
    };

    function initConvertPdfFlow() {
        $('#convPdfInput').addEventListener('change', function(e) {
            convState.pdf = e.target.files[0] || null;
            updateConvFileStatus('convPdfStatus', convState.pdf);
            refreshConvButtons();
        });
        $('#convExcelInput').addEventListener('change', function(e) {
            convState.excel = e.target.files[0] || null;
            updateConvFileStatus('convExcelStatus', convState.excel);
            refreshConvButtons();
        });
        $('#convRefInput').addEventListener('change', function(e) {
            convState.refJson = e.target.files[0] || null;
            updateConvFileStatus('convRefStatus', convState.refJson);
        });

        $('#btnAnalyze').addEventListener('click', runAnalysis);
        $('#btnGeneratePdf').addEventListener('click', runExport);
        $('#filterUnmatched').addEventListener('change', function() {
            renderMatchTable(convState.matches, this.checked);
        });
    }

    function updateConvFileStatus(id, file) {
        var el = $('#' + id);
        var slot = el.closest('.file-slot');
        if (file) {
            slot.classList.add('loaded');
            el.textContent = '✓ ' + file.name + ' (' + formatSize(file.size) + ')';
        } else {
            slot.classList.remove('loaded');
            el.textContent = '';
        }
    }

    function refreshConvButtons() {
        $('#btnAnalyze').disabled = !(convState.pdf && convState.excel);
    }

    async function runAnalysis() {
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Analizando PDF...';

        try {
            var t0 = performance.now();
            var result = await InsPipelineBundle.runConvertAnalysis({
                pdfFile: convState.pdf,
                matrixFile: convState.excel,
                referenceJsonFile: convState.refJson
            });
            var t1 = performance.now();

            convState.pdfBytes = result.pdfBytes;
            convState.matches = result.matches;

            if (convState.preview) {
                convState.preview.destroy();
                convState.preview = null;
            }

            renderMatchTable(result.matches, false);
            renderConvWarnings(result.warnings);

            var s = result.stats;
            statusEl.className = 'status active success';
            statusEl.textContent = '✓ Analisis completo en ' + Math.round(t1 - t0) + 'ms. ' +
                s.totalFields + ' campos, ' + s.withLabel + ' con label, ' +
                s.matched + ' matcheados, ' + s.unchanged + ' sin match.';

            $('#splitView').hidden = false;
            $('#convExportPanel').hidden = false;

            statusEl.textContent += ' Renderizando preview...';
            var previewContainer = $('#pdfPreview');
            previewContainer.innerHTML = '';
            convState.preview = await InsPipelineBundle.renderPreview(
                convState.pdfBytes, result.matches, previewContainer
            );
            convState.preview.onFieldClick(function(fieldName) {
                var row = document.querySelector('#matchTableBody tr[data-field-name="' + CSS.escape(fieldName) + '"]');
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.classList.add('row-highlight');
                    setTimeout(function() { row.classList.remove('row-highlight'); }, 2000);
                }
            });
            statusEl.textContent = '✓ Analisis completo en ' + Math.round(t1 - t0) + 'ms. ' +
                s.totalFields + ' campos, ' + s.withLabel + ' con label, ' +
                s.matched + ' matcheados, ' + s.unchanged + ' sin match.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderMatchTable(matches, filterUnmatched) {
        var tbody = $('#matchTableBody');
        tbody.innerHTML = '';

        var shown = filterUnmatched
            ? matches.filter(function(m) { return m.source === 'unchanged'; })
            : matches;

        var stats = $('#matchStats');
        var matched = matches.filter(function(m) { return m.source !== 'unchanged'; }).length;
        stats.textContent = matched + '/' + matches.length + ' matcheados';

        for (var i = 0; i < shown.length; i++) {
            (function(m, idx) {
                var globalIdx = matches.indexOf(m);
                var tr = document.createElement('tr');
                tr.dataset.fieldName = m.originalName;
                if (m.source === 'unchanged') tr.className = 'row-unchanged';

                tr.addEventListener('mouseenter', function() {
                    if (convState.preview) convState.preview.highlightField(m.originalName);
                });
                tr.addEventListener('mouseleave', function() {
                    if (convState.preview) convState.preview.clearHighlights();
                });

                var confClass = m.confidence >= 80 ? 'conf-high' : (m.confidence >= 50 ? 'conf-mid' : 'conf-low');

                tr.innerHTML =
                    '<td>' + (m.page + 1) + '</td>' +
                    '<td class="original-name">' + escapeHtml(m.originalName) + '</td>' +
                    '<td class="detected-label">' + escapeHtml(m.detectedLabel || '—') + '</td>' +
                    '<td></td>' +
                    '<td><span class="source-badge ' + m.source + '">' + escapeHtml(m.source) + '</span></td>' +
                    '<td class="conf ' + confClass + '">' + m.confidence + '</td>';

                var nameCell = tr.children[3];
                var input = document.createElement('input');
                input.type = 'text';
                input.className = 'name-input';
                input.value = m.newName;
                input.addEventListener('change', function() {
                    matches[globalIdx].newName = this.value.trim() || m.originalName;
                    if (matches[globalIdx].newName !== m.originalName) {
                        matches[globalIdx].source = 'manual';
                        matches[globalIdx].confidence = 100;
                    }
                });
                nameCell.appendChild(input);

                tbody.appendChild(tr);
            })(shown[i], i);
        }
    }

    function renderConvWarnings(warnings) {
        var panel = $('#convWarningsPanel');
        if (!warnings.length) { panel.hidden = true; return; }

        panel.hidden = false;
        $('#convWarningsSummary').textContent = warnings.length + ' warnings';
        var lines = warnings.map(function(w) {
            return '  [' + (w.type || 'warn') + '] ' + (w.field || '') + ' — ' + (w.reason || '');
        });
        $('#convWarningsLog').textContent = lines.join('\n');
    }

    async function runExport() {
        var statusEl = $('#convExportStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Generando PDF...';

        try {
            var result = await InsPipelineBundle.runConvertGenerate(convState.pdfBytes, convState.matches);

            var blob = new Blob([result.pdfBytes], { type: 'application/pdf' });
            var fileName = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'converted') + '_renamed.pdf';
            InsPipelineBundle.downloadBlob(blob, fileName);

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ PDF generado. ' + result.renamedCount + ' campos renombrados. Descargando...';

            if (result.warnings.length) {
                renderConvWarnings(result.warnings);
            }
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    // ==================== PDF TO HTML FLOW ====================

    var htmlState = {
        pdf: null,
        excel: null
    };

    function initPdfToHtmlFlow() {
        $('#htmlPdfInput').addEventListener('change', function(e) {
            htmlState.pdf = e.target.files[0] || null;
            updateConvFileStatus('htmlPdfStatus', htmlState.pdf);
            refreshHtmlButton();
        });
        $('#htmlExcelInput').addEventListener('change', function(e) {
            htmlState.excel = e.target.files[0] || null;
            updateConvFileStatus('htmlExcelStatus', htmlState.excel);
            refreshHtmlButton();
        });
        $('#btnGenerateHtmlDirect').addEventListener('click', runDirectHtmlExport);
    }

    function refreshHtmlButton() {
        $('#btnGenerateHtmlDirect').disabled = !(htmlState.pdf && htmlState.excel);
    }

    async function runDirectHtmlExport() {
        var statusEl = $('#htmlStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Analizando PDF y generando HTML...';

        try {
            var t0 = performance.now();
            var result = await InsPipelineBundle.runConvertAnalysis({
                pdfFile: htmlState.pdf,
                matrixFile: htmlState.excel,
                referenceJsonFile: null
            });

            statusEl.textContent = '⟳ Renderizando paginas...';
            var html = await InsPipelineBundle.generateHtml(result.pdfBytes, result.matches);
            var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            var fileName = (htmlState.pdf ? htmlState.pdf.name.replace(/\.pdf$/i, '') : 'formulario') + '.html';
            InsPipelineBundle.downloadBlob(blob, fileName);

            var t1 = performance.now();
            var s = result.stats;
            statusEl.className = 'status active success';
            statusEl.textContent = '✓ HTML generado en ' + Math.round(t1 - t0) + 'ms — ' +
                s.totalFields + ' campos, ' + s.matched + ' matcheados. Descargando...';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    // ==================== INIT ====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
