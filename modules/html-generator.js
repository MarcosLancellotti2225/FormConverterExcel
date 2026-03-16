/**
 * HTML Generator Module
 * Generates INS-styled multi-step form HTML from field definitions
 * with fully interactive preview (stepper, conditionals, dynamic sections)
 */
const HtmlGenerator = (() => {
    'use strict';

    const INS_CSS = `
/* INS Form Design System */
:root {
    --primary: rgba(8, 99, 120, 1.00);
    --primary-foreground: rgba(252, 252, 252, 1.00);
    --color-accent-custom: rgba(186, 212, 49, 1.00);
    --color-success: rgba(186, 212, 49, 1.00);
    --destructive: rgba(207, 37, 37, 1.00);
    --border: rgba(172, 176, 178, 1.00);
    --muted: rgba(231, 235, 237, 1.00);
    --muted-foreground: rgba(124, 127, 128, 1.00);
    --background: rgba(255, 255, 255, 1.00);
    --radius: 8px;
    --container-max-width: 768px;
}

* { box-sizing: border-box; }

body {
    font-family: 'Open Sans', sans-serif;
    background: #f0f2f5;
    color: #1a1a2e;
    margin: 0;
    padding: 0;
}

.app-header {
    background: var(--primary);
    color: var(--primary-foreground);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
}

.header-logo-text {
    font-size: 20px;
    font-weight: 700;
    color: var(--primary-foreground);
}

.sticky-subheader {
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    padding: 16px 24px 0;
    position: sticky;
    top: 52px;
    z-index: 90;
}

.subheader-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--primary);
    margin: 0 0 12px;
}

.stepper-horizontal {
    display: flex;
    gap: 0;
    overflow-x: auto;
    padding-bottom: 0;
}

.stepper-step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    font-size: 13px;
    color: var(--muted-foreground);
    transition: all 0.2s;
    user-select: none;
}

.stepper-step:hover { background: rgba(8,99,120,0.03); }

.stepper-step.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
    font-weight: 600;
}

.stepper-step.completed {
    color: var(--color-success);
    border-bottom-color: var(--color-success);
}

.stepper-step.completed .stepper-number {
    background: var(--color-success);
    color: #fff;
}

.stepper-number {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--muted);
    color: var(--muted-foreground);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
}

.stepper-step.active .stepper-number {
    background: var(--primary);
    color: #fff;
}

.form-body {
    max-width: var(--container-max-width);
    margin: 0 auto;
    padding: 24px 16px;
}

.step-section {
    display: none;
    animation: fadeIn 0.25s ease;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
}

.step-section.active {
    display: block;
}

.step-header h2 {
    font-size: 20px;
    font-weight: 700;
    color: var(--primary);
    margin: 0 0 16px;
}

.form-card {
    background: #fff;
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.card-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--primary);
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--color-accent-custom);
}

.form-group { margin-bottom: 16px; }

.form-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #333;
    margin-bottom: 4px;
}

.form-label .required-mark {
    color: var(--destructive);
    margin-left: 2px;
}

.form-control, .form-select {
    width: 100%;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    padding: 8px 12px;
    font-size: 14px;
    font-family: 'Open Sans', sans-serif;
    transition: border-color 0.2s, box-shadow 0.2s;
}

.form-control:focus, .form-select:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(8, 99, 120, 0.1);
    outline: none;
}

.form-control:disabled, .form-select:disabled {
    background: var(--muted);
    color: var(--muted-foreground);
    cursor: not-allowed;
}

.form-control.is-invalid { border-color: var(--destructive); }

.form-check-group {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.form-check-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border: 2px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all 0.15s;
    font-size: 14px;
    user-select: none;
}

.form-check-card:hover {
    border-color: var(--primary);
    background: rgba(8, 99, 120, 0.02);
}

.form-check-card.selected {
    border-color: var(--primary);
    background: rgba(8, 99, 120, 0.06);
    font-weight: 600;
}

.form-check-card input[type="radio"],
.form-check-card input[type="checkbox"] {
    accent-color: var(--primary);
    width: 16px;
    height: 16px;
}

.form-hint {
    font-size: 12px;
    color: var(--muted-foreground);
    margin-top: 4px;
}

/* Conditional sections */
.conditional-section {
    display: none;
    padding: 16px 20px;
    margin: 12px 0;
    background: rgba(8, 99, 120, 0.03);
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius) var(--radius) 0;
    animation: fadeIn 0.25s ease;
}

.conditional-section.visible {
    display: block;
}

/* Conditional indicator badge */
.cond-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: 6px;
    vertical-align: middle;
}

.cond-badge-trigger {
    background: rgba(245, 158, 11, 0.15);
    color: #d97706;
}

.cond-badge-target {
    background: rgba(8, 99, 120, 0.1);
    color: var(--primary);
}

/* Dynamic sections */
.dynamic-section { position: relative; }

.dynamic-item {
    position: relative;
    padding: 16px;
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: rgba(255,255,255,0.5);
}

.dynamic-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    font-weight: 600;
    font-size: 14px;
    color: var(--primary);
}

.btn-remove-item {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted-foreground);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
}

.btn-remove-item:hover {
    color: var(--destructive);
    border-color: var(--destructive);
}

.dynamic-section-controls {
    margin-top: 12px;
    text-align: center;
}

.btn-add-item {
    background: none;
    border: 2px dashed var(--primary);
    color: var(--primary);
    padding: 10px 24px;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s;
    width: 100%;
}

.btn-add-item:hover {
    background: rgba(8, 99, 120, 0.05);
}

/* Step progress bar */
.step-progress {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
}

.step-progress-segment {
    flex: 1;
    height: 4px;
    background: var(--muted);
    border-radius: 2px;
    transition: background 0.3s;
}

.step-progress-segment.done { background: var(--color-success); }
.step-progress-segment.current { background: var(--primary); }

/* Navigation */
.action-buttons {
    display: flex;
    justify-content: space-between;
    margin-top: 24px;
    padding: 16px 0;
    gap: 12px;
}

.btn-back, .btn-next {
    padding: 12px 32px;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    font-family: 'Open Sans', sans-serif;
}

.btn-back {
    background: var(--muted);
    color: #333;
}

.btn-back:hover { background: #d5d9db; }

.btn-next {
    background: var(--primary);
    color: var(--primary-foreground);
}

.btn-next:hover { opacity: 0.9; }

.app-footer {
    background: var(--primary);
    color: var(--primary-foreground);
    text-align: center;
    padding: 16px;
    font-size: 12px;
    margin-top: 40px;
}

/* Prefilled indicator */
[data-prefilled="true"] .form-control,
[data-prefilled="true"] .form-select {
    background: #f8f9fa;
    font-style: italic;
}

[data-prefilled="true"]::after {
    content: "Pre-cargado";
    font-size: 10px;
    color: var(--muted-foreground);
    font-style: italic;
}

/* Tooltip for field metadata */
.field-meta-tooltip {
    display: none;
    position: absolute;
    background: #1a1a2e;
    color: #fff;
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 4px;
    z-index: 50;
    white-space: nowrap;
    pointer-events: none;
}

@media (max-width: 768px) {
    .stepper-horizontal { display: none; }
    .form-check-group { flex-direction: column; }
    .action-buttons { flex-direction: column; }
    .btn-back, .btn-next { width: 100%; text-align: center; }
}
`;

    /**
     * Full interactive JS for the generated form
     */
    function buildINS_JS(steps, dynamicSections, conditionalMap) {
        return `
// ========================================
// INS Form — Interactive Logic
// ========================================
(function() {
    'use strict';

    // === STEP NAVIGATION ===
    let currentStep = 1;
    const totalSteps = ${steps.length};
    const stepperSteps = document.querySelectorAll('.stepper-step');
    const progressSegments = document.querySelectorAll('.step-progress-segment');

    function showStep(n) {
        if (n < 1 || n > totalSteps) return;
        document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
        const target = document.querySelector('[data-step="' + n + '"]');
        if (target) target.classList.add('active');

        stepperSteps.forEach(function(s, i) {
            s.classList.toggle('active', i + 1 === n);
            s.classList.toggle('completed', i + 1 < n);
        });

        progressSegments.forEach(function(seg, i) {
            seg.classList.toggle('done', i + 1 < n);
            seg.classList.toggle('current', i + 1 === n);
        });

        currentStep = n;
        updateButtons();
        document.querySelector('.form-body').scrollTo({ top: 0, behavior: 'smooth' });
    }

    function updateButtons() {
        var btnBack = document.getElementById('btnBack');
        var btnNext = document.getElementById('btnNext');
        if (btnBack) btnBack.style.visibility = currentStep === 1 ? 'hidden' : 'visible';
        if (btnNext) btnNext.textContent = currentStep === totalSteps ? 'Enviar' : 'Siguiente \\u2192';
    }

    var btnNext = document.getElementById('btnNext');
    var btnBack = document.getElementById('btnBack');
    if (btnNext) btnNext.addEventListener('click', function() {
        if (currentStep < totalSteps) showStep(currentStep + 1);
        else alert('Formulario enviado (demo)');
    });
    if (btnBack) btnBack.addEventListener('click', function() {
        if (currentStep > 1) showStep(currentStep - 1);
    });

    stepperSteps.forEach(function(s) {
        s.addEventListener('click', function() {
            showStep(parseInt(this.dataset.stepIndex));
        });
    });

    // === CONDITIONAL LOGIC (Si/No toggles) ===
    var conditionalMap = ${JSON.stringify(conditionalMap)};

    document.querySelectorAll('[data-toggle-target]').forEach(function(radio) {
        radio.addEventListener('change', function() {
            var targetId = this.dataset.toggleTarget;
            var target = document.getElementById(targetId);
            if (!target) return;

            var action = this.dataset.toggleAction;
            if (action === 'show') {
                target.classList.add('visible');
                target.style.display = 'block';
                // Enable inputs inside
                target.querySelectorAll('input, select, textarea').forEach(function(el) {
                    el.disabled = false;
                });
            } else {
                target.classList.remove('visible');
                target.style.display = 'none';
                // Disable & clear inputs inside
                target.querySelectorAll('input, select, textarea').forEach(function(el) {
                    el.disabled = true;
                    if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
                    else el.value = '';
                });
            }
        });
    });

    // === RADIO CARD SELECTION UI ===
    document.querySelectorAll('.form-check-card').forEach(function(card) {
        var input = card.querySelector('input[type="radio"], input[type="checkbox"]');
        if (!input) return;

        card.addEventListener('click', function(e) {
            if (e.target === input) return; // let native handle
            input.checked = input.type === 'checkbox' ? !input.checked : true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        input.addEventListener('change', function() {
            if (input.type === 'radio') {
                var group = card.closest('.form-check-group');
                if (group) group.querySelectorAll('.form-check-card').forEach(function(c) {
                    c.classList.remove('selected');
                });
            }
            card.classList.toggle('selected', input.checked);
        });
    });

    // === DYNAMIC SECTIONS (Dependientes / Beneficiarios) ===
    ${dynamicSections.map(ds => `
    (function() {
        var container = document.getElementById('${ds.containerId}');
        var addBtn = document.getElementById('${ds.addBtnId}');
        var counter = 1;
        var template = container ? container.querySelector('.dynamic-item').outerHTML : '';

        if (addBtn && container) {
            addBtn.addEventListener('click', function() {
                counter++;
                var newItem = document.createElement('div');
                newItem.innerHTML = template.replace(/${ds.itemLabel} #1/g, '${ds.itemLabel} #' + counter);
                var item = newItem.firstElementChild;
                // Clear values
                item.querySelectorAll('input, select, textarea').forEach(function(el) {
                    if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
                    else el.value = '';
                });
                // Wire remove button
                var removeBtn = item.querySelector('.btn-remove-item');
                if (removeBtn) removeBtn.addEventListener('click', function() {
                    item.remove();
                    renumber();
                });
                container.appendChild(item);
                renumber();

                // Re-bind radio cards in new item
                item.querySelectorAll('.form-check-card').forEach(function(card) {
                    var inp = card.querySelector('input[type="radio"]');
                    if (inp) card.addEventListener('click', function(e) {
                        if (e.target !== inp) { inp.checked = true; inp.dispatchEvent(new Event('change', {bubbles:true})); }
                    });
                });
            });

            // Wire remove on initial items
            container.querySelectorAll('.btn-remove-item').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (container.querySelectorAll('.dynamic-item').length > 1) {
                        btn.closest('.dynamic-item').remove();
                        renumber();
                    }
                });
            });

            function renumber() {
                container.querySelectorAll('.dynamic-item').forEach(function(item, idx) {
                    var header = item.querySelector('.dynamic-item-number');
                    if (header) header.textContent = '${ds.itemLabel} #' + (idx + 1);
                });
            }
        }
    })();
    `).join('\n')}

    // === INITIALIZE ===
    showStep(1);
})();
`;
    }

    /**
     * Generate complete HTML form from fields
     */
    function generate(fields, options = {}) {
        const title = options.title || 'Formulario INS';
        const visibleFields = fields.filter(f => f.visible);
        const steps = organizeBySteps(visibleFields);

        // Collect dynamic sections info
        const dynamicSections = [];
        // Collect conditional map
        const conditionalMap = {};

        // Pre-scan for conditionals
        for (const field of visibleFields) {
            if (field.conditionalTrigger) {
                conditionalMap[field.id] = {
                    triggerName: field.fieldName,
                    targetIds: field.conditionalTrigger.targetIds,
                    showWhen: field.conditionalTrigger.showWhen || 'si'
                };
            }
        }

        let html = buildDoctype(title);
        html += buildHeader(title);
        html += buildStepper(steps);
        html += '<main class="form-body">\n';
        html += buildProgressBar(steps);
        html += '<form id="mainForm" novalidate>\n';

        steps.forEach((step, idx) => {
            html += buildStep(step, idx + 1, dynamicSections);
        });

        html += '</form>\n';
        html += buildActionButtons();
        html += '</main>\n';
        html += buildFooter();
        html += `    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"><\/script>\n`;
        html += `    <script>${buildINS_JS(steps, dynamicSections, conditionalMap)}<\/script>\n`;
        html += '</body>\n</html>';

        return html;
    }

    function organizeBySteps(fields) {
        const stepMap = new Map();
        for (const field of fields) {
            const stepName = field.step || 'General';
            if (!stepMap.has(stepName)) {
                stepMap.set(stepName, { name: stepName, sections: new Map() });
            }
            const step = stepMap.get(stepName);
            const sectionName = field.section || 'General';
            if (!step.sections.has(sectionName)) {
                step.sections.set(sectionName, []);
            }
            step.sections.get(sectionName).push(field);
        }
        return Array.from(stepMap.values());
    }

    function buildDoctype(title) {
        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escHtml(title)}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${INS_CSS}</style>
