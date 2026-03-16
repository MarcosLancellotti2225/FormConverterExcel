/**
 * DocPath Form Builder — Main Application
 */
(function () {
    'use strict';

    // State
    let uploadedFiles = [];
    let specData = null;
    let catalogData = null;

    // DOM refs
    const $ = id => document.getElementById(id);

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
            if (!file.name.match(/\.xlsx?$/i)) continue;
            const type = ExcelParser.detectFileType(file.name);
            uploadedFiles.push({ file, type, name: file.name, size: file.size });
        }
        renderFileList();
    }

    function renderFileList() {
        const container = $('fileList');
        container.innerHTML = '';

        for (let i = 0; i < uploadedFiles.length; i++) {
            const f = uploadedFiles[i];
            const sizeKB = (f.size / 1024).toFixed(1);
            const badgeClass = f.type === 'catalog' ? 'badge-catalog' : 'badge-spec';
            const badgeText = f.type === 'catalog' ? 'CATÁLOGO' : 'SPEC';

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

        // Toggle file type on badge click
        container.querySelectorAll('.file-badge').forEach(badge => {
            badge.addEventListener('click', e => {
                e.stopPropagation();
                const idx = parseInt(badge.dataset.index);
                uploadedFiles[idx].type = uploadedFiles[idx].type === 'spec' ? 'catalog' : 'spec';
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

        // Enable generate button if spec exists
        const hasSpec = uploadedFiles.some(f => f.type === 'spec');
        $('btnGenerate').disabled = !hasSpec;
    }

    async function generateForm() {
        const progressBar = $('progressBar');
        const progressFill = progressBar.querySelector('.progress-bar-fill');
        const progressText = progressBar.querySelector('.progress-bar-text');

        progressBar.hidden = false;
        $('btnGenerate').disabled = true;

        try {
            // Parse spec files
            progressText.textContent = 'Leyendo archivos Excel...';
            progressFill.style.width = '20%';

            for (const f of uploadedFiles) {
                const arrayBuffer = await f.file.arrayBuffer();
                const result = ExcelParser.parseFile(arrayBuffer, f.name);

                if (result.type === 'spec') {
                    specData = result.data;
                } else {
                    catalogData = result.data;
                }
            }

            if (!specData) {
                throw new Error('No se encontró un archivo de especificación válido');
            }

            progressText.textContent = 'Procesando campos...';
            progressFill.style.width = '50%';

            // Initialize field manager
            FieldManager.init(specData, catalogData);

            progressText.textContent = 'Detectando lógica condicional...';
            progressFill.style.width = '70%';

            FieldManager.detectConditionals();

            progressText.textContent = 'Generando formulario...';
            progressFill.style.width = '90%';

            // Switch to builder screen
            await delay(300);
            showScreen('builderScreen');
            initBuilderScreen();

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

        // Listen for field changes
        FieldManager.onChange(() => {
            const selected = FieldManager.getSelectedField();
            if (selected) renderProperties(selected);
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
