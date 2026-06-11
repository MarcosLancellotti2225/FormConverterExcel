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
        initConvertPdfFlow();
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
        mode: '22col',
        originalPdfBytes: null,
        resultPdfBytes: null,
        preview: null,
        drawMode: false,
        addedFields: [],
        customHeaders: null,
        customRows: null,
        detectedFields: null,
        manualRenames: {},
        allFieldEntries: [],
        deletedFields: new Set()
    };

    function initConvertPdfFlow() {
        $('#convPdfInput').addEventListener('change', function(e) {
            convState.pdf = e.target.files[0] || null;
            updateConvFileStatus('convPdfStatus', convState.pdf);
            if (convState.mode === 'manual' && convState.pdf) loadManualFields();
            refreshConvButton();
        });
        $('#convExcelInput').addEventListener('change', function(e) {
            convState.excel = e.target.files[0] || null;
            updateConvFileStatus('convExcelStatus', convState.excel);
            if (convState.mode === 'custom' && convState.excel) loadCustomExcel();
            refreshConvButton();
        });
        $$('input[name="convMode"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                convState.mode = this.value;
                onConvModeChange();
            });
        });
        $('#btnConvertDirect').addEventListener('click', runConvertDirect);
        $('#btnDownloadConverted').addEventListener('click', downloadConverted);
        $('#btnExportImage').addEventListener('click', exportConvImage);
        $('#btnExportLabeledPdf').addEventListener('click', exportLabeledPdf);
        $('#btnExportMapExcel').addEventListener('click', exportMapExcel);
        $('#btnApplyEdits').addEventListener('click', applyConvEdits);
        $('#btnAddField').addEventListener('click', enterDrawMode);
        $('#btnCancelAddField').addEventListener('click', exitDrawMode);
        $('#convSearchField').addEventListener('input', filterConvTable);
        $('#btnBulkEdit').addEventListener('click', openBulkEditor);
        $('#btnBulkCopy').addEventListener('click', bulkCopyAll);
        $('#btnBulkApply').addEventListener('click', bulkApplyText);
        $('#btnBulkClose').addEventListener('click', closeBulkEditor);
        $('#btnTogglePositions').addEventListener('click', togglePositions);
        initDrawHandlers();
    }

    function onConvModeChange() {
        var mode = convState.mode;
        var excelSection = $('#convExcelSection');
        var columnPicker = $('#convColumnPicker');
        var manualPanel = $('#convManualPanel');

        excelSection.hidden = mode === 'manual';
        columnPicker.hidden = true;
        manualPanel.hidden = true;
        convState.customHeaders = null;
        convState.customRows = null;
        convState.detectedFields = null;

        if (mode === '22col') {
            $('#convExcelLabel').textContent = 'Matriz Excel (22 columnas)';
            $('#convExcelDesc').textContent = 'Con columnas AcroForm Actual → AcroForm Propuesto';
        } else if (mode === 'custom') {
            $('#convExcelLabel').textContent = 'Excel personalizado';
            $('#convExcelDesc').textContent = 'Cualquier .xlsx — después elegís las columnas';
            if (convState.excel) loadCustomExcel();
        } else if (mode === 'manual') {
            if (convState.pdf) loadManualFields();
        }
        refreshConvButton();
    }

    async function loadCustomExcel() {
        try {
            var parsed = await InsPipelineBundle.parseExcelHeaders(convState.excel);
            convState.customHeaders = parsed.headers;
            convState.customRows = parsed.rows;

            var selActual = $('#convColActual');
            var selPropuesto = $('#convColPropuesto');
            selActual.innerHTML = '';
            selPropuesto.innerHTML = '';
            for (var i = 0; i < parsed.headers.length; i++) {
                var h = parsed.headers[i];
                selActual.innerHTML += '<option value="' + h.index + '">' + escapeHtml(h.name) + '</option>';
                selPropuesto.innerHTML += '<option value="' + h.index + '">' + escapeHtml(h.name) + '</option>';
            }
            if (parsed.headers.length > 1) selPropuesto.selectedIndex = 1;
            $('#convColumnPicker').hidden = false;
            refreshConvButton();
        } catch (err) {
            $('#convStatus').className = 'status active error';
            $('#convStatus').textContent = '✗ ' + err.message;
        }
    }

    async function loadManualFields() {
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Detectando campos AcroForm...';
        try {
            var result = await InsPipelineBundle.runDetectFields({ pdfFile: convState.pdf });
            convState.detectedFields = result.fields;
            convState.manualRenames = {};
            renderManualTable(result.fields);
            $('#convManualPanel').hidden = false;
            statusEl.className = 'status active success';
            statusEl.textContent = '✓ ' + result.fields.length + ' campos detectados. Editá los nombres y dale a Convertir.';
            refreshConvButton();
        } catch (err) {
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderManualTable(fields) {
        var tbody = $('#convManualTableBody');
        tbody.innerHTML = '';
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td style="color:var(--text-dim);text-align:right;">' + (i + 1) + '</td>' +
                '<td style="font-family:monospace;font-size:0.8rem;">' + escapeHtml(f.name) + '</td>' +
                '<td>' + escapeHtml(f.type) + '</td>' +
                '<td style="text-align:center;">' + f.page + '</td>' +
                '<td><input type="text" data-field="' + escapeHtml(f.name) + '" placeholder="' + escapeHtml(f.name) + '"></td>';
            tbody.appendChild(tr);
        }
        tbody.addEventListener('input', function(e) {
            if (e.target.tagName === 'INPUT') {
                var fieldName = e.target.dataset.field;
                var newVal = e.target.value.trim();
                if (newVal) {
                    convState.manualRenames[fieldName] = newVal;
                } else {
                    delete convState.manualRenames[fieldName];
                }
            }
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

    function refreshConvButton() {
        var mode = convState.mode;
        var ok = false;
        if (mode === '22col') ok = !!(convState.pdf && convState.excel);
        else if (mode === 'custom') ok = !!(convState.pdf && convState.excel && convState.customHeaders);
        else if (mode === 'manual') ok = !!(convState.pdf && convState.detectedFields);
        $('#btnConvertDirect').disabled = !ok;
    }

    function normalizeFieldName(name) {
        return String(name || '').toLowerCase()
            .replace(/[\s._\-]+/g, '')
            .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
            .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o')
            .replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
    }

    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        var matrix = [];
        for (var i = 0; i <= b.length; i++) matrix[i] = [i];
        for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (var i = 1; i <= b.length; i++) {
            for (var j = 1; j <= a.length; j++) {
                var cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        return matrix[b.length][a.length];
    }

    function similarity(a, b) {
        var maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;
        return 1 - levenshtein(a, b) / maxLen;
    }

    function smartMatchExcelToPdf(excelEntries, pdfFields) {
        var pdfByNorm = {};
        var pdfNames = [];
        for (var i = 0; i < pdfFields.length; i++) {
            var f = pdfFields[i];
            var norm = normalizeFieldName(f.name);
            pdfByNorm[norm] = f.name;
            pdfNames.push({ name: f.name, norm: norm, type: f.type, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, _isWidget: f._isWidget, _widgetIndex: f._widgetIndex, _widgetCount: f._widgetCount, _dupIndex: f._dupIndex, _dupCount: f._dupCount });
        }

        var usedPdf = {};
        var results = [];

        for (var i = 0; i < pdfNames.length; i++) {
            var pdf = pdfNames[i];
            var bestMatch = null;
            var bestScore = 0;
            var matchType = 'none';

            for (var j = 0; j < excelEntries.length; j++) {
                var ex = excelEntries[j];
                if (usedPdf[ex.oldName + '→' + j]) continue;

                if (ex.oldName === pdf.name) {
                    bestMatch = ex;
                    bestScore = 1;
                    matchType = 'exact';
                    break;
                }

                var normEx = normalizeFieldName(ex.oldName);
                if (normEx === pdf.norm) {
                    if (bestScore < 0.95) {
                        bestMatch = ex;
                        bestScore = 0.95;
                        matchType = 'normalized';
                    }
                    continue;
                }

                var sim = similarity(normEx, pdf.norm);
                if (sim > bestScore && sim >= 0.7) {
                    bestMatch = ex;
                    bestScore = sim;
                    matchType = 'fuzzy';
                }
            }

            if (bestMatch) {
                usedPdf[bestMatch.oldName] = true;
                results.push({
                    oldName: pdf.name,
                    newName: bestMatch.newName || '',
                    excelName: bestMatch.oldName,
                    type: pdf.type,
                    page: pdf.page,
                    x: pdf.x, y: pdf.y, width: pdf.width, height: pdf.height,
                    _isWidget: pdf._isWidget, _widgetIndex: pdf._widgetIndex, _widgetCount: pdf._widgetCount, _dupIndex: pdf._dupIndex, _dupCount: pdf._dupCount,
                    matchType: matchType,
                    matchScore: bestScore
                });
            } else {
                results.push({
                    oldName: pdf.name,
                    newName: '',
                    excelName: '',
                    type: pdf.type,
                    page: pdf.page,
                    x: pdf.x, y: pdf.y, width: pdf.width, height: pdf.height,
                    _isWidget: pdf._isWidget, _widgetIndex: pdf._widgetIndex, _widgetCount: pdf._widgetCount, _dupIndex: pdf._dupIndex, _dupCount: pdf._dupCount,
                    matchType: 'none',
                    matchScore: 0
                });
            }
        }

        return results;
    }

    function buildExcelEntries(mode) {
        var entries = [];
        if (mode === '22col') {
            return null;
        } else if (mode === 'custom') {
            var colActual = parseInt($('#convColActual').value, 10);
            var colPropuesto = parseInt($('#convColPropuesto').value, 10);
            for (var i = 0; i < convState.customRows.length; i++) {
                var row = convState.customRows[i];
                var oldName = String(row[colActual] || '').trim();
                var newName = String(row[colPropuesto] || '').trim();
                if (oldName) entries.push({ oldName: oldName, newName: newName || oldName });
            }
        }
        return entries;
    }

    async function runConvertDirect() {
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Convirtiendo PDF...';

        try {
            var t0 = performance.now();

            if (!convState.originalPdfBytes) {
                var ab = await convState.pdf.arrayBuffer();
                convState.originalPdfBytes = new Uint8Array(ab);
            }

            if (convState.mode === 'manual') {
                var manualMap = [];
                for (var key in convState.manualRenames) {
                    manualMap.push({ oldName: key, newName: convState.manualRenames[key] });
                }
                var result = await InsPipelineBundle.runConvertManual({
                    pdfFile: convState.pdf,
                    renameMap: manualMap
                });

                var t1 = performance.now();
                convState.resultPdfBytes = result.pdfBytes;

                statusEl.className = 'status active success';
                statusEl.textContent = '✓ PDF convertido en ' + Math.round(t1 - t0) + 'ms — ' +
                    result.renamedCount + ' campos renombrados.';

                var origFields = await InsPipelineBundle.runDetectFields({ pdfBytes: convState.originalPdfBytes });
                var renamedMap = {};
                if (result.renamedFields) {
                    for (var ri = 0; ri < result.renamedFields.length; ri++) {
                        renamedMap[result.renamedFields[ri].oldName] = result.renamedFields[ri].newName;
                    }
                }
                convState.allFieldEntries = origFields.fields.map(function(f) {
                    return { oldName: f.name, newName: renamedMap[f.name] || '', type: f.type, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, _isWidget: f._isWidget, _widgetIndex: f._widgetIndex, _widgetCount: f._widgetCount, _dupIndex: f._dupIndex, _dupCount: f._dupCount, matchType: renamedMap[f.name] ? 'exact' : 'none', matchScore: renamedMap[f.name] ? 1 : 0 };
                });

                finishConvertUI(result, t0);
                return;
            }

            statusEl.textContent = '⟳ Detectando campos del PDF...';
            var origFields = await InsPipelineBundle.runDetectFields({ pdfBytes: convState.originalPdfBytes });
            var pdfFields = origFields.fields;

            statusEl.textContent = '⟳ Parseando Excel y matcheando...';
            var excelEntries;

            if (convState.mode === '22col') {
                var parsed = await InsPipelineBundle.parseExcel22Col(convState.excel);
                excelEntries = parsed;
            } else {
                excelEntries = buildExcelEntries('custom');
            }

            var matched = smartMatchExcelToPdf(excelEntries, pdfFields);

            var exactCount = 0, normCount = 0, fuzzyCount = 0, noneCount = 0;
            for (var i = 0; i < matched.length; i++) {
                if (matched[i].matchType === 'exact') exactCount++;
                else if (matched[i].matchType === 'normalized') normCount++;
                else if (matched[i].matchType === 'fuzzy') fuzzyCount++;
                else noneCount++;
            }

            var renameMap = [];
            for (var i = 0; i < matched.length; i++) {
                var m = matched[i];
                if (m.newName && m.newName !== m.oldName) {
                    renameMap.push({ oldName: m.oldName, newName: m.newName });
                }
            }

            var result = await InsPipelineBundle.runConvertManual({
                pdfFile: new File([convState.originalPdfBytes], convState.pdf.name, { type: 'application/pdf' }),
                renameMap: renameMap
            });

            convState.resultPdfBytes = result.pdfBytes;
            convState.allFieldEntries = matched;
            convState.addedFields = [];
            convState.deletedFields = new Set();

            var t1 = performance.now();
            var matchMsg = exactCount + ' exactos';
            if (normCount) matchMsg += ', ' + normCount + ' normalizados';
            if (fuzzyCount) matchMsg += ', ' + fuzzyCount + ' fuzzy';
            if (noneCount) matchMsg += ', ' + noneCount + ' sin match';

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ ' + result.renamedCount + ' renombrados (' + matchMsg + ') en ' + Math.round(t1 - t0) + 'ms.';

            renderConvAllFieldsTable(convState.allFieldEntries);
            renderConvWarnings(result.warnings);
            $('#convResultPanel').hidden = false;
            $('#btnDownloadConverted').hidden = false;
            $('#btnExportLabeledPdf').hidden = false;
            $('#btnExportImage').hidden = false;
            $('#btnExportMapExcel').hidden = false;
            $('#btnAddField').hidden = false;

            statusEl.textContent += ' Cargando preview...';
            await renderConvPreview(result.pdfBytes);
            statusEl.textContent = '✓ ' + result.renamedCount + ' renombrados (' + matchMsg + ') en ' + Math.round(t1 - t0) + 'ms. Listo.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    async function finishConvertUI(result, t0) {
        var t1 = performance.now();
        renderConvAllFieldsTable(convState.allFieldEntries);
        renderConvWarnings(result.warnings);
        $('#convResultPanel').hidden = false;
        $('#btnDownloadConverted').hidden = false;
        $('#btnExportLabeledPdf').hidden = false;
        $('#btnExportImage').hidden = false;
        $('#btnExportMapExcel').hidden = false;
        $('#btnAddField').hidden = false;
        convState.addedFields = [];
        convState.deletedFields = new Set();

        var statusEl = $('#convStatus');
        statusEl.textContent += ' Cargando preview...';
        await renderConvPreview(result.pdfBytes);
        statusEl.textContent = '✓ PDF convertido en ' + Math.round(t1 - t0) + 'ms — ' +
            result.renamedCount + ' campos renombrados. Listo.';
    }

    function downloadConverted() {
        if (!convState.resultPdfBytes) {
            $('#convStatus').textContent = '✗ No hay PDF para descargar. Convertí primero.';
            return;
        }
        var bytes = convState.resultPdfBytes instanceof Uint8Array
            ? convState.resultPdfBytes
            : new Uint8Array(convState.resultPdfBytes);
        var blob = new Blob([bytes], { type: 'application/pdf' });
        var fileName = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'converted') + '_renamed.pdf';
        InsPipelineBundle.downloadBlob(blob, fileName);
    }

    async function exportConvImage() {
        if (!convState.resultPdfBytes) return;
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Generando imagen...';

        try {
            var container = $('#convPreview');
            var pages = $$('.detect-page', container);
            if (!pages.length) { statusEl.textContent = '✗ No hay preview.'; return; }

            for (var p = 0; p < pages.length; p++) {
                var pageDiv = pages[p];
                var canvas = pageDiv.querySelector('canvas');
                if (!canvas) continue;

                var imgCanvas = document.createElement('canvas');
                imgCanvas.width = canvas.width;
                imgCanvas.height = canvas.height;
                var ctx = imgCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, 0);

                var overlays = $$('.detect-field-overlay', pageDiv);
                var pdfScale = parseFloat(pageDiv.dataset.pdfScale) || 1;
                for (var oi = 0; oi < overlays.length; oi++) {
                    var ov = overlays[oi];
                    var ox = parseFloat(ov.style.left) * (canvas.width / pageDiv.offsetWidth);
                    var oy = parseFloat(ov.style.top) * (canvas.height / pageDiv.offsetHeight);
                    var ow = parseFloat(ov.style.width) * (canvas.width / pageDiv.offsetWidth);
                    var oh = parseFloat(ov.style.height) * (canvas.height / pageDiv.offsetHeight);

                    ctx.strokeStyle = 'rgba(163, 113, 247, 0.7)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(ox, oy, ow, oh);

                    var nameEl = ov.querySelector('.detect-field-name');
                    if (nameEl) {
                        var label = nameEl.textContent;
                        var fontSize = Math.max(10, Math.min(14, oh * 0.7));
                        ctx.font = fontSize + 'px monospace';
                        ctx.fillStyle = 'rgba(163, 113, 247, 0.9)';
                        var textW = ctx.measureText(label).width;
                        ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
                        ctx.fillRect(ox, oy - fontSize - 4, textW + 6, fontSize + 4);
                        ctx.fillStyle = '#a371f7';
                        ctx.fillText(label, ox + 3, oy - 4);
                    }
                }

                (function(pageNum) {
                    imgCanvas.toBlob(function(blob) {
                        var fileName = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'pdf') + '_page' + pageNum + '.png';
                        InsPipelineBundle.downloadBlob(blob, fileName);
                    }, 'image/png');
                })(p + 1);
            }

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ ' + pages.length + ' imagen(es) exportada(s).';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    async function exportLabeledPdf() {
        if (!convState.resultPdfBytes) return;
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Generando PDF con labels...';

        try {
            var bytes = convState.resultPdfBytes instanceof Uint8Array
                ? convState.resultPdfBytes
                : new Uint8Array(convState.resultPdfBytes);
            var labeled = await InsPipelineBundle.generateLabeledPdf(bytes);
            var blob = new Blob([labeled], { type: 'application/pdf' });
            var fileName = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'pdf') + '_con_labels.pdf';
            InsPipelineBundle.downloadBlob(blob, fileName);

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ PDF con labels descargado.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function exportMapExcel() {
        if (!convState.allFieldEntries || !convState.allFieldEntries.length) return;
        var entries = convState.allFieldEntries.map(function(e) {
            return {
                oldName: e.oldName,
                newName: e.newName || e.oldName,
                type: e.type || '',
                page: e.page || ''
            };
        });
        var buf = InsPipelineBundle.renameMapToXlsx(entries);
        var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var fileName = (convState.pdf ? convState.pdf.name.replace(/\.pdf$/i, '') : 'mapeo') + '_mapeo.xlsx';
        InsPipelineBundle.downloadBlob(blob, fileName);
        $('#convStatus').className = 'status active success';
        $('#convStatus').textContent = '✓ Mapeo Excel descargado.';
    }

    async function renderConvPreview(renamedPdfBytes) {
        var container = $('#convPreview');
        if (convState.preview) convState.preview.destroy();
        var detectResult = await InsPipelineBundle.runDetectFields({ pdfBytes: renamedPdfBytes });
        convState.previewFields = detectResult.fields;
        convState.preview = await InsPipelineBundle.renderDetectPreview(
            new Uint8Array(renamedPdfBytes), container, detectResult.fields
        );
        wireConvPreviewClicks(detectResult.fields);
    }

    // Two fields are the same widget if same page and overlapping position.
    // Names can collide (duplicates), positions cannot — so match by geometry.
    function samePos(a, b) {
        if (!a || !b) return false;
        if ((a.page || 1) !== (b.page || 1)) return false;
        var dx = Math.abs((a.x || 0) - (b.x || 0));
        var dy = Math.abs((a.y || 0) - (b.y || 0));
        return dx <= 1.5 && dy <= 1.5;
    }

    function wireConvPreviewClicks(previewFields) {
        var container = $('#convPreview');
        container.addEventListener('click', function handler(e) {
            if (convState.drawMode) return;
            var overlay = e.target.closest('.detect-field-overlay');
            if (!overlay) return;
            var idx = parseInt(overlay.dataset.fieldIdx, 10);
            if (isNaN(idx) || !previewFields[idx]) return;

            var tableIdx = findTableIdxByField(previewFields[idx]);
            if (tableIdx < 0) return;

            highlightConvPair(tableIdx, idx);
            var row = $('#convRenameTableBody tr[data-table-idx="' + tableIdx + '"]');
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // Match a preview field to its table row by position first (unique),
    // falling back to name only when no positional match exists.
    function findTableIdxByField(pf) {
        for (var i = 0; i < convState.allFieldEntries.length; i++) {
            if (samePos(convState.allFieldEntries[i], pf)) return i;
        }
        for (var i = 0; i < convState.allFieldEntries.length; i++) {
            var e = convState.allFieldEntries[i];
            if (e.newName === pf.name || e.oldName === pf.name) return i;
        }
        return -1;
    }

    function highlightConvPair(tableIdx, overlayIdx) {
        $$('#convRenameTableBody tr').forEach(function(tr) { tr.classList.remove('detect-row-active'); });
        $$('.detect-field-overlay', $('#convPreview')).forEach(function(el) { el.classList.remove('detect-field-highlight'); });

        var row = $('#convRenameTableBody tr:nth-child(' + (tableIdx + 1) + ')');
        if (row) {
            row.classList.add('detect-row-active');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var input = row.querySelector('.conv-edit-name');
            if (input) input.focus();
        }

        if (overlayIdx != null) {
            var ov = $('.detect-field-overlay[data-field-idx="' + overlayIdx + '"]', $('#convPreview'));
            if (ov) ov.classList.add('detect-field-highlight');
        }
    }

    function matchBadgeHtml(entry) {
        if (!entry.matchType || entry.matchType === 'none') return '<span class="conv-match-badge conv-match-none" title="Sin match en Excel">✗</span>';
        if (entry.matchType === 'exact') return '<span class="conv-match-badge conv-match-exact" title="Match exacto">✓</span>';
        if (entry.matchType === 'normalized') return '<span class="conv-match-badge conv-match-norm" title="Match normalizado (diferencias de caso/puntuación)">≈</span>';
        if (entry.matchType === 'fuzzy') return '<span class="conv-match-badge conv-match-fuzzy" title="Match fuzzy (' + Math.round((entry.matchScore || 0) * 100) + '%)">~</span>';
        return '';
    }

    var FIELD_TYPE_OPTIONS = [
        { value: 'Text', label: 'Text', ft: 'Tx' },
        { value: 'Checkbox', label: 'Checkbox', ft: 'Btn' },
        { value: 'Radio', label: 'Radio', ft: 'Btn' },
        { value: 'Choice', label: 'Choice', ft: 'Ch' },
        { value: 'Signature', label: 'Signature', ft: 'Sig' },
        { value: 'Pushbutton', label: 'Pushbutton', ft: 'Btn' },
    ];

    function fieldKeyForEntry(e) {
        if (e._isWidget && typeof e._widgetIndex === 'number') return e.oldName + '#' + e._widgetIndex;
        if (typeof e._dupIndex === 'number') return e.oldName + '#' + e._dupIndex;
        return e.oldName;
    }

    function typeSelectHtml(idx, currentType, disabled) {
        var html = '<select class="conv-type-select" data-idx="' + idx + '"' + (disabled ? ' disabled' : '') + '>';
        for (var t = 0; t < FIELD_TYPE_OPTIONS.length; t++) {
            var opt = FIELD_TYPE_OPTIONS[t];
            var sel = (currentType === opt.value) ? ' selected' : '';
            html += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
        }
        html += '</select>';
        return html;
    }

    function renderConvAllFieldsTable(entries) {
        var tbody = $('#convRenameTableBody');
        var countEl = $('#convRenameCount');
        var renamed = entries.filter(function(e) { return !!e.newName; }).length;
        var deleted = convState.deletedFields.size;
        var hasMatchInfo = entries.some(function(e) { return !!e.matchType; });
        var showPos = convState.showPositions || false;
        var widgets = entries.filter(function(e) { return e._isWidget; }).length;
        var countText = entries.length + ' campos';
        if (widgets) countText += ' (' + widgets + ' widgets)';
        countText += ', ' + renamed + ' renombrados';
        if (deleted) countText += ', ' + deleted + ' a eliminar';
        countEl.textContent = countText;
        tbody.innerHTML = '';

        var thead = $('#convRenameTableHead');
        if (thead) {
            var cols = '<th>#</th>';
            if (hasMatchInfo) cols += '<th></th>';
            cols += '<th>Nombre actual (PDF)</th><th></th><th>Nombre nuevo</th><th>Tipo</th>';
            if (showPos) cols += '<th>Pág</th><th>X</th><th>Y</th><th>W</th><th>H</th>';
            cols += '<th></th>';
            thead.innerHTML = '<tr>' + cols + '</tr>';
        }

        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var entryKey = fieldKeyForEntry(e);
            var isDeleted = convState.deletedFields.has(entryKey) || convState.deletedFields.has(e.oldName);
            var tr = document.createElement('tr');
            tr.dataset.tableIdx = i;
            var rowClass = isDeleted ? 'conv-row-deleted' : '';
            if (!isDeleted && e.matchType === 'none') rowClass = 'conv-row-nomatch';
            if (!isDeleted && e.matchType === 'fuzzy') rowClass = 'conv-row-fuzzy';
            if (!isDeleted && e._isWidget) rowClass = (rowClass ? rowClass + ' ' : '') + 'conv-row-widget';
            if (rowClass) tr.className = rowClass;

            var matchCol = hasMatchInfo ? '<td style="width:28px;text-align:center;">' + matchBadgeHtml(e) + '</td>' : '';
            var excelHint = (e.excelName && e.excelName !== e.oldName)
                ? '<div class="conv-excel-hint" title="Nombre en Excel: ' + escapeHtml(e.excelName) + '">Excel: ' + escapeHtml(e.excelName) + '</div>'
                : '';
            var widgetBadge = '';
            if (e._isWidget) {
                widgetBadge = '<span class="conv-widget-badge" title="Widget ' + e._widgetIndex + ' de ' + e._widgetCount + '">#' + e._widgetIndex + '</span>';
            } else if (typeof e._dupIndex === 'number') {
                widgetBadge = '<span class="conv-dup-badge" title="Duplicado ' + (e._dupIndex + 1) + ' de ' + e._dupCount + ' con el mismo nombre">#' + e._dupIndex + '</span>';
            }

            var posCols = '';
            if (showPos) {
                var px = typeof e.x === 'number' ? Math.round(e.x * 100) / 100 : '';
                var py = typeof e.y === 'number' ? Math.round(e.y * 100) / 100 : '';
                var pw = typeof e.width === 'number' ? Math.round(e.width * 100) / 100 : '';
                var ph = typeof e.height === 'number' ? Math.round(e.height * 100) / 100 : '';
                posCols =
                    '<td class="conv-pos-cell">' + (e.page || '') + '</td>' +
                    '<td class="conv-pos-cell"><input type="number" step="0.1" class="conv-pos-input" data-idx="' + i + '" data-field="x" value="' + px + '"' + (isDeleted ? ' disabled' : '') + '></td>' +
                    '<td class="conv-pos-cell"><input type="number" step="0.1" class="conv-pos-input" data-idx="' + i + '" data-field="y" value="' + py + '"' + (isDeleted ? ' disabled' : '') + '></td>' +
                    '<td class="conv-pos-cell"><input type="number" step="0.1" class="conv-pos-input" data-idx="' + i + '" data-field="width" value="' + pw + '"' + (isDeleted ? ' disabled' : '') + '></td>' +
                    '<td class="conv-pos-cell"><input type="number" step="0.1" class="conv-pos-input" data-idx="' + i + '" data-field="height" value="' + ph + '"' + (isDeleted ? ' disabled' : '') + '></td>';
            }

            var copyBtn = '<button class="conv-copy-btn" data-idx="' + i + '" title="Copiar nombre al campo nuevo (para editar solo el número)">⧉</button>';

            tr.innerHTML =
                '<td style="color:var(--text-dim);text-align:right;width:30px;">' + (i + 1) + '</td>' +
                matchCol +
                '<td class="conv-old-name" style="font-family:monospace;font-size:0.8rem;word-break:break-all;cursor:pointer;">' + escapeHtml(e.oldName) + widgetBadge + excelHint + copyBtn + '</td>' +
                '<td style="text-align:center;color:var(--accent);font-weight:bold;">→</td>' +
                '<td><input type="text" class="conv-edit-name" data-idx="' + i + '" value="' + escapeHtml(e.newName) + '" placeholder="' + escapeHtml(e.oldName) + '"' + (isDeleted ? ' disabled' : '') + '></td>' +
                '<td class="conv-type-cell">' + typeSelectHtml(i, e._newType || e.type, isDeleted) + '</td>' +
                posCols +
                '<td style="width:32px;text-align:center;">' +
                    '<button class="conv-delete-btn" data-idx="' + i + '" title="' + (isDeleted ? 'Restaurar campo' : 'Eliminar campo') + '">' +
                    (isDeleted ? '↩' : '✕') + '</button></td>';
            tbody.appendChild(tr);
        }

        if (tbody.dataset.listenersWired === '1') return;
        tbody.dataset.listenersWired = '1';

        tbody.addEventListener('input', function(e) {
            if (e.target.classList.contains('conv-edit-name')) {
                var idx = parseInt(e.target.dataset.idx, 10);
                if (convState.allFieldEntries[idx]) {
                    convState.allFieldEntries[idx].newName = e.target.value.trim();
                }
            }
            if (e.target.classList.contains('conv-pos-input')) {
                var idx = parseInt(e.target.dataset.idx, 10);
                var field = e.target.dataset.field;
                if (convState.allFieldEntries[idx] && field) {
                    var val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                        convState.allFieldEntries[idx][field] = val;
                        convState.allFieldEntries[idx]._posEdited = true;
                    }
                }
            }
        });

        tbody.addEventListener('change', function(e) {
            if (e.target.classList.contains('conv-type-select')) {
                var idx = parseInt(e.target.dataset.idx, 10);
                if (convState.allFieldEntries[idx]) {
                    convState.allFieldEntries[idx]._newType = e.target.value;
                    convState.allFieldEntries[idx]._typeEdited = true;
                }
            }
        });

        tbody.addEventListener('click', function(e) {
            var copyBtn = e.target.closest('.conv-copy-btn');
            if (copyBtn) {
                var cidx = parseInt(copyBtn.dataset.idx, 10);
                var entry = convState.allFieldEntries[cidx];
                if (entry) {
                    var nameToCopy = entry.newName || entry.oldName;
                    entry.newName = nameToCopy;
                    var input = $('.conv-edit-name[data-idx="' + cidx + '"]', tbody);
                    if (input) {
                        input.value = nameToCopy;
                        input.focus();
                        var dot = nameToCopy.search(/\d+\s*$/);
                        if (dot >= 0) input.setSelectionRange(dot, nameToCopy.length);
                        else input.setSelectionRange(nameToCopy.length, nameToCopy.length);
                    }
                    if (navigator.clipboard) navigator.clipboard.writeText(nameToCopy);
                }
                return;
            }
            var delBtn = e.target.closest('.conv-delete-btn');
            if (delBtn) {
                var idx = parseInt(delBtn.dataset.idx, 10);
                toggleDeleteField(idx);
                return;
            }
            if (e.target.closest('.conv-edit-name')) return;
            var tr = e.target.closest('tr');
            if (!tr || tr.dataset.tableIdx == null) return;
            var tableIdx = parseInt(tr.dataset.tableIdx, 10);
            var entry = convState.allFieldEntries[tableIdx];
            if (!entry) return;
            var overlayIdx = findOverlayIdxForEntry(entry);
            highlightConvPair(tableIdx, overlayIdx);
            if (overlayIdx != null) {
                var ov = $('.detect-field-overlay[data-field-idx="' + overlayIdx + '"]', $('#convPreview'));
                if (ov) ov.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    function toggleDeleteField(idx) {
        var entry = convState.allFieldEntries[idx];
        if (!entry) return;
        var key = fieldKeyForEntry(entry);
        if (convState.deletedFields.has(key)) {
            convState.deletedFields.delete(key);
        } else {
            convState.deletedFields.add(key);
        }
        renderConvAllFieldsTable(convState.allFieldEntries);
        filterConvTable();
    }

    function filterConvTable() {
        var query = $('#convSearchField').value.toLowerCase().trim();
        var rows = $$('#convRenameTableBody tr');
        var visible = 0;
        for (var i = 0; i < rows.length; i++) {
            var idx = parseInt(rows[i].dataset.tableIdx, 10);
            var entry = convState.allFieldEntries[idx];
            if (!entry) continue;
            var match = !query ||
                entry.oldName.toLowerCase().indexOf(query) !== -1 ||
                (entry.newName && entry.newName.toLowerCase().indexOf(query) !== -1);
            rows[i].style.display = match ? '' : 'none';
            if (match) visible++;
        }
        var countEl = $('#convRenameCount');
        if (query) {
            countEl.textContent = visible + '/' + convState.allFieldEntries.length + ' mostrados';
        } else {
            var renamed = convState.allFieldEntries.filter(function(e) { return !!e.newName; }).length;
            var deleted = convState.deletedFields.size;
            countEl.textContent = convState.allFieldEntries.length + ' campos, ' + renamed + ' renombrados' +
                (deleted ? ', ' + deleted + ' a eliminar' : '');
        }
    }

    function togglePositions() {
        convState.showPositions = !convState.showPositions;
        var btn = $('#btnTogglePositions');
        btn.classList.toggle('active', convState.showPositions);
        renderConvAllFieldsTable(convState.allFieldEntries);
        filterConvTable();
    }

    function openBulkEditor() {
        var panel = $('#convBulkPanel');
        var ta = $('#convBulkTextarea');
        var hint = panel.querySelector('.conv-bulk-hint');
        var showPos = convState.showPositions;
        var lines = [];
        for (var i = 0; i < convState.allFieldEntries.length; i++) {
            var e = convState.allFieldEntries[i];
            if (convState.deletedFields.has(e.oldName)) continue;
            var line = e.oldName + '\t' + (e.newName || '');
            if (showPos) {
                var px = typeof e.x === 'number' ? Math.round(e.x * 100) / 100 : '';
                var py = typeof e.y === 'number' ? Math.round(e.y * 100) / 100 : '';
                var pw = typeof e.width === 'number' ? Math.round(e.width * 100) / 100 : '';
                var ph = typeof e.height === 'number' ? Math.round(e.height * 100) / 100 : '';
                line += '\t' + px + '\t' + py + '\t' + pw + '\t' + ph;
            }
            lines.push(line);
        }
        ta.value = lines.join('\n');
        hint.innerHTML = showPos
            ? 'Formato: <code>nombre_pdf TAB nombre_nuevo TAB X TAB Y TAB W TAB H</code>'
            : 'Formato: <code>nombre_pdf TAB nombre_nuevo</code> (una línea por campo). Copiá a Excel, editá, y pegá de vuelta.';
        panel.hidden = false;
        ta.focus();
    }

    function closeBulkEditor() {
        $('#convBulkPanel').hidden = true;
    }

    function bulkCopyAll() {
        var ta = $('#convBulkTextarea');
        ta.select();
        navigator.clipboard.writeText(ta.value).then(function() {
            $('#convStatus').className = 'status active success';
            $('#convStatus').textContent = '✓ Mapeo copiado al portapapeles (' + ta.value.split('\n').length + ' líneas). Pegalo en Excel o editá y volvé a pegar acá.';
        });
    }

    function bulkApplyText() {
        var ta = $('#convBulkTextarea');
        var lines = ta.value.split('\n');
        var newMap = {};

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.trim()) continue;
            var parts = line.split('\t');
            if (parts.length < 2) parts = line.split(/\s{2,}/);
            var oldName = (parts[0] || '').trim();
            var newName = (parts[1] || '').trim();
            var posData = null;
            if (parts.length >= 6) {
                var bx = parseFloat(parts[2]), by = parseFloat(parts[3]);
                var bw = parseFloat(parts[4]), bh = parseFloat(parts[5]);
                if (!isNaN(bx) && !isNaN(by) && !isNaN(bw) && !isNaN(bh)) {
                    posData = { x: bx, y: by, width: bw, height: bh };
                }
            }
            if (oldName) newMap[oldName] = { newName: newName, pos: posData };
        }

        var updated = 0;
        for (var i = 0; i < convState.allFieldEntries.length; i++) {
            var e = convState.allFieldEntries[i];
            if (newMap.hasOwnProperty(e.oldName)) {
                var m = newMap[e.oldName];
                if (m.newName !== e.newName) {
                    e.newName = m.newName;
                    updated++;
                }
                if (m.pos) {
                    if (e.x !== m.pos.x || e.y !== m.pos.y || e.width !== m.pos.width || e.height !== m.pos.height) {
                        e.x = m.pos.x; e.y = m.pos.y; e.width = m.pos.width; e.height = m.pos.height;
                        e._posEdited = true;
                        updated++;
                    }
                }
            }
        }

        renderConvAllFieldsTable(convState.allFieldEntries);
        closeBulkEditor();
        $('#convStatus').className = 'status active success';
        $('#convStatus').textContent = '✓ Bulk edit: ' + updated + ' cambio(s) aplicados. Hacé click en "Aplicar cambios" para guardar en el PDF.';
    }

    // Find the preview overlay for a given table entry, by position (unique)
    // and falling back to name. Returns the overlay's data-field-idx.
    function findOverlayIdxForEntry(entry) {
        var pf = convState.previewFields || [];
        for (var i = 0; i < pf.length; i++) {
            if (samePos(pf[i], entry)) return i;
        }
        var target = entry.newName || entry.oldName;
        for (var i = 0; i < pf.length; i++) {
            if (pf[i].name === target) return i;
        }
        return null;
    }

    function findOverlayIdxByName(name) {
        var overlays = $$('.detect-field-overlay', $('#convPreview'));
        for (var i = 0; i < overlays.length; i++) {
            var nameEl = overlays[i].querySelector('.detect-field-name');
            if (nameEl && nameEl.textContent === name) return parseInt(overlays[i].dataset.fieldIdx, 10);
        }
        return null;
    }

    async function applyConvEdits() {
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Aplicando cambios...';

        try {
            var renameMap = [];
            var moveMap = [];
            var typeChanges = [];
            var deleteNames = Array.from(convState.deletedFields);
            for (var i = 0; i < convState.allFieldEntries.length; i++) {
                var e = convState.allFieldEntries[i];
                var key = fieldKeyForEntry(e);
                if (convState.deletedFields.has(key)) continue;
                if (e.newName && e.newName !== e.oldName) {
                    renameMap.push({ oldName: key, newName: e.newName });
                }
                if (e._posEdited && typeof e.x === 'number') {
                    moveMap.push({ fieldName: key, x: e.x, y: e.y, width: e.width, height: e.height });
                }
                if (e._typeEdited && e._newType) {
                    var ftCode = 'Tx';
                    for (var t = 0; t < FIELD_TYPE_OPTIONS.length; t++) {
                        if (FIELD_TYPE_OPTIONS[t].value === e._newType) { ftCode = FIELD_TYPE_OPTIONS[t].ft; break; }
                    }
                    typeChanges.push({ fieldName: key, ftCode: ftCode });
                }
            }

            var t0 = performance.now();
            var result = await InsPipelineBundle.runConvertManual({
                pdfFile: new File([convState.originalPdfBytes], convState.pdf.name, { type: 'application/pdf' }),
                renameMap: renameMap,
                deleteNames: deleteNames,
                moveMap: moveMap.length > 0 ? moveMap : undefined,
                typeChanges: typeChanges.length > 0 ? typeChanges : undefined
            });

            var pdfBytes = result.pdfBytes;

            if (convState.addedFields.length > 0) {
                statusEl.textContent = '⟳ Re-agregando ' + convState.addedFields.length + ' campo(s) creado(s)...';
                var addResult = await InsPipelineBundle.runAddFields(
                    new Uint8Array(pdfBytes), convState.addedFields
                );
                pdfBytes = addResult.pdfBytes;
            }

            var t1 = performance.now();
            convState.resultPdfBytes = pdfBytes;

            if (deleteNames.length > 0) {
                convState.allFieldEntries = convState.allFieldEntries.filter(function(e) {
                    return !convState.deletedFields.has(e.oldName);
                });
                convState.deletedFields.clear();
                renderConvAllFieldsTable(convState.allFieldEntries);
            }

            statusEl.textContent = '⟳ Actualizando preview...';
            await renderConvPreview(pdfBytes);

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ ' + result.renamedCount + ' renombrados' +
                (moveMap.length ? ', ' + moveMap.length + ' reposicionados' : '') +
                (result.deletedCount ? ', ' + result.deletedCount + ' eliminados' : '') +
                (convState.addedFields.length ? ', ' + convState.addedFields.length + ' agregado(s)' : '') +
                ' en ' + Math.round(t1 - t0) + 'ms. Listo.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
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

    // ---- Add Field: draw rectangle on preview ----

    var drawState = { active: false, startX: 0, startY: 0, rect: null, pageDiv: null };

    function enterDrawMode() {
        convState.drawMode = true;
        $('#btnAddField').hidden = true;
        $('#btnCancelAddField').hidden = false;
        $('#convPreview').classList.add('draw-mode');
        $('#convStatus').textContent = 'Dibujá un rectangulo sobre el preview para crear el campo.';
    }

    function exitDrawMode() {
        convState.drawMode = false;
        $('#btnAddField').hidden = false;
        $('#btnCancelAddField').hidden = true;
        $('#convPreview').classList.remove('draw-mode');
        if (drawState.rect) {
            drawState.rect.remove();
            drawState.rect = null;
        }
        drawState.active = false;
        $('#convStatus').textContent = '';
    }

    function initDrawHandlers() {
        var container = $('#convPreview');

        container.addEventListener('mousedown', function(e) {
            if (!convState.drawMode) return;
            var pageDiv = e.target.closest('.detect-page');
            if (!pageDiv) return;
            e.preventDefault();
            var pr = pageDiv.getBoundingClientRect();
            drawState.active = true;
            drawState.startX = e.clientX - pr.left;
            drawState.startY = e.clientY - pr.top;
            drawState.pageDiv = pageDiv;

            var rect = document.createElement('div');
            rect.className = 'draw-rect';
            rect.style.left = drawState.startX + 'px';
            rect.style.top = drawState.startY + 'px';
            rect.style.width = '0px';
            rect.style.height = '0px';
            pageDiv.appendChild(rect);
            drawState.rect = rect;
        });

        container.addEventListener('mousemove', function(e) {
            if (!drawState.active || !drawState.rect) return;
            var pr = drawState.pageDiv.getBoundingClientRect();
            var curX = e.clientX - pr.left;
            var curY = e.clientY - pr.top;
            var x = Math.min(drawState.startX, curX);
            var y = Math.min(drawState.startY, curY);
            var w = Math.abs(curX - drawState.startX);
            var h = Math.abs(curY - drawState.startY);
            drawState.rect.style.left = x + 'px';
            drawState.rect.style.top = y + 'px';
            drawState.rect.style.width = w + 'px';
            drawState.rect.style.height = h + 'px';
        });

        container.addEventListener('mouseup', function(e) {
            if (!drawState.active || !drawState.rect) return;
            drawState.active = false;

            var pr = drawState.pageDiv.getBoundingClientRect();
            var curX = e.clientX - pr.left;
            var curY = e.clientY - pr.top;
            var left = Math.min(drawState.startX, curX);
            var top = Math.min(drawState.startY, curY);
            var w = Math.abs(curX - drawState.startX);
            var h = Math.abs(curY - drawState.startY);

            drawState.rect.remove();
            drawState.rect = null;

            if (w < 10 || h < 5) return;

            var pageIdx = getPageIndex(drawState.pageDiv);

            promptFieldName(function(fieldName) {
                if (!fieldName) return;
                addNewField(fieldName, pageIdx, left, top, w, h);
            });
        });
    }

    function getPageIndex(pageDiv) {
        var pages = $$('.detect-page', $('#convPreview'));
        for (var i = 0; i < pages.length; i++) {
            if (pages[i] === pageDiv) return i;
        }
        return 0;
    }

    function promptFieldName(callback) {
        var name = prompt('Nombre del campo:');
        if (name && name.trim()) callback(name.trim());
    }

    async function addNewField(fieldName, pageIdx, left, top, w, h) {
        var statusEl = $('#convStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Agregando campo "' + fieldName + '"...';

        try {
            var pageDiv = $$('.detect-page', $('#convPreview'))[pageIdx];
            var pdfScale = parseFloat(pageDiv.dataset.pdfScale) || 1;
            var pageHeight = parseFloat(pageDiv.dataset.pdfPageHeight) || 792;

            var pdfX = left / pdfScale;
            var pdfW = w / pdfScale;
            var pdfH = h / pdfScale;
            var pdfY = pageHeight - (top / pdfScale) - pdfH;

            var newField = {
                name: fieldName,
                page: pageIdx + 1,
                x: pdfX,
                y: pdfY,
                width: pdfW,
                height: pdfH
            };

            var result = await InsPipelineBundle.runAddFields(
                new Uint8Array(convState.resultPdfBytes), [newField]
            );

            convState.resultPdfBytes = result.pdfBytes;
            convState.addedFields.push(newField);

            exitDrawMode();

            statusEl.textContent = '⟳ Actualizando preview...';
            await renderConvPreview(result.pdfBytes);

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ Campo "' + fieldName + '" agregado. ' +
                convState.addedFields.length + ' campo(s) nuevo(s) en total.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ Error al agregar campo: ' + err.message;
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
        $('#btnDetectLabeledPdf').addEventListener('click', downloadDetectLabeledPdf);
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
            $('#btnDetectLabeledPdf').hidden = false;
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

    async function downloadDetectLabeledPdf() {
        if (!detectState.pdf) return;
        var statusEl = $('#detectStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Generando PDF con labels...';
        try {
            var pdfBytes = new Uint8Array(await detectState.pdf.arrayBuffer());
            var labeled = await InsPipelineBundle.generateLabeledPdf(pdfBytes);
            var blob = new Blob([labeled], { type: 'application/pdf' });
            var name = (detectState.pdf.name.replace(/\.pdf$/i, '') || 'campos') + '_con_labels.pdf';
            InsPipelineBundle.downloadBlob(blob, name);
            statusEl.className = 'status active success';
            statusEl.textContent = '✓ PDF con labels descargado.';
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
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

    // ==================== GENERATE MATRIX FLOW ====================

    var genState = {
        excel: null,
        pdfFiles: []
    };

    function initGenerateMatrixFlow() {
        $('#genExcelInput').addEventListener('change', function(e) {
            genState.excel = e.target.files[0] || null;
            var el = $('#genExcelStatus');
            var slot = el.closest('.file-slot');
            if (genState.excel) {
                slot.classList.add('loaded');
                el.textContent = '✓ ' + genState.excel.name + ' (' + formatSize(genState.excel.size) + ')';
            } else {
                slot.classList.remove('loaded');
                el.textContent = '';
            }
            refreshGenButton();
        });
        $('#genPdfInput').addEventListener('change', function(e) {
            genState.pdfFiles = Array.from(e.target.files || []);
            var el = $('#genPdfStatus');
            var slot = el.closest('.file-slot');
            if (genState.pdfFiles.length > 0) {
                slot.classList.add('loaded');
                var names = genState.pdfFiles.map(function(f) { return f.name; });
                el.textContent = '✓ ' + genState.pdfFiles.length + ' PDF' + (genState.pdfFiles.length > 1 ? 's' : '') + ': ' + names.join(', ');
            } else {
                slot.classList.remove('loaded');
                el.textContent = '';
            }
            refreshGenButton();
        });
        $('#btnGenerate').addEventListener('click', runGenerate);
    }

    function refreshGenButton() {
        $('#btnGenerate').disabled = !(genState.excel && genState.pdfFiles.length > 0);
    }

    async function runGenerate() {
        var statusEl = $('#genStatus');
        statusEl.className = 'status active';
        statusEl.textContent = '⟳ Procesando matriz + ' + genState.pdfFiles.length + ' PDF(s)...';

        try {
            var t0 = performance.now();
            var results = await InsPipelineBundle.runGenerateMatrices({
                matrixFile: genState.excel,
                pdfFiles: genState.pdfFiles
            });
            var t1 = performance.now();

            statusEl.className = 'status active success';
            statusEl.textContent = '✓ ' + results.length + ' matriz/matrices generada(s) en ' + Math.round(t1 - t0) + 'ms';

            renderGenResults(results);
            $('#genResultPanel').hidden = false;
        } catch (err) {
            console.error(err);
            statusEl.className = 'status active error';
            statusEl.textContent = '✗ ' + err.message;
        }
    }

    function renderGenResults(results) {
        var container = $('#genResults');
        container.innerHTML = '';

        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var div = document.createElement('div');
            div.className = 'gen-result-card';
            div.innerHTML =
                '<h3>' + escapeHtml(r.code) + '</h3>' +
                '<div class="stat-grid">' +
                    '<div class="stat"><span class="stat-n">' + r.stats.pdfFields + '</span><span class="stat-l">Campos PDF</span></div>' +
                    '<div class="stat"><span class="stat-n">' + r.stats.matrixRows + '</span><span class="stat-l">Filas matriz</span></div>' +
                    '<div class="stat"><span class="stat-n">' + r.stats.matched + '</span><span class="stat-l">Matcheados</span></div>' +
                    '<div class="stat' + (r.stats.unmatched ? ' stat-warn' : '') + '"><span class="stat-n">' + r.stats.unmatched + '</span><span class="stat-l">Sin match</span></div>' +
                '</div>';

            var btn = document.createElement('button');
            btn.className = 'primary';
            btn.textContent = 'Descargar ' + r.fileName;
            btn.addEventListener('click', (function(result) {
                return function() {
                    var blob = new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    InsPipelineBundle.downloadBlob(blob, result.fileName);
                };
            })(r));
            div.appendChild(btn);
            container.appendChild(div);
        }
    }

    // ==================== INIT ====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
