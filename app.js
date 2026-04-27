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
        initMatrixEditorFlow();
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
        $('#matrixEditorFlow').hidden = mode !== 'matrix-editor';
        $('#btnBackToHome').hidden = !mode;
    }

    function formatSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
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
        preview: null,
        sortedIndices: [],
        navIndex: -1
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
        $('#btnPrevField').addEventListener('click', function() { navigateField(-1); });
        $('#btnNextField').addEventListener('click', function() { navigateField(1); });
        document.addEventListener('keydown', function(e) {
            if (currentMode !== 'convert-pdf' || !convState.matches) return;
            if (e.target.tagName === 'INPUT' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey && e.target.closest('.match-table'))) {
                e.preventDefault();
                navigateField(1);
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && e.target.closest('.match-table'))) {
                e.preventDefault();
                navigateField(-1);
            }
        });
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

        var sorted = matches.map(function(m, i) { return i; });
        sorted.sort(function(a, b) {
            var ma = matches[a], mb = matches[b];
            if (ma.page !== mb.page) return ma.page - mb.page;
            if (ma.rect && mb.rect) return mb.rect.y - ma.rect.y;
            return 0;
        });

        convState.sortedIndices = sorted;
        convState.navIndex = -1;

        var shown = filterUnmatched
            ? sorted.filter(function(i) { return matches[i].source === 'unchanged'; })
            : sorted;

        var stats = $('#matchStats');
        var matched = matches.filter(function(m) { return m.source !== 'unchanged'; }).length;
        stats.textContent = matched + '/' + matches.length + ' matcheados';

        updateNavButtons();

        for (var si = 0; si < shown.length; si++) {
            (function(globalIdx) {
                var m = matches[globalIdx];
                var tr = document.createElement('tr');
                tr.dataset.fieldName = m.originalName;
                tr.dataset.globalIdx = globalIdx;
                if (m.source === 'unchanged') tr.className = 'row-unchanged';

                tr.addEventListener('mouseenter', function() {
                    if (convState.preview) convState.preview.highlightField(m.originalName);
                });
                tr.addEventListener('mouseleave', function() {
                    if (convState.preview) convState.preview.clearHighlights();
                });
                tr.addEventListener('click', function(e) {
                    if (e.target.tagName === 'INPUT') return;
                    var navPos = convState.sortedIndices.indexOf(globalIdx);
                    if (navPos >= 0) {
                        convState.navIndex = navPos;
                        activateNavField();
                    }
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
                    var newVal = this.value.trim() || m.originalName;
                    matches[globalIdx].newName = newVal;
                    if (newVal !== m.originalName) {
                        matches[globalIdx].source = 'manual';
                        matches[globalIdx].confidence = 100;
                        tr.className = tr.className.replace(/\brow-unchanged\b/, '').trim();
                        tr.classList.add('row-manual');
                        var badge = tr.querySelector('.source-badge');
                        if (badge) { badge.className = 'source-badge manual'; badge.textContent = 'manual'; }
                        var conf = tr.querySelector('.conf');
                        if (conf) { conf.className = 'conf conf-high'; conf.textContent = '100'; }
                        if (convState.preview) {
                            convState.preview.markMatched(m.originalName);
                            convState.preview.updateTooltip(m.originalName, newVal);
                        }
                    }
                    updateNavStats();
                });
                nameCell.appendChild(input);

                tbody.appendChild(tr);
            })(shown[si]);
        }
    }

    function navigateField(delta) {
        if (!convState.matches || !convState.sortedIndices.length) return;
        var newIdx = convState.navIndex + delta;
        if (newIdx < 0) newIdx = 0;
        if (newIdx >= convState.sortedIndices.length) newIdx = convState.sortedIndices.length - 1;
        convState.navIndex = newIdx;
        activateNavField();
    }

    function activateNavField() {
        var idx = convState.navIndex;
        if (idx < 0 || !convState.matches) return;
        var globalIdx = convState.sortedIndices[idx];
        var m = convState.matches[globalIdx];

        $$('#matchTableBody tr.row-active').forEach(function(r) { r.classList.remove('row-active'); });

        var row = document.querySelector('#matchTableBody tr[data-global-idx="' + globalIdx + '"]');
        if (row) {
            row.classList.add('row-active');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var input = row.querySelector('input.name-input');
            if (input) input.focus();
        }

        if (convState.preview) {
            convState.preview.highlightField(m.originalName);
        }

        updateNavButtons();
    }

    function updateNavButtons() {
        var total = convState.sortedIndices.length;
        var cur = convState.navIndex;
        $('#btnPrevField').disabled = cur <= 0;
        $('#btnNextField').disabled = cur >= total - 1;
        $('#fieldNavCounter').textContent = (cur >= 0 ? (cur + 1) : 0) + ' / ' + total;
    }

    function updateNavStats() {
        if (!convState.matches) return;
        var matched = convState.matches.filter(function(m) { return m.source !== 'unchanged'; }).length;
        $('#matchStats').textContent = matched + '/' + convState.matches.length + ' matcheados';
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

    // ==================== MATRIX EDITOR FLOW ====================

    var mtxState = {
        file: null,
        pdfFiles: [],
        catalogosFile: null,
        catalogos: null,
        originalRows: null,
        rows: null,
        analyzed: null,
        stats: null,
        matchResults: null,
        crossStats: null,
        acroFields: null,
        hasPdf: false
    };

    var MTX_COLUMNS_BASE = [
        'Pasos Formulario', 'Sección', 'Nombre en PDF',
        'Nombre del campo en formulario', 'Tipo de dato', 'Valor',
        'Regla', 'Obligatorio', 'Formulario a visualizar',
        'Visualización en Formularios', 'Observaciones',
        'Nombre del Campo en Json', 'Nombre del Campo en PDF', 'Formulario'
    ];

    var MTX_PDF_COLUMNS = ['PDF AcroForm Name', 'PDF Tipo Nativo', 'PDF Página', 'PDF Rect'];

    var MTX_COLUMNS = MTX_COLUMNS_BASE;

    var MTX_SHORT_BASE = [
        'Paso', 'Sección', 'Nombre PDF', 'Campo Form', 'Tipo', 'Valor',
        'Regla', 'Oblig', 'Form Vis', 'Visualiz', 'Obs',
        'Campo Json', 'Campo PDF', 'Form'
    ];

    var MTX_SHORT_PDF = ['AcroForm', 'Tipo Nat', 'Pag', 'Rect'];

    var MTX_SHORT = MTX_SHORT_BASE;

    function initMatrixEditorFlow() {
        $('#mtxExcelInput').addEventListener('change', function(e) {
            mtxState.file = e.target.files[0] || null;
            var el = $('#mtxExcelStatus');
            var slot = el.closest('.file-slot');
            if (mtxState.file) {
                slot.classList.add('loaded');
                el.textContent = '✓ ' + mtxState.file.name + ' (' + formatSize(mtxState.file.size) + ')';
            } else {
                slot.classList.remove('loaded');
                el.textContent = '';
            }
            $('#btnMtxAnalyze').disabled = !mtxState.file;
        });
        $('#mtxPdfInput').addEventListener('change', function(e) {
            mtxState.pdfFiles = Array.from(e.target.files || []);
            var el = $('#mtxPdfStatus');
            var slot = el.closest('.file-slot');
            if (mtxState.pdfFiles.length > 0) {
                slot.classList.add('loaded');
                var names = mtxState.pdfFiles.map(function(f) { return f.name; });
                el.textContent = '✓ ' + mtxState.pdfFiles.length + ' PDF' + (mtxState.pdfFiles.length > 1 ? 's' : '') + ': ' + names.join(', ');
            } else {
                slot.classList.remove('loaded');
                el.textContent = '';
            }
        });
        $('#mtxCatalogosInput').addEventListener('change', function(e) {
            mtxState.catalogosFile = e.target.files[0] || null;
            mtxState.catalogos = null;
            var el = $('#mtxCatalogosStatus');
            var slot = el.closest('.file-slot');
            if (mtxState.catalogosFile) {
                slot.classList.add('loaded');
                el.textContent = '✓ ' + mtxState.catalogosFile.name;
            } else {
                slot.classList.remove('loaded');
                el.textContent = '';
            }
        });
        $('#btnMtxAnalyze').addEventListener('click', runMtxAnalyze);
        $('#btnMtxSplitAll').addEventListener('click', mtxSplitAll);
        $('#btnMtxDerivePdf').addEventListener('click', mtxDerivePdf);
        $('#btnMtxNormOblig').addEventListener('click', mtxNormOblig);
        $('#btnMtxAcceptAll').addEventListener('click', mtxAcceptAll);
        $('#btnMtxReset').addEventListener('click', mtxReset);
        $('#btnMtxExport').addEventListener('click', mtxExport);
        $('#btnMtxExportByForm').addEventListener('click', mtxExportByForm);
    }

    async function runMtxAnalyze() {
        var statusEl = $('#mtxStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Analizando matriz...';

        try {
            var t0 = performance.now();
            var result = await InsPipelineBundle.runMatrixAnalysis({ matrixFile: mtxState.file });

            mtxState.originalRows = JSON.parse(JSON.stringify(result.rows));
            mtxState.rows = result.rows;
            mtxState.analyzed = result.analyzed;
            mtxState.stats = result.stats;
            mtxState.hasPdf = mtxState.pdfFiles.length > 0;

            if (mtxState.hasPdf) {
                MTX_COLUMNS = MTX_COLUMNS_BASE.concat(MTX_PDF_COLUMNS);
                MTX_SHORT = MTX_SHORT_BASE.concat(MTX_SHORT_PDF);
                statusEl.textContent = '⟳ Cruzando con ' + mtxState.pdfFiles.length + ' PDF' + (mtxState.pdfFiles.length > 1 ? 's' : '') + '...';
                var crossResult = await InsPipelineBundle.matrixCrossWithPdfs(mtxState.rows, mtxState.pdfFiles);
                mtxState.matchResults = crossResult.matchResults;
                mtxState.crossStats = crossResult.crossStats;
                mtxState.acroFields = crossResult.acroFields;
            } else {
                MTX_COLUMNS = MTX_COLUMNS_BASE;
                MTX_SHORT = MTX_SHORT_BASE;
                mtxState.matchResults = null;
                mtxState.crossStats = null;
                mtxState.acroFields = null;
            }

            var t1 = performance.now();

            statusEl.className = 'status active success';
            var msg = '✓ Analisis en ' + Math.round(t1 - t0) + 'ms — ' + result.stats.total + ' filas cargadas.';
            if (mtxState.hasPdf && mtxState.crossStats) {
                msg += ' Cruce PDF: ' + mtxState.crossStats.matchHigh + ' alto, ' +
                    mtxState.crossStats.matchMed + ' medio, ' +
                    mtxState.crossStats.matchLow + ' bajo, ' +
                    mtxState.crossStats.noMatch + ' sin match.';
            }
            statusEl.textContent = msg;

            renderMtxStats(result.stats);
            if (mtxState.hasPdf && mtxState.crossStats) {
                renderCrossStats(mtxState.crossStats);
            } else {
                $('#mtxCrossStats').hidden = true;
            }
            renderMtxTable(mtxState.rows, result.analyzed);
            enableMtxActions(result.stats);
            $('#mtxResultPanel').hidden = false;
            $('#mtxExportPanel').hidden = false;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderMtxStats(stats) {
        var el = $('#mtxStats');
        el.innerHTML =
            '<div class="stat"><span class="stat-n">' + stats.total + '</span><span class="stat-l">Filas totales</span></div>' +
            '<div class="stat' + (stats.ambiguous ? ' stat-warn' : '') + '"><span class="stat-n">' + stats.ambiguous + '</span><span class="stat-l">Ambiguas</span></div>' +
            '<div class="stat' + (stats.missingPdfField ? ' stat-warn' : '') + '"><span class="stat-n">' + stats.missingPdfField + '</span><span class="stat-l">Sin nombre PDF</span></div>' +
            '<div class="stat' + (stats.obligatorioToFix ? ' stat-warn' : '') + '"><span class="stat-n">' + stats.obligatorioToFix + '</span><span class="stat-l">Obligatorio a fix</span></div>';
    }

    function renderCrossStats(cs) {
        var el = $('#mtxCrossStats');
        el.hidden = false;
        el.innerHTML =
            '<div class="stat"><span class="stat-n">' + cs.totalExcel + '</span><span class="stat-l">Filas Excel</span></div>' +
            '<div class="stat"><span class="stat-n">' + cs.totalAcro + '</span><span class="stat-l">AcroForm PDF</span></div>' +
            '<div class="stat stat-match-high"><span class="stat-n">' + cs.matchHigh + '</span><span class="stat-l">Match alto (&ge;85)</span></div>' +
            '<div class="stat stat-match-med"><span class="stat-n">' + cs.matchMed + '</span><span class="stat-l">Match medio (70-84)</span></div>' +
            '<div class="stat stat-match-low"><span class="stat-n">' + cs.matchLow + '</span><span class="stat-l">Bajo / ambiguo</span></div>' +
            '<div class="stat' + (cs.noMatch ? ' stat-warn' : '') + '"><span class="stat-n">' + cs.noMatch + '</span><span class="stat-l">Sin match PDF</span></div>' +
            '<div class="stat' + (cs.orphanFields ? ' stat-warn' : '') + '"><span class="stat-n">' + cs.orphanFields + '</span><span class="stat-l">PDF huerfano</span></div>';
    }

    function getMatchClass(row) {
        var conf = row['_matchConfidence'] || 0;
        if (!mtxState.hasPdf) return '';
        if (conf >= 85) return 'mtx-match-high';
        if (conf >= 70) return 'mtx-match-med';
        if (conf > 0) return 'mtx-match-low';
        return 'mtx-match-none';
    }

    function renderMtxTable(rows, analyzed) {
        var thead = $('#mtxTableHead');
        var tbody = $('#mtxTableBody');
        var matchCol = mtxState.hasPdf ? '<th>Match</th>' : '';
        thead.innerHTML = '<tr><th>#</th>' + matchCol + MTX_SHORT.map(function(h) {
            return '<th>' + escapeHtml(h) + '</th>';
        }).join('') + '</tr>';
        tbody.innerHTML = '';

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var a = analyzed && analyzed[i] ? analyzed[i] : { issues: [] };
            var hasAmbig = a.issues.some(function(is) { return is.type === 'ambiguous_pdf_name'; });
            var hasMissing = a.issues.some(function(is) { return is.type === 'missing_pdf_field'; });
            var hasOblig = a.issues.some(function(is) { return is.type === 'obligatorio_case'; });
            var matchCls = getMatchClass(row);
            var issueCls = hasAmbig ? 'mtx-row-warn' : (hasMissing || hasOblig ? 'mtx-row-info' : '');
            var cls = [issueCls, matchCls].filter(Boolean).join(' ');

            var tr = document.createElement('tr');
            if (cls) tr.className = cls;

            var cells = '<td class="mtx-rownum">' + (i + 1) + '</td>';

            if (mtxState.hasPdf) {
                var conf = row['_matchConfidence'] || 0;
                var src = row['_matchSource'] || '';
                var mr = mtxState.matchResults && mtxState.matchResults[i] ? mtxState.matchResults[i] : null;
                var isAmbiguous = mr && mr.match && mr.match.candidates && !mr.match.field;
                var dot = '';
                if (conf >= 85) dot = '<span class="mtx-dot mtx-dot-high" title="' + conf + '% ' + src + '"></span>';
                else if (conf >= 70) dot = '<span class="mtx-dot mtx-dot-med" title="' + conf + '% ' + src + '"></span>';
                else if (isAmbiguous) dot = '<span class="mtx-dot mtx-dot-ambig" title="Ambiguo — elegir"></span>';
                else if (conf > 0) dot = '<span class="mtx-dot mtx-dot-low" title="' + conf + '% ' + src + '"></span>';
                else dot = '<span class="mtx-dot mtx-dot-none" title="Sin match"></span>';
                cells += '<td class="mtx-match-cell">' + dot + '</td>';
            }

            for (var ci = 0; ci < MTX_COLUMNS.length; ci++) {
                var col = MTX_COLUMNS[ci];
                var val = String(row[col] != null ? row[col] : '');

                if (col === 'PDF AcroForm Name' && mtxState.hasPdf) {
                    var mr2 = mtxState.matchResults && mtxState.matchResults[i] ? mtxState.matchResults[i] : null;
                    var isAmb = mr2 && mr2.match && mr2.match.candidates && !mr2.match.field;
                    if (isAmb) {
                        var opts = '<option value="">— elegir —</option>';
                        for (var ci2 = 0; ci2 < mr2.match.candidates.length; ci2++) {
                            var c = mr2.match.candidates[ci2];
                            var lbl = c.name + (c.detectedLabel ? ' (' + c.detectedLabel + ')' : '');
                            opts += '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(lbl) + '</option>';
                        }
                        cells += '<td><select class="mtx-cell mtx-cell-select" data-row="' + i + '" data-col="' + escapeHtml(col) + '">' + opts + '</select></td>';
                        continue;
                    }
                }

                cells += '<td><input type="text" class="mtx-cell" data-row="' + i + '" data-col="' + escapeHtml(col) + '" value="' + escapeHtml(val) + '"></td>';
            }
            tr.innerHTML = cells;
            tbody.appendChild(tr);
        }

        tbody.addEventListener('change', function(e) {
            if (e.target.classList.contains('mtx-cell')) {
                var ri = parseInt(e.target.dataset.row, 10);
                var col = e.target.dataset.col;
                if (mtxState.rows[ri]) {
                    mtxState.rows[ri][col] = e.target.value;
                    if (col === 'PDF AcroForm Name' && e.target.tagName === 'SELECT' && e.target.value) {
                        resolveAmbiguousMatch(ri, e.target.value);
                    }
                }
            }
        });
    }

    function resolveAmbiguousMatch(rowIdx, selectedFieldName) {
        var mr = mtxState.matchResults && mtxState.matchResults[rowIdx] ? mtxState.matchResults[rowIdx] : null;
        if (!mr || !mr.match || !mr.match.candidates) return;
        var field = mr.match.candidates.find(function(c) { return c.name === selectedFieldName; });
        if (!field) return;
        var row = mtxState.rows[rowIdx];
        var rectStr = field.rect
            ? field.rect.x + ',' + field.rect.y + ',' + (field.rect.width || 0) + ',' + (field.rect.height || 0)
            : '';
        row['Nombre del Campo en PDF'] = field.name;
        row['PDF AcroForm Name'] = field.name;
        row['PDF Tipo Nativo'] = mapNativeTypeUI(field.type || '');
        row['PDF Página'] = field.page != null ? field.page + 1 : '';
        row['PDF Rect'] = rectStr;
        row['_matchConfidence'] = 90;
        row['_matchSource'] = 'manual-select';
        mr.match = { field: field, confidence: 90, source: 'manual-select' };
    }

    function mapNativeTypeUI(t) {
        var low = String(t || '').toLowerCase();
        if (low === 'text' || /text/i.test(low)) return 'Tx';
        if (low === 'checkbox' || /check/i.test(low)) return 'Ch';
        if (low === 'radio' || /radio/i.test(low)) return 'Btn';
        if (low === 'button' || /button/i.test(low)) return 'Btn';
        if (low === 'select' || /drop|option/i.test(low)) return 'Ch';
        return low.substring(0, 3);
    }

    function enableMtxActions(stats) {
        $('#btnMtxSplitAll').disabled = stats.ambiguous === 0;
        $('#btnMtxDerivePdf').disabled = stats.missingPdfField === 0;
        $('#btnMtxNormOblig').disabled = stats.obligatorioToFix === 0;
        $('#btnMtxAcceptAll').disabled = !mtxState.hasPdf;
        $('#btnMtxReset').disabled = false;
    }

    function mtxAcceptAll() {
        if (!mtxState.matchResults) return;
        var count = 0;
        for (var i = 0; i < mtxState.matchResults.length; i++) {
            var mr = mtxState.matchResults[i];
            if (mr.match && mr.match.confidence >= 70 && mr.match.confidence < 75 && mr.match.field) {
                var f = mr.match.field;
                var row = mtxState.rows[i];
                var rectStr = f.rect
                    ? f.rect.x + ',' + f.rect.y + ',' + (f.rect.width || 0) + ',' + (f.rect.height || 0)
                    : '';
                row['Nombre del Campo en PDF'] = f.name;
                row['PDF AcroForm Name'] = f.name;
                row['PDF Tipo Nativo'] = mapNativeTypeUI(f.type || '');
                row['PDF Página'] = f.page != null ? f.page + 1 : '';
                row['PDF Rect'] = rectStr;
                row['_matchConfidence'] = mr.match.confidence;
                row['_matchSource'] = mr.match.source;
                count++;
            }
        }
        var result = reanalyze(mtxState.rows);
        mtxState.analyzed = result.analyzed;
        mtxState.stats = result.stats;
        renderMtxStats(result.stats);
        renderMtxTable(mtxState.rows, result.analyzed);
        enableMtxActions(result.stats);
        $('#mtxStatus').textContent = '✓ ' + count + ' matches medios aceptados.';
    }

    function mtxSplitAll() {
        mtxState.rows = InsPipelineBundle.matrixSplitAll(mtxState.rows);
        InsPipelineBundle.matrixDeriveFormulario(mtxState.rows);
        var result = InsPipelineBundle.runMatrixAnalysis.__reanalyze
            ? InsPipelineBundle.runMatrixAnalysis.__reanalyze(mtxState.rows)
            : reanalyze(mtxState.rows);
        mtxState.analyzed = result.analyzed;
        mtxState.stats = result.stats;
        renderMtxStats(result.stats);
        renderMtxTable(mtxState.rows, result.analyzed);
        enableMtxActions(result.stats);
        $('#mtxStatus').textContent = '✓ Filas separadas — ahora ' + mtxState.rows.length + ' filas.';
    }

    function mtxDerivePdf() {
        var count = InsPipelineBundle.matrixDerivePdfNames(mtxState.rows);
        var result = reanalyze(mtxState.rows);
        mtxState.analyzed = result.analyzed;
        mtxState.stats = result.stats;
        renderMtxStats(result.stats);
        renderMtxTable(mtxState.rows, result.analyzed);
        enableMtxActions(result.stats);
        $('#mtxStatus').textContent = '✓ ' + count + ' campos PDF auto-rellenados.';
    }

    function mtxNormOblig() {
        var count = InsPipelineBundle.matrixNormalizeObligatorio(mtxState.rows);
        var result = reanalyze(mtxState.rows);
        mtxState.analyzed = result.analyzed;
        mtxState.stats = result.stats;
        renderMtxStats(result.stats);
        renderMtxTable(mtxState.rows, result.analyzed);
        enableMtxActions(result.stats);
        $('#mtxStatus').textContent = '✓ ' + count + ' valores de Obligatorio normalizados.';
    }

    function mtxReset() {
        mtxState.rows = JSON.parse(JSON.stringify(mtxState.originalRows));
        mtxState.matchResults = null;
        mtxState.crossStats = null;
        mtxState.acroFields = null;
        mtxState.hasPdf = false;
        MTX_COLUMNS = MTX_COLUMNS_BASE;
        MTX_SHORT = MTX_SHORT_BASE;
        var result = reanalyze(mtxState.rows);
        mtxState.analyzed = result.analyzed;
        mtxState.stats = result.stats;
        renderMtxStats(result.stats);
        $('#mtxCrossStats').hidden = true;
        renderMtxTable(mtxState.rows, result.analyzed);
        enableMtxActions(result.stats);
        $('#mtxStatus').textContent = '✓ Reset a estado original.';
    }

    function mtxExport() {
        InsPipelineBundle.matrixDeriveFormulario(mtxState.rows);
        var xlsxBuffer = InsPipelineBundle.matrixExport(mtxState.rows);
        var blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var name = (mtxState.file ? mtxState.file.name.replace(/\.xlsx?$/i, '') : 'matriz') + '_ajustada.xlsx';
        InsPipelineBundle.downloadBlob(blob, name);
        $('#mtxExportStatus').className = 'status active success';
        $('#mtxExportStatus').textContent = '✓ Descargando ' + name;
    }

    async function mtxExportByForm() {
        var statusEl = $('#mtxExportStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Generando Excel por formulario...';

        try {
            InsPipelineBundle.matrixDeriveFormulario(mtxState.rows);

            if (mtxState.catalogosFile && !mtxState.catalogos) {
                mtxState.catalogos = await InsPipelineBundle.matrixParseCatalogos(mtxState.catalogosFile);
            }

            var pdfNames = mtxState.pdfFiles.map(function(f) { return f.name; });
            var result = await InsPipelineBundle.matrixExportPerFormularioZip(mtxState.rows, pdfNames, mtxState.catalogos);
            InsPipelineBundle.downloadBlob(result.zipBlob, 'Matrices_por_Formulario.zip');

            var details = result.summary.map(function(s) { return s.code + ' (' + s.rowCount + ' campos)'; }).join(', ');
            statusEl.className = 'status active success';
            statusEl.textContent = '✓ Descargando zip con ' + result.summary.length + ' Excel: ' + details;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function reanalyze(rows) {
        var analyzed = [];
        var stats = { total: rows.length, ambiguous: 0, missingPdfField: 0, obligatorioToFix: 0 };
        for (var i = 0; i < rows.length; i++) {
            var issues = [];
            var row = rows[i];
            var nombrePDF = row['Nombre en PDF'] || '';
            if (/Vida\s+(Colectiva|Universal)/i.test(nombrePDF) && nombrePDF.includes('/')) {
                issues.push({ type: 'ambiguous_pdf_name' });
                stats.ambiguous++;
            }
            if ((!row['Nombre del Campo en PDF'] || !row['Nombre del Campo en PDF'].trim()) &&
                row['Nombre del Campo en Json'] && row['Nombre del Campo en Json'].trim()) {
                issues.push({ type: 'missing_pdf_field' });
                stats.missingPdfField++;
            }
            var oblig = String(row['Obligatorio'] || '').trim();
            if (oblig === 'NO' || oblig === 'no') {
                issues.push({ type: 'obligatorio_case' });
                stats.obligatorioToFix++;
            }
            analyzed.push({ row: row, idx: i, issues: issues });
        }
        return { analyzed: analyzed, stats: stats };
    }

    // ==================== INIT ====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
