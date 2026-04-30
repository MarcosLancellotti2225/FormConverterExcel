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
        initDetectFieldsFlow();

        selectMode(null);
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
        $('#detectFieldsFlow').hidden = mode !== 'detect-fields';
        $('#btnBackToHome').hidden = !mode;
        var main = document.querySelector('main');
        if (mode === 'convert-pdf' || mode === 'detect-fields') {
            main.classList.add('wide-mode');
        } else {
            main.classList.remove('wide-mode');
        }
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
        resultPdfBytes: null,
        preview: null
    };

    function initConvertPdfFlow() {
        $('#convPdfInput').addEventListener('change', function(e) {
            convState.pdf = e.target.files[0] || null;
            updateConvFileStatus('convPdfStatus', convState.pdf);
            refreshConvButton();
        });
        $('#convExcelInput').addEventListener('change', function(e) {
            convState.excel = e.target.files[0] || null;
            updateConvFileStatus('convExcelStatus', convState.excel);
            refreshConvButton();
        });
        $('#btnConvertDirect').addEventListener('click', runConvertDirect);
        $('#btnDownloadConverted').addEventListener('click', downloadConverted);
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

    function refreshConvButton() {
        $('#btnConvertDirect').disabled = !(convState.pdf && convState.excel);
    }

    async function runConvertDirect() {
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Convirtiendo PDF (bypass directo)...';

        try {
            var t0 = performance.now();
            var result = await InsPipelineBundle.runConvertDirect({
                pdfFile: convState.pdf,
                excelFile: convState.excel
            });
            var t1 = performance.now();

            convState.resultPdfBytes = result.pdfBytes;

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ PDF convertido en ' + Math.round(t1 - t0) + 'ms — ' +
                result.renamedCount + '/' + result.excelRows + ' campos renombrados.';

            $('#btnDownloadConverted').hidden = false;

            renderConvRenameTable(result.renamedFields, result.excelRows);
            renderConvWarnings(result.warnings);
            $('#convResultPanel').hidden = false;

            statusEl.textContent += ' Cargando preview...';
            await renderConvPreview(result.pdfBytes);
            statusEl.textContent = '✓ PDF convertido en ' + Math.round(t1 - t0) + 'ms — ' +
                result.renamedCount + '/' + result.excelRows + ' campos renombrados. Listo para descargar.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function downloadConverted() {
        if (!convState.resultPdfBytes) return;
        var blob = new Blob([convState.resultPdfBytes], { type: 'application/pdf' });
        var fileName = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'converted') + '_renamed.pdf';
        InsPipelineBundle.downloadBlob(blob, fileName);
    }

    async function renderConvPreview(renamedPdfBytes) {
        var container = $('#convPreview');
        if (convState.preview) convState.preview.destroy();
        var detectResult = await InsPipelineBundle.runDetectFields({ pdfBytes: renamedPdfBytes });
        convState.preview = await InsPipelineBundle.renderDetectPreview(
            new Uint8Array(renamedPdfBytes), container, detectResult.fields
        );
    }

    function renderConvRenameTable(renamedFields, excelRows) {
        var panel = $('#convRenamePanel');
        var tbody = $('#convRenameTableBody');
        var countEl = $('#convRenameCount');

        if (!renamedFields || !renamedFields.length) {
            panel.hidden = true;
            return;
        }

        countEl.textContent = renamedFields.length + ' renombrados de ' + excelRows + ' filas del Excel';
        panel.hidden = false;
        tbody.innerHTML = '';

        for (var i = 0; i < renamedFields.length; i++) {
            var f = renamedFields[i];
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td style="color:var(--text-dim);text-align:right;width:30px;">' + (i + 1) + '</td>' +
                '<td style="font-family:monospace;font-size:0.8rem;color:var(--accent-red);word-break:break-all;">' + escapeHtml(f.oldName) + '</td>' +
                '<td style="text-align:center;color:var(--accent);font-weight:bold;">→</td>' +
                '<td style="font-family:monospace;font-size:0.8rem;color:var(--accent-green);word-break:break-all;">' + escapeHtml(f.newName) + '</td>' +
                '<td style="font-size:0.7rem;white-space:nowrap;color:var(--accent-green);">✓ Renombrado</td>';
            tbody.appendChild(tr);
        }
    }

    function renderConvWarnings(warnings) {
        var panel = $('#convWarningsPanel');
        if (!warnings || !warnings.length) { panel.hidden = true; return; }

        panel.hidden = false;
        $('#convWarningsSummary').textContent = warnings.length + ' warnings';
        var lines = warnings.map(function(w) {
            return '  [' + (w.type || 'warn') + '] ' + (w.field || '') + ' — ' + (w.reason || '');
        });
        $('#convWarningsLog').textContent = lines.join('\n');
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
            refreshMtxProcessButton();
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
            refreshMtxProcessButton();
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
        $('#btnMtxProcess').addEventListener('click', runMtxProcess);
        $('#btnMtxAnalyze').addEventListener('click', runMtxAnalyze);
        $('#btnMtxSplitAll').addEventListener('click', mtxSplitAll);
        $('#btnMtxDerivePdf').addEventListener('click', mtxDerivePdf);
        $('#btnMtxNormOblig').addEventListener('click', mtxNormOblig);
        $('#btnMtxAcceptAll').addEventListener('click', mtxAcceptAll);
        $('#btnMtxReset').addEventListener('click', mtxReset);
        $('#btnMtxExport').addEventListener('click', mtxExport);
    }

    function refreshMtxProcessButton() {
        var hasMatrix = !!mtxState.file;
        var hasPdf = mtxState.pdfFiles && mtxState.pdfFiles.length > 0;
        $('#btnMtxProcess').disabled = !(hasMatrix && hasPdf);
    }

    async function runMtxProcess() {
        var statusEl = $('#mtxProcessStatus');
        var summaryEl = $('#mtxProcessSummary');
        statusEl.className = 'status active';
        summaryEl.hidden = true;

        if (!mtxState.file) {
            statusEl.className = 'status active warning';
            statusEl.textContent = '⚠ Cargá la matriz del cliente';
            return;
        }
        if (!mtxState.pdfFiles || mtxState.pdfFiles.length === 0) {
            statusEl.className = 'status active warning';
            statusEl.textContent = '⚠ Cargá al menos un PDF';
            return;
        }

        statusEl.textContent = '⟳ Procesando ' + mtxState.pdfFiles.length + ' PDF(s)...';

        try {
            var result = await InsPipelineBundle.runProcessFormulario({
                matrixFile: mtxState.file,
                pdfFiles: mtxState.pdfFiles,
                catalogsFile: mtxState.catalogosFile
            });

            InsPipelineBundle.downloadBlob(result.zipBlob, result.zipFilename);

            var lines = [];
            for (var i = 0; i < result.formularios.length; i++) {
                var f = result.formularios[i];
                lines.push(f.code + ': ' + f.stats.matchedToMatrix + '/' + f.stats.pdfFieldCount + ' matched, ' +
                    f.stats.prefilledCount + ' prefilled, ' + f.stats.sinCatalogo + ' sin catálogo' +
                    (f.stats.renameErrors && f.stats.renameErrors.length ? ', ' + f.stats.renameErrors.length + ' rename errors' : ''));
            }

            var warningMsg = '';
            if (result.warnings && result.warnings.length) {
                warningMsg = ' · ' + result.warnings.map(function(w) { return w.message; }).join(' · ');
            }

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ Generado ' + result.zipFilename + warningMsg;

            summaryEl.innerHTML = result.formularios.map(function(f) {
                var s = f.stats;
                return '<div class="stat"><span class="stat-n">' + s.matchedToMatrix + '/' + s.pdfFieldCount + '</span>' +
                       '<span class="stat-l">' + escapeHtml(f.code) + ' matched</span></div>' +
                       '<div class="stat"><span class="stat-n">' + s.prefilledCount + '</span>' +
                       '<span class="stat-l">' + escapeHtml(f.code) + ' prefilled</span></div>' +
                       '<div class="stat"><span class="stat-n">' + s.unmatched + '</span>' +
                       '<span class="stat-l">' + escapeHtml(f.code) + ' unmatched</span></div>' +
                       '<div class="stat"><span class="stat-n">' + s.sinCatalogo + '</span>' +
                       '<span class="stat-l">' + escapeHtml(f.code) + ' sin catálogo</span></div>' +
                       '<div class="stat"><span class="stat-n">' + s.pathsSinIndice + '</span>' +
                       '<span class="stat-l">' + escapeHtml(f.code) + ' paths sin índice</span></div>';
            }).join('');
            summaryEl.hidden = false;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
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

    // ==================== DETECT FIELDS FLOW ====================

    var detectState = {
        pdf: null,
        fields: null,
        stats: null
    };

    function initDetectFieldsFlow() {
        $('#detectPdfInput').addEventListener('change', function(e) {
            detectState.pdf = e.target.files[0] || null;
            var el = $('#detectPdfStatus');
            var slot = el.closest('.file-slot');
            if (detectState.pdf) {
                slot.classList.add('loaded');
                el.textContent = '✓ ' + detectState.pdf.name + ' (' + formatSize(detectState.pdf.size) + ')';
            } else {
                slot.classList.remove('loaded');
                el.textContent = '';
            }
            $('#btnDetect').disabled = !detectState.pdf;
        });
        $('#btnDetect').addEventListener('click', runDetect);
        $('#btnDetectExcel').addEventListener('click', downloadDetectExcel);
        $('#btnDetectCopy').addEventListener('click', copyDetectToClipboard);
        $('#btnDetectToEditor').addEventListener('click', passDetectToEditor);
        $('#detectPreview').addEventListener('click', function(e) {
            var overlay = e.target.closest('.detect-field-overlay');
            if (overlay && overlay.dataset.fieldIdx != null) {
                highlightDetectField(parseInt(overlay.dataset.fieldIdx, 10));
            }
        });
    }

    async function runDetect() {
        var statusEl = $('#detectStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Detectando campos AcroForm...';

        try {
            var t0 = performance.now();
            var result = await InsPipelineBundle.runDetectFields({ pdfFile: detectState.pdf });
            var t1 = performance.now();

            detectState.fields = result.fields;
            detectState.stats = result.stats;

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ ' + result.stats.total + ' campos detectados en ' +
                result.stats.pages + ' página' + (result.stats.pages > 1 ? 's' : '') +
                ' — ' + Math.round(t1 - t0) + 'ms';

            renderDetectTable(result.fields);
            $('#detectResultPanel').hidden = false;
            $('#detectCount').textContent = result.stats.total + ' campos';
            $('#btnDetectExcel').hidden = false;
            $('#btnDetectCopy').hidden = false;

            statusEl.textContent += ' — Cargando preview...';
            var pdfBytes = await detectState.pdf.arrayBuffer();
            if (detectState._preview) detectState._preview.destroy();
            detectState._preview = await InsPipelineBundle.renderDetectPreview(
                new Uint8Array(pdfBytes), $('#detectPreview'), result.fields
            );
            statusEl.textContent = '✓ ' + result.stats.total + ' campos detectados en ' +
                result.stats.pages + ' página' + (result.stats.pages > 1 ? 's' : '') +
                ' — ' + Math.round(t1 - t0) + 'ms';
            $('#btnDetectToEditor').hidden = false;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderDetectTable(fields) {
        var tbody = $('#detectTableBody');
        tbody.innerHTML = '';
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var tr = document.createElement('tr');
            tr.dataset.idx = i;
            tr.innerHTML =
                '<td style="color:var(--text-dim);text-align:right;">' + (i + 1) + '</td>' +
                '<td style="font-family:monospace;font-size:0.8rem;">' + escapeHtml(f.name) + '</td>' +
                '<td>' + escapeHtml(f.type) + '</td>' +
                '<td style="text-align:center;">' + f.page + '</td>';
            tr.addEventListener('click', (function(idx) {
                return function() { highlightDetectField(idx); };
            })(i));
            tbody.appendChild(tr);
        }
    }

    function highlightDetectField(idx) {
        $$('#detectTableBody tr').forEach(function(tr) { tr.classList.remove('detect-row-active'); });
        var row = $('#detectTableBody tr[data-idx="' + idx + '"]');
        if (row) {
            row.classList.add('detect-row-active');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        $$('.detect-field-overlay').forEach(function(el) { el.classList.remove('detect-field-highlight'); });
        var overlay = $('.detect-field-overlay[data-field-idx="' + idx + '"]');
        if (overlay) {
            overlay.classList.add('detect-field-highlight');
            overlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function downloadDetectExcel() {
        if (!detectState.fields) return;
        var buf = InsPipelineBundle.detectFieldsToXlsx(detectState.fields);
        var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var name = (detectState.pdf ? detectState.pdf.name.replace(/\.pdf$/i, '') : 'campos') + '_acroform.xlsx';
        InsPipelineBundle.downloadBlob(blob, name);
    }

    function copyDetectToClipboard() {
        if (!detectState.fields) return;
        var text = detectState.fields.map(function(f) { return f.name; }).join('\n');
        navigator.clipboard.writeText(text).then(function() {
            $('#detectStatus').textContent = '✓ ' + detectState.fields.length + ' nombres copiados al portapapeles';
        });
    }

    function passDetectToEditor() {
        if (!detectState.fields) return;
        // Store the detected fields for the editor to pick up
        window._detectedAcroFields = detectState.fields.map(function(f) { return f.name; });
        selectMode('matrix-editor');
        $('#detectStatus').textContent = '→ Pasados ' + detectState.fields.length + ' campos al Editor de Matriz';
    }

    // ==================== INIT ====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