</head>
<body>
`;
    }

    function buildHeader(title) {
        return `    <header class="app-header">
        <span class="header-logo-text">INS</span>
        <span style="font-size:13px;">Formulario Digital</span>
    </header>
`;
    }

    function buildStepper(steps) {
        let html = '    <div class="sticky-subheader">\n';
        html += '        <h1 class="subheader-title">Formulario</h1>\n';
        html += '        <div class="stepper-horizontal">\n';
        steps.forEach((step, idx) => {
            const activeClass = idx === 0 ? ' active' : '';
            html += `            <div class="stepper-step${activeClass}" data-step-index="${idx + 1}">
                <span class="stepper-number">${idx + 1}</span>
                <span>${escHtml(step.name)}</span>
            </div>\n`;
        });
        html += '        </div>\n    </div>\n\n';
        return html;
    }

    function buildProgressBar(steps) {
        let html = '    <div class="step-progress">\n';
        steps.forEach((_, idx) => {
            const cls = idx === 0 ? ' current' : '';
            html += `        <div class="step-progress-segment${cls}"></div>\n`;
        });
        html += '    </div>\n';
        return html;
    }

    function buildStep(step, stepNum, dynamicSections) {
        const activeClass = stepNum === 1 ? ' active' : '';
        let html = `    <section class="step-section${activeClass}" data-step="${stepNum}">\n`;
        html += `        <div class="step-header"><h2>${escHtml(step.name)}</h2></div>\n`;

        for (const [sectionName, fields] of step.sections) {
            const sectionLower = sectionName.toLowerCase();
            const isDynamic = sectionLower.includes('dependiente') || sectionLower.includes('beneficiario');
            const containerId = isDynamic ? `dynamic_${sanitizeId(sectionName)}` : '';
            const itemLabel = sectionLower.includes('dependiente') ? 'Dependiente' : 'Beneficiario';

            html += `        <div class="form-card${isDynamic ? ' dynamic-section' : ''}">\n`;
            html += `            <h3 class="card-title">${escHtml(sectionName)}</h3>\n`;

            if (isDynamic) {
                const addBtnId = `btn_add_${sanitizeId(sectionName)}`;
                html += `            <div id="${containerId}">\n`;
                html += `                <div class="dynamic-item">\n`;
                html += `                    <div class="dynamic-item-header">\n`;
                html += `                        <span class="dynamic-item-number">${itemLabel} #1</span>\n`;
                html += `                        <button type="button" class="btn-remove-item">Eliminar</button>\n`;
                html += `                    </div>\n`;
                html += `                    <div class="row g-3">\n`;
                for (const field of fields) {
                    html += buildField(field);
                }
                html += `                    </div>\n`;
                html += `                </div>\n`;
                html += `            </div>\n`;
                html += `            <div class="dynamic-section-controls">\n`;
                html += `                <button type="button" class="btn-add-item" id="${addBtnId}">+ Agregar ${itemLabel.toLowerCase()}</button>\n`;
                html += `            </div>\n`;

                dynamicSections.push({ containerId, addBtnId, itemLabel });
            } else {
                html += `            <div class="row g-3 form-card-grid">\n`;
                for (const field of fields) {
                    html += buildField(field);
                }
                html += `            </div>\n`;
            }

            html += `        </div>\n`;
        }

        html += `    </section>\n\n`;
        return html;
    }

    function buildField(field) {
        const colClass = field.colWidth || 'col-12';
        const requiredAttr = field.required ? ' required' : '';
        const disabledAttr = field.prefilled ? ' disabled' : '';
        const prefilledData = field.prefilled ? ' data-prefilled="true"' : '';
        const requiredMark = field.required ? ' <span class="required-mark">*</span>' : '';
        const label = field.customLabel || field.label || field.fieldName;

        const trigger = field.conditionalTrigger;
        const triggerBadge = trigger
            ? ' <span class="cond-badge cond-badge-trigger">CONDICIONAL</span>'
            : '';
        const targetBadge = field.conditionalTarget
            ? ' <span class="cond-badge cond-badge-target">DEPENDE DE...</span>'
            : '';

        let html = `                <div class="${colClass} form-group"
                    data-json-path="${escAttr(field.jsonPath)}"
                    data-pdf-field="${escAttr(field.pdfField)}"
                    data-required="${field.required}"
                    data-field-id="${field.id}"${prefilledData}>\n`;

        html += `                    <label class="form-label">${escHtml(label)}${requiredMark}${triggerBadge}${targetBadge}</label>\n`;

        switch (field.dataType) {
            case 'select':
                html += buildSelect(field, requiredAttr, disabledAttr);
                break;
            case 'radio':
                html += buildRadio(field, requiredAttr, trigger);
                break;
            case 'checkbox':
                html += buildCheckbox(field);
                break;
            case 'date':
                html += `                    <input type="text" class="form-control" placeholder="dd/mm/aaaa" name="${sanitizeId(field.id)}"${requiredAttr}${disabledAttr}>\n`;
                break;
            default:
                html += buildTextInput(field, requiredAttr, disabledAttr);
                break;
        }

        if (field.rule) {
            html += `                    <div class="form-hint">${escHtml(field.rule)}</div>\n`;
        }

        html += `                </div>\n`;

        // Conditional section (sub-fields that appear on "Si")
        if (trigger) {
            html += buildConditionalSection(field, trigger);
        }

        return html;
    }

    function buildTextInput(field, requiredAttr, disabledAttr) {
        const placeholder = field.placeholder ? ` placeholder="${escAttr(field.placeholder)}"` : '';
        const maxLen = field.validation && field.validation.maxLength ? ` maxlength="${field.validation.maxLength}"` : '';
        return `                    <input type="text" class="form-control" name="${sanitizeId(field.id)}"${placeholder}${maxLen}${requiredAttr}${disabledAttr}>\n`;
    }

    function buildSelect(field, requiredAttr, disabledAttr) {
        let html = `                    <select class="form-select" name="${sanitizeId(field.id)}"${requiredAttr}${disabledAttr}>\n`;
        html += `                        <option value="">Seleccionar...</option>\n`;
        for (const opt of (field.options || [])) {
            html += `                        <option value="${escAttr(opt)}">${escHtml(opt)}</option>\n`;
        }
        html += `                    </select>\n`;
        return html;
    }

    function buildRadio(field, requiredAttr, trigger) {
        const name = sanitizeId(field.id);
        let html = `                    <div class="form-check-group">\n`;

        for (const opt of (field.options || [])) {
            const optVal = opt.toLowerCase().trim();
            let toggleAttrs = '';

            if (trigger) {
                const isSi = optVal === 'si' || optVal === 'sí';
                toggleAttrs = ` data-toggle-target="cond_${field.id}" data-toggle-action="${isSi ? 'show' : 'hide'}"`;
            }

            html += `                        <label class="form-check-card">
                            <input type="radio" name="${name}" value="${escAttr(optVal)}"${toggleAttrs}${requiredAttr}>
                            <span>${escHtml(opt)}</span>
                        </label>\n`;
        }

        html += `                    </div>\n`;
        return html;
    }

    function buildCheckbox(field) {
        const name = sanitizeId(field.id);
        return `                    <div class="form-check">
                        <label class="form-check-card">
                            <input type="checkbox" name="${name}" id="chk_${field.id}">
                            <span>${escHtml(field.value || field.fieldName)}</span>
                        </label>
                    </div>\n`;
    }

    function buildConditionalSection(field, trigger) {
        const allFields = FieldManager.getFields();
        const targetFields = trigger.targetIds
            .map(id => allFields.find(f => f.id === id))
            .filter(Boolean);

        if (targetFields.length === 0) return '';

        let html = `                <div class="conditional-section" id="cond_${field.id}">\n`;
        html += `                    <div class="row g-3">\n`;
        for (const tf of targetFields) {
            const placeholder = tf.placeholder ? ` placeholder="${escAttr(tf.placeholder)}"` : '';
            const tfLabel = tf.customLabel || tf.label || tf.fieldName;
            const reqMark = tf.required ? ' <span class="required-mark">*</span>' : '';
            html += `                        <div class="col-12 form-group" data-field-id="${tf.id}" data-json-path="${escAttr(tf.jsonPath)}">
                            <label class="form-label">${escHtml(tfLabel)}${reqMark}</label>
                            <input type="text" class="form-control" name="${sanitizeId(tf.id)}"${placeholder} disabled>
                        </div>\n`;
        }
        html += `                    </div>\n`;
        html += `                </div>\n`;
        return html;
    }

    function buildActionButtons() {
        return `    <div class="action-buttons">
        <button type="button" class="btn-back" id="btnBack" style="visibility:hidden">\\u2190 Anterior</button>
        <button type="button" class="btn-next" id="btnNext">Siguiente \\u2192</button>
    </div>\n`;
    }

    function buildFooter() {
        return `    <footer class="app-footer">
        <p>&copy; Instituto Nacional de Seguros &mdash; Formulario Digital</p>
    </footer>\n`;
    }

    // Helpers
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escAttr(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function sanitizeId(str) {
        return String(str).replace(/[^a-zA-Z0-9_]/g, '_');
    }

    return { generate };
})();
