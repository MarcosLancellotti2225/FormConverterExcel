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
        initEnrichJsonFlow();
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
        $('#enrichJsonFlow').hidden = mode !== 'enrich-json';
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

    // ==================== ENRICH JSON FLOW ====================

    var enrichState = {
        lovableJson: null,
        matrix: null,
        catalogs: null,
        client: null,
        result: null
    };

    function initEnrichJsonFlow() {
        $('#enrichLovableInput').addEventListener('change', function(e) {
            enrichState.lovableJson = e.target.files[0] || null;
            updateEnrichFileStatus('enrichLovableStatus', enrichState.lovableJson);
            refreshEnrichButton();
        });
        $('#enrichMatrixInput').addEventListener('change', function(e) {
            enrichState.matrix = e.target.files[0] || null;
            updateEnrichFileStatus('enrichMatrixStatus', enrichState.matrix);
            refreshEnrichButton();
        });
        $('#enrichCatalogsInput').addEventListener('change', function(e) {
            enrichState.catalogs = e.target.files[0] || null;
            updateEnrichFileStatus('enrichCatalogsStatus', enrichState.catalogs);
        });
        $('#enrichClientInput').addEventListener('change', function(e) {
            enrichState.client = e.target.files[0] || null;
            updateEnrichFileStatus('enrichClientStatus', enrichState.client);
        });

        $('#btnEnrich').addEventListener('click', runEnrich);
        $('#btnDownloadEnriched').addEventListener('click', downloadEnriched);
        $('#btnEnrichDebug').addEventListener('click', exportEnrichDebug);
    }

    function updateEnrichFileStatus(id, file) {
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

    function refreshEnrichButton() {
        $('#btnEnrich').disabled = !(enrichState.lovableJson && enrichState.matrix);
    }

    async function runEnrich() {
        var statusEl = $('#enrichStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Procesando...';

        try {
            var t0 = performance.now();
            var result = await InsPipelineBundle.runEnrichJson({
                lovableJsonFile: enrichState.lovableJson,
                matrixFile: enrichState.matrix,
                catalogsFile: enrichState.catalogs,
                clientJsonFile: enrichState.client
            });
            var t1 = performance.now();

            enrichState.result = result;

            var s = result.stats;
            statusEl.className = 'status active success';
            statusEl.textContent = '✓ Enriquecido en ' + Math.round(t1 - t0) + 'ms. ' +
                s.matchCount + '/' + s.totalLovable + ' campos matcheados, ' +
                s.sectionsCreated + ' secciones creadas.';

            renderEnrichStats(result);
            renderEnrichWarnings(result.warnings, result.issues);

            $('#btnDownloadEnriched').hidden = false;
            $('#btnEnrichDebug').hidden = false;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderEnrichStats(result) {
        var panel = $('#enrichStatsPanel');
        var container = $('#enrichStats');
        var s = result.stats;
        var sections = extractSections(result.json);
        var withRequired = 0;
        var withValidation = 0;
        var withOptions = 0;
        var withPrefill = 0;
        var withConditional = 0;
        var types = {};

        for (var si = 0; si < sections.length; si++) {
            var fields = sections[si].fields;
            for (var fi = 0; fi < fields.length; fi++) {
                var f = fields[fi];
                if (f.required) withRequired++;
                if (f.validationPattern || f.maxLength) withValidation++;
                if (f.options && f.options.length > 0) withOptions++;
                if (f.prefillKey) withPrefill++;
                if (f.conditionalVisibility) withConditional++;
                types[f.type] = (types[f.type] || 0) + 1;
            }
        }

        var typeList = Object.keys(types).map(function(t) { return t + ': ' + types[t]; }).join(', ');

        container.innerHTML =
            '<div class="stat-grid">' +
                '<div class="stat"><span class="stat-n">' + s.matchCount + '/' + s.totalLovable + '</span><span class="stat-l">Campos matcheados</span></div>' +
                '<div class="stat"><span class="stat-n">' + s.sectionsCreated + '</span><span class="stat-l">Secciones</span></div>' +
                '<div class="stat"><span class="stat-n">' + withRequired + '</span><span class="stat-l">Con required</span></div>' +
                '<div class="stat"><span class="stat-n">' + withValidation + '</span><span class="stat-l">Con validacion</span></div>' +
                '<div class="stat"><span class="stat-n">' + withOptions + '</span><span class="stat-l">Con opciones</span></div>' +
                '<div class="stat"><span class="stat-n">' + withPrefill + '</span><span class="stat-l">Con prefillKey</span></div>' +
                '<div class="stat"><span class="stat-n">' + withConditional + '</span><span class="stat-l">Con condicional</span></div>' +
            '</div>' +
            '<p class="hint">Tipos: ' + escapeHtml(typeList) + '</p>';
        panel.hidden = false;
    }

    function extractSections(json) {
        if (json && json.data && json.data.jsonDefinition && json.data.jsonDefinition.sections) return json.data.jsonDefinition.sections;
        if (json && json.sections) return json.sections;
        if (json && json.jsonDefinition && json.jsonDefinition.sections) return json.jsonDefinition.sections;
        return [];
    }

    function renderEnrichWarnings(warnings, issues) {
        var panel = $('#enrichWarningsPanel');
        if (!warnings.length && !issues.length) { panel.hidden = true; return; }

        var byType = {};
        for (var i = 0; i < warnings.length; i++) {
            var w = warnings[i];
            var t = w.type || 'other';
            if (!byType[t]) byType[t] = [];
            byType[t].push(w);
        }

        var lines = [];
        var typeOrder = ['no-match', 'low-confidence', 'rule-not-parsed', 'prefillkey-invalid', 'catalog-missing'];
        var allTypes = Object.keys(byType);
        var ordered = typeOrder.filter(function(t) { return byType[t]; })
            .concat(allTypes.filter(function(t) { return typeOrder.indexOf(t) === -1; }));

        for (var ti = 0; ti < ordered.length; ti++) {
            var type = ordered[ti];
            var arr = byType[type];
            if (!arr) continue;
            lines.push('── ' + type + ' (' + arr.length + ') ──');
            for (var wi = 0; wi < arr.length; wi++) {
                lines.push('  [' + (arr[wi].stage || '') + ':' + arr[wi].type + '] ' + (arr[wi].field || '') + ' — ' + (arr[wi].reason || ''));
            }
            lines.push('');
        }

        if (issues.length) {
            lines.push('── prefillKey mismatches (' + issues.length + ') ──');
            for (var ii = 0; ii < issues.length; ii++) {
                lines.push('  [prefillKey] ' + issues[ii].field + ' (' + issues[ii].prefillKey + ') — ' + issues[ii].reason);
            }
        }

        panel.hidden = false;
        $('#enrichWarningsSummary').textContent = warnings.length + ' warnings · ' + issues.length + ' prefillKey mismatches';
        $('#enrichWarningsLog').textContent = lines.join('\n') || 'Sin detalles.';
    }

    function downloadEnriched() {
        if (!enrichState.result) return;
        var blob = InsPipelineBundle.jsonToBlob(enrichState.result.json);
        var name = (enrichState.lovableJson ? enrichState.lovableJson.name.replace(/\.json$/i, '') : 'enriched') + '_enriched.json';
        InsPipelineBundle.downloadBlob(blob, name);
    }

    function exportEnrichDebug() {
        if (!enrichState.result) return;
        var r = enrichState.result;
        var sections = extractSections(r.json);
        var fields = [];
        for (var si = 0; si < sections.length; si++) {
            var sec = sections[si];
            for (var fi = 0; fi < sec.fields.length; fi++) {
                var f = sec.fields[fi];
                fields.push({
                    id: f.id,
                    label: f.label,
                    sourceName: f.sourceMeta ? f.sourceMeta.sourceName : null,
                    section: sec.title,
                    type: f.type,
                    required: !!f.required,
                    readOnly: !!f.readOnly,
                    hasOptions: !!(f.options && f.options.length),
                    optionCount: f.options ? f.options.length : 0,
                    hasValidation: !!(f.validationPattern || f.maxLength),
                    validationPattern: f.validationPattern || null,
                    maxLength: f.maxLength || null,
                    prefillKey: f.prefillKey || null,
                    hasConditional: !!f.conditionalVisibility
                });
            }
        }

        var debug = {
            mode: 'enrich-json',
            timestamp: new Date().toISOString(),
            stats: r.stats,
            warnings: r.warnings,
            issues: r.issues || [],
            fields: fields
        };

        var blob = new Blob([JSON.stringify(debug, null, 2)], { type: 'application/json' });
        var name = (enrichState.lovableJson ? enrichState.lovableJson.name.replace(/\.json$/i, '') : 'enrich') + '_debug.json';
        InsPipelineBundle.downloadBlob(blob, name);
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
        $('#btnConvDebug').addEventListener('click', exportConvDebug);
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

    function exportConvDebug() {
        if (!convState.matches) return;
        var matched = convState.matches.filter(function(m) { return m.source !== 'unchanged'; });
        var unchanged = convState.matches.filter(function(m) { return m.source === 'unchanged'; });
        var bySrc = {};
        convState.matches.forEach(function(m) { bySrc[m.source] = (bySrc[m.source] || 0) + 1; });

        var debug = {
            mode: 'convert-pdf',
            timestamp: new Date().toISOString(),
            stats: {
                total: convState.matches.length,
                matched: matched.length,
                unchanged: unchanged.length,
                bySource: bySrc
            },
            matches: convState.matches.map(function(m) {
                return {
                    originalName: m.originalName,
                    detectedLabel: m.detectedLabel || null,
                    newName: m.newName,
                    source: m.source,
                    confidence: m.confidence,
                    page: m.page + 1,
                    type: m.type
                };
            })
        };

        var blob = new Blob([JSON.stringify(debug, null, 2)], { type: 'application/json' });
        var name = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'convert') + '_debug.json';
        InsPipelineBundle.downloadBlob(blob, name);
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
