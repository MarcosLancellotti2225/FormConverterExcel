/**
 * DocPath Form Builder — Main Application
 */
(function () {
    'use strict';

    // State
    let uploadedFiles = [];
    let specData = null;
    let catalogData = null;
    let questionsData = null;
    let pdfFields = null;
    let _previewDebounceTimer = null;

    // DOM refs
    const $ = id => document.getElementById(id);

    /**
     * Debounced preview regeneration — auto-fires on field changes
     * 300ms delay so typing doesn't cause constant regeneration
     */
    function schedulePreviewUpdate() {
        clearTimeout(_previewDebounceTimer);
        _previewDebounceTimer = setTimeout(() => {
            regeneratePreview();
        }, 300);
    }

    // === SCREEN MANAGEMENT ===

    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        $(screenId).classList.add('active');
    }

    // === UPLOAD SCREEN ===

    function initUploadScreen() {
        const dropZone = $('dropZone');
        const fileInput = $('fileInput');
        const btnGenerate = $('btnGenerate');

        // Click to browse
        dropZone.addEventListener('click', () => fileInput.click());

        // Drag & drop
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            handleFiles(e.dataTransfer.files);
        });

        // File input change
        fileInput.addEventListener('change', () => {
            handleFiles(fileInput.files);
            fileInput.value = '';
        });

        // Generate button
        btnGenerate.addEventListener('click', generateForm);
    }

    function handleFiles(fileList) {
        for (const file of fileList) {
            if (file.name.match(/\.pdf$/i)) {
                uploadedFiles.push({ file, type: 'pdf', name: file.name, size: file.size });
            } else if (file.name.match(/\.xlsx?$/i)) {
                const type = ExcelParser.detectFileType(file.name);
                uploadedFiles.push({ file, type, name: file.name, size: file.size });
            }
        }
        renderFileList();
    }

    function renderFileList() {
        const container = $('fileList');
        container.innerHTML = '';

        const BADGE_MAP = {
            spec:      { cls: 'badge-spec',      text: 'SPEC' },
            catalog:   { cls: 'badge-catalog',    text: 'CATÁLOGO' },
            questions: { cls: 'badge-questions',   text: 'PREGUNTAS' },
            pdf:       { cls: 'badge-pdf',         text: 'PDF' }
        };
        const TYPE_CYCLE = ['spec', 'catalog', 'questions'];

        for (let i = 0; i < uploadedFiles.length; i++) {
            const f = uploadedFiles[i];
            const sizeKB = (f.size / 1024).toFixed(1);
            const badge = BADGE_MAP[f.type] || BADGE_MAP.spec;
            const badgeClass = badge.cls;
            const badgeText = badge.text;

            const div = document.createElement('div');
            div.className = 'file-item';
            div.innerHTML = `
                <div class="file-info">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <div>
                        <span class="file-name">${escHtml(f.name)}</span>
                        <span class="file-size">${sizeKB} KB</span>
                    </div>
                    <span class="file-badge ${badgeClass}" data-index="${i}" title="Click para cambiar tipo">${badgeText}</span>
                </div>
                <button class="btn-remove" data-index="${i}" title="Eliminar">&times;</button>
            `;
            container.appendChild(div);
        }

        // Cycle file type on badge click (pdf files can't change)
        container.querySelectorAll('.file-badge').forEach(bdg => {
            bdg.addEventListener('click', e => {
                e.stopPropagation();
                const idx = parseInt(bdg.dataset.index);
                const f = uploadedFiles[idx];
                if (f.type === 'pdf') return; // PDF stays PDF
                const curIdx = TYPE_CYCLE.indexOf(f.type);
                f.type = TYPE_CYCLE[(curIdx + 1) % TYPE_CYCLE.length];
                renderFileList();
            });
        });

        // Remove buttons
        container.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                uploadedFiles.splice(parseInt(btn.dataset.index), 1);
                renderFileList();
            });
        });

        // Enable generate button if spec or pdf exists
        const hasSpec = uploadedFiles.some(f => f.type === 'spec');
        const hasPdf = uploadedFiles.some(f => f.type === 'pdf');
        $('btnGenerate').disabled = !(hasSpec || hasPdf);
    }

    async function generateForm() {
        const progressBar = $('progressBar');
        const progressFill = progressBar.querySelector('.progress-bar-fill');
        const progressText = progressBar.querySelector('.progress-bar-text');

        progressBar.hidden = false;
        $('btnGenerate').disabled = true;

        try {
            // Parse all files
            progressText.textContent = 'Leyendo archivos...';
            progressFill.style.width = '10%';

            questionsData = null;
            pdfFields = null;
            specData = null;

            const pdfFile = uploadedFiles.find(f => f.type === 'pdf');
            const hasSpecFile = uploadedFiles.some(f => f.type === 'spec');

            // Parse Excel files
            for (const f of uploadedFiles) {
                if (f.type === 'pdf') continue; // handled separately
                const arrayBuffer = await f.file.arrayBuffer();
                const result = ExcelParser.parseFile(arrayBuffer, f.name);

                if (result.type === 'spec') {
                    specData = result.data;
                } else if (result.type === 'questions') {
                    questionsData = result.data;
                } else {
                    catalogData = result.data;
                }
            }

            // PDF-only mode: analyze PDF to generate spec
            if (pdfFile && !hasSpecFile) {
                progressText.textContent = 'Analizando PDF — extrayendo campos...';
                progressFill.style.width = '25%';

                specData = await PdfAnalyzer.analyze(pdfFile.file);

                progressText.textContent = `Encontrados ${specData.fields.length} campos en el PDF`;
                progressFill.style.width = '40%';
            } else if (pdfFile && hasSpecFile) {
                // PDF as supplement: extract field names for matching
                progressText.textContent = 'Extrayendo campos del PDF...';
                const pdfText = await extractPdfText(pdfFile.file);
                pdfFields = ExcelParser.parsePdfFields(pdfText);
            }

            if (!specData) {
                throw new Error('No se encontró un archivo de especificación o PDF válido');
            }

            progressText.textContent = 'Procesando campos...';
            progressFill.style.width = '40%';

            // Initialize field manager
            FieldManager.init(specData, catalogData);

            progressText.textContent = 'Detectando lógica condicional...';
            progressFill.style.width = '60%';

            FieldManager.detectConditionals();

            // If we have questions or PDF data, go to match screen
            const hasExtraData = (questionsData && questionsData.questions.length > 0) ||
                                 (pdfFields && pdfFields.length > 0);

            if (hasExtraData) {
                progressText.textContent = 'Matcheando campos...';
                progressFill.style.width = '80%';

                const fields = FieldManager.getFields().filter(f => f.visible);
                MatchEngine.autoMatch(
                    fields,
                    questionsData ? questionsData.questions : [],
                    pdfFields || []
                );

                await delay(200);
                showScreen('matchScreen');
                initMatchScreen();
            } else {
                progressText.textContent = 'Generando formulario...';
                progressFill.style.width = '90%';

                await delay(300);
                showScreen('builderScreen');
                initBuilderScreen();
            }

            progressFill.style.width = '100%';
            progressText.textContent = 'Listo!';

        } catch (err) {
            console.error('Error generating form:', err);
            progressText.textContent = `Error: ${err.message}`;
            progressFill.style.width = '100%';
            progressFill.style.background = '#ef4444';
            $('btnGenerate').disabled = false;
        }
    }

    /**
     * Extract text from a PDF using pdf.js
     */
    async function extractPdfText(file) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const lines = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            lines.push(pageText);
        }

        return lines.join('\n');
    }

    // === MATCH REVIEW SCREEN ===

    function initMatchScreen() {
        renderMatchTable();
        renderMatchStats();

        // Filter buttons
        document.querySelectorAll('.match-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.match-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderMatchTable(btn.dataset.filter);
            });
        });

        // Back button
        $('btnBackToUpload2').addEventListener('click', () => showScreen('uploadScreen'));

        // Apply matches and go to builder
        $('btnApplyMatches').addEventListener('click', () => {
            MatchEngine.applyToFields();
            showScreen('builderScreen');
            initBuilderScreen();
        });
    }

    function renderMatchStats() {
        const stats = MatchEngine.getStats();
        const el = $('matchStats');
        el.innerHTML = `
            <div class="match-stat"><span class="match-stat-value">${stats.total}</span><span class="match-stat-label">Campos</span></div>
            <div class="match-stat good"><span class="match-stat-value">${stats.qMatched}</span><span class="match-stat-label">Con pregunta</span></div>
            <div class="match-stat good"><span class="match-stat-value">${stats.pdfMatched}</span><span class="match-stat-label">Con PDF</span></div>
            <div class="match-stat warn"><span class="match-stat-value">${stats.lowConf}</span><span class="match-stat-label">Baja confianza</span></div>
            <div class="match-stat bad"><span class="match-stat-value">${stats.unmatched}</span><span class="match-stat-label">Sin match</span></div>
        `;
    }

    function renderMatchTable(filter) {
        const tbody = $('matchTableBody');
        tbody.innerHTML = '';
        let matches = MatchEngine.getMatches();

        if (filter === 'matched') {
            matches = matches.filter(m => m.questionMatch || m.pdfName);
        } else if (filter === 'unmatched') {
            matches = matches.filter(m => !m.questionMatch && !m.pdfName);
        } else if (filter === 'low') {
            matches = matches.filter(m =>
                (m.questionMatch && m.questionScore < 0.5) ||
                (m.pdfMatch && m.pdfScore < 0.5)
            );
        }

        const questions = questionsData ? questionsData.questions : [];
        const pdfs = pdfFields || [];

        for (const match of matches) {
            const tr = document.createElement('tr');
            const confScore = Math.max(match.questionScore, match.pdfScore);
            const confClass = confScore >= 0.7 ? 'conf-high' : confScore >= 0.4 ? 'conf-med' : 'conf-low';
            const confPct = Math.round(confScore * 100);

            tr.innerHTML = `
                <td class="match-field-name">
                    <span class="match-field-step">${escHtml(match.step)}</span>
                    <strong>${escHtml(match.fieldName)}</strong>
                    <span class="match-field-section">${escHtml(match.section)}</span>
                </td>
                <td>
                    <select class="match-select match-question-select" data-field-id="${match.fieldId}">
                        <option value="">— Sin match —</option>
                        ${questions.map((q, qi) => `
                            <option value="${qi}" ${match.questionMatch === q ? 'selected' : ''}>
                                ${escHtml(q.question || q.fieldId).substring(0, 80)}
                            </option>
                        `).join('')}
                    </select>
                </td>
                <td>
                    <input type="text" class="match-input match-pdf-input" data-field-id="${match.fieldId}"
                           value="${escAttr(match.pdfName)}" placeholder="Campo PDF..."
                           list="pdfFieldList">
                </td>
                <td><span class="conf-badge ${confClass}">${confPct}%</span></td>
                <td>
                    <button class="btn-clear-match" data-field-id="${match.fieldId}" title="Limpiar match">&times;</button>
                </td>
            `;
            tbody.appendChild(tr);
        }

        // PDF datalist for autocomplete
        let datalist = document.getElementById('pdfFieldList');
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'pdfFieldList';
            document.body.appendChild(datalist);
        }
        datalist.innerHTML = pdfs.map(pf => `<option value="${escAttr(pf.name)}">`).join('');

        // Wire change events
        tbody.querySelectorAll('.match-question-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const fieldId = sel.dataset.fieldId;
                const qi = sel.value;
                if (qi === '') {
                    MatchEngine.updateMatch(fieldId, {
                        questionMatch: null, questionScore: 0, questionText: '', questionOverride: false
                    });
                } else {
                    const q = questions[parseInt(qi)];
                    MatchEngine.updateMatch(fieldId, {
                        questionMatch: q, questionScore: 1.0, questionText: q.question, questionOverride: true
                    });
                }
                renderMatchStats();
            });
        });

        tbody.querySelectorAll('.match-pdf-input').forEach(input => {
            input.addEventListener('change', () => {
                MatchEngine.updateMatch(input.dataset.fieldId, {
                    pdfName: input.value, pdfOverride: true, pdfScore: input.value ? 1.0 : 0
                });
                renderMatchStats();
            });
        });

        tbody.querySelectorAll('.btn-clear-match').forEach(btn => {
            btn.addEventListener('click', () => {
                MatchEngine.updateMatch(btn.dataset.fieldId, {
                    questionMatch: null, questionScore: 0, questionText: '',
                    pdfMatch: null, pdfScore: 0, pdfName: '',
                    questionOverride: false, pdfOverride: false
                });
                renderMatchTable(filter);
                renderMatchStats();
            });
        });
    }

    // === BUILDER SCREEN ===

    function initBuilderScreen() {
        // Init preview
        PreviewEngine.init($('previewFrame'));

        // Render field tree
        renderFieldTree();
        updateStats();

        // Generate initial preview
        regeneratePreview();

        // Wire up events
        initBuilderEvents();
    }

    function initBuilderEvents() {
        // Variant filter
        $('variantFilter').addEventListener('change', () => {
            renderFieldTree();
            updateStats();
        });

        // Search
        $('searchField').addEventListener('input', debounce(() => {
            renderFieldTree();
        }, 200));

        // Tabs
        document.querySelectorAll('.preview-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.preview-tabs .tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $('tab' + capitalize(tab.dataset.tab)).classList.add('active');

                // Show/hide apply buttons based on active tab
                const activeTab = tab.dataset.tab;
                const btnApplyHtml = $('btnApplyHtml');
                const btnApplyJson = $('btnApplyJson');
                if (activeTab === 'html') {
                    if (btnApplyHtml && PreviewEngine.isHtmlDirty()) btnApplyHtml.hidden = false;
                    if (btnApplyJson) btnApplyJson.hidden = true;
                } else if (activeTab === 'json') {
                    if (btnApplyJson && PreviewEngine.isJsonDirty()) btnApplyJson.hidden = false;
                    if (btnApplyHtml) btnApplyHtml.hidden = true;
                } else {
                    if (btnApplyHtml) btnApplyHtml.hidden = true;
                    if (btnApplyJson) btnApplyJson.hidden = true;
                }
            });
        });

        // Regenerate
        $('btnRegenerate').addEventListener('click', regeneratePreview);

        // Downloads
        $('btnDownloadHTML').addEventListener('click', () => PreviewEngine.downloadHtml('formulario.html'));
        $('btnDownloadJSON').addEventListener('click', () => PreviewEngine.downloadJson('schema.json'));

        // Back to upload
        $('btnBackToUpload').addEventListener('click', () => showScreen('uploadScreen'));

        // Close props
        $('btnCloseProps').addEventListener('click', () => {
            $('panelRight').classList.remove('open');
            FieldManager.selectField(null);
        });

        // Listen for field changes — update properties panel AND live-refresh preview
        FieldManager.onChange(() => {
            const selected = FieldManager.getSelectedField();
            if (selected) renderProperties(selected);
            // Auto-regenerate preview with debounce
            schedulePreviewUpdate();
        });
    }

    function renderFieldTree() {
        const variant = $('variantFilter').value;
        const search = $('searchField').value;
        const tree = FieldManager.getFieldTree(variant, search);
        const container = $('fieldTree');
        container.innerHTML = '';

        for (const step of tree) {
            const stepEl = document.createElement('div');
            stepEl.className = 'tree-step';

            const stepHeader = document.createElement('div');
            stepHeader.className = 'tree-step-header';
            stepHeader.innerHTML = `
                <svg class="tree-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                <span class="tree-step-name">${escHtml(step.name)}</span>
                <span class="tree-step-count">${step.fieldCount}</span>
            `;
            stepHeader.addEventListener('click', () => {
                stepEl.classList.toggle('collapsed');
            });
            stepEl.appendChild(stepHeader);

            const stepBody = document.createElement('div');
            stepBody.className = 'tree-step-body';

            for (const section of step.sections) {
                const secEl = document.createElement('div');
                secEl.className = 'tree-section';
                secEl.innerHTML = `<div class="tree-section-name">${escHtml(section.name)}</div>`;

                for (const field of section.fields) {
                    const badge = FieldManager.TYPE_BADGES[field.dataType] || FieldManager.TYPE_BADGES['text'];
                    const fieldEl = document.createElement('div');
                    fieldEl.className = 'tree-field';
                    fieldEl.dataset.fieldId = field.id;
                    fieldEl.title = field.jsonPath || '';
                    fieldEl.innerHTML = `
                        <span class="field-badge" style="background:${badge.color}">${badge.label}</span>
                        <span class="field-name">${escHtml(field.fieldName)}</span>
                        ${field.required ? '<span class="field-required-dot"></span>' : ''}
                    `;
                    fieldEl.addEventListener('click', () => selectField(field.id));
                    secEl.appendChild(fieldEl);
                }

                stepBody.appendChild(secEl);
            }

            stepEl.appendChild(stepBody);
            container.appendChild(stepEl);
        }
    }

    function updateStats() {
        const variant = $('variantFilter').value;
        const stats = FieldManager.getStats(variant);
        $('statSteps').textContent = stats.steps;
        $('statFields').textContent = stats.fields;
        $('statRequired').textContent = stats.required;
        $('statJson').textContent = stats.json;
    }

    function selectField(id) {
        FieldManager.selectField(id);
        const field = FieldManager.getFieldById(id);
        if (!field) return;

        // Highlight in tree
        document.querySelectorAll('.tree-field').forEach(el => el.classList.remove('selected'));
        const el = document.querySelector(`[data-field-id="${id}"]`);
        if (el) el.classList.add('selected');

        // Open and populate properties panel
        $('panelRight').classList.add('open');
        renderProperties(field);
    }

    function renderProperties(field) {
        const container = $('propsContent');
        const badge = FieldManager.TYPE_BADGES[field.dataType] || FieldManager.TYPE_BADGES['text'];

        container.innerHTML = `
            <div class="props-section">
                <div class="props-section-title">Campo</div>
                <div class="props-field">
                    <label>Nombre</label>
                    <input type="text" class="props-input" id="propName" value="${escAttr(field.fieldName)}">
                </div>
                <div class="props-field">
                    <label>Tipo de dato</label>
                    <select class="props-input" id="propType">
                        <option value="text" ${field.dataType === 'text' ? 'selected' : ''}>Texto</option>
                        <option value="number" ${field.dataType === 'number' ? 'selected' : ''}>Numérico</option>
                        <option value="date" ${field.dataType === 'date' ? 'selected' : ''}>Fecha</option>
                        <option value="select" ${field.dataType === 'select' ? 'selected' : ''}>Combo</option>
                        <option value="radio" ${field.dataType === 'radio' ? 'selected' : ''}>Radio</option>
                        <option value="checkbox" ${field.dataType === 'checkbox' ? 'selected' : ''}>Check box</option>
                    </select>
                </div>
                <div class="props-field">
                    <label>Regla de validación</label>
                    <input type="text" class="props-input" id="propRule" value="${escAttr(field.rule)}">
                </div>
                <div class="props-field props-toggle">
                    <label>Obligatorio</label>
                    <label class="toggle">
                        <input type="checkbox" id="propRequired" ${field.required ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div class="props-section">
                <div class="props-section-title">Personalización</div>
                <div class="props-field">
                    <label>Label personalizado</label>
                    <input type="text" class="props-input" id="propLabel" value="${escAttr(field.customLabel)}" placeholder="${escAttr(field.fieldName)}">
                </div>
                <div class="props-field">
                    <label>Placeholder</label>
                    <input type="text" class="props-input" id="propPlaceholder" value="${escAttr(field.placeholder)}">
                </div>
                <div class="props-field">
                    <label>Ancho</label>
                    <select class="props-input" id="propWidth">
                        <option value="col-12" ${field.colWidth === 'col-12' ? 'selected' : ''}>Full (col-12)</option>
                        <option value="col-md-6" ${field.colWidth === 'col-md-6' ? 'selected' : ''}>Mitad (col-md-6)</option>
                        <option value="col-md-4" ${field.colWidth === 'col-md-4' ? 'selected' : ''}>Tercio (col-md-4)</option>
                    </select>
                </div>
            </div>

            ${field.options && field.options.length > 0 ? `
            <div class="props-section">
                <div class="props-section-title">Opciones</div>
                <div id="optionsList" class="options-list">
                    ${field.options.map((opt, i) => `
                        <div class="option-item">
                            <input type="text" class="props-input option-input" value="${escAttr(opt)}" data-index="${i}">
                            <button class="btn-remove-option" data-index="${i}">&times;</button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn-add-option" id="btnAddOption">+ Agregar opción</button>
            </div>
            ` : ''}

            <div class="props-section">
                <div class="props-section-title">Mapeo</div>
                <div class="props-field">
                    <label>Ruta JSON</label>
                    <textarea class="props-input props-readonly" readonly>${escHtml(field.jsonPath)}</textarea>
                </div>
                <div class="props-field">
                    <label>Campo PDF</label>
                    <input type="text" class="props-input props-readonly" readonly value="${escAttr(field.pdfField)}">
                </div>
            </div>

            <div class="props-section">
                <div class="props-section-title">Metadata</div>
                <div class="props-field">
                    <label>Variante</label>
                    <input type="text" class="props-input props-readonly" readonly value="${escAttr(field.variant)}">
                </div>
                ${field.obs ? `
                <div class="props-field">
                    <label>Observaciones</label>
                    <textarea class="props-input props-readonly" readonly>${escHtml(field.obs)}</textarea>
                </div>` : ''}
                ${field.notes ? `
                <div class="props-field">
                    <label>Notas</label>
                    <textarea class="props-input props-readonly" readonly>${escHtml(field.notes)}</textarea>
                </div>` : ''}
            </div>
        `;

        // Wire up property change events
        bindPropertyEvents(field);
    }

    function bindPropertyEvents(field) {
        const bind = (id, key, isCheckbox) => {
            const el = $(id);
            if (!el) return;
            el.addEventListener('change', () => {
                const val = isCheckbox ? el.checked : el.value;
                FieldManager.updateField(field.id, { [key]: val });
            });
        };

        bind('propName', 'fieldName');
        bind('propType', 'dataType');
        bind('propRule', 'rule');
        bind('propRequired', 'required', true);
        bind('propLabel', 'customLabel');
        bind('propPlaceholder', 'placeholder');
        bind('propWidth', 'colWidth');

        // Options management
        const optionsList = document.getElementById('optionsList');
        if (optionsList) {
            optionsList.querySelectorAll('.option-input').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.index);
                    const options = [...field.options];
                    options[idx] = input.value;
                    FieldManager.updateField(field.id, { options });
                });
            });

            optionsList.querySelectorAll('.btn-remove-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.index);
                    const options = field.options.filter((_, i) => i !== idx);
                    FieldManager.updateField(field.id, { options });
                    renderProperties(FieldManager.getFieldById(field.id));
                });
            });
        }

        const btnAdd = document.getElementById('btnAddOption');
        if (btnAdd) {
            btnAdd.addEventListener('click', () => {
                const options = [...(field.options || []), 'Nueva opción'];
                FieldManager.updateField(field.id, { options });
                renderProperties(FieldManager.getFieldById(field.id));
            });
        }
    }

    function regeneratePreview() {
        const variant = $('variantFilter').value;
        const fields = variant && variant !== 'all'
            ? FieldManager.getFilteredFields(variant)
            : FieldManager.getFields().filter(f => f.visible);
        PreviewEngine.render(fields);
    }

    // === UTILITIES ===

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escAttr(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // === INIT ===

    document.addEventListener('DOMContentLoaded', () => {
        initUploadScreen();
    });

})();
