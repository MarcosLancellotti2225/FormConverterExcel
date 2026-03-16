/**
 * HTML Generator Module
 * Generates INS-styled multi-step form HTML from field definitions
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
}

.stepper-step.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
    font-weight: 600;
}

.stepper-step.completed {
    color: var(--color-success);
    border-bottom-color: var(--color-success);
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

.form-label {
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
    border-radius: var(--radius);
    border: 1px solid var(--border);
    padding: 8px 12px;
    font-size: 14px;
    font-family: 'Open Sans', sans-serif;
    transition: border-color 0.2s;
}

.form-control:focus, .form-select:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(8, 99, 120, 0.1);
    outline: none;
}

.form-control:disabled {
    background: var(--muted);
    color: var(--muted-foreground);
    cursor: not-allowed;
}

.form-check-group {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.form-check-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
}

.form-check-card:hover {
    border-color: var(--primary);
}

.form-check-card input:checked + .form-check-card-label {
    color: var(--primary);
}

.form-check-card.selected {
    border-color: var(--primary);
    background: rgba(8, 99, 120, 0.05);
}

.form-hint {
    font-size: 12px;
    color: var(--muted-foreground);
    margin-top: 4px;
}

.conditional-section {
    display: none;
    padding: 16px;
    margin-top: 8px;
    background: rgba(8, 99, 120, 0.02);
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius) var(--radius) 0;
}

.conditional-section.visible {
    display: block;
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
}

.btn-add-item:hover {
    background: rgba(8, 99, 120, 0.05);
}

.action-buttons {
    display: flex;
    justify-content: space-between;
    margin-top: 24px;
    padding: 16px 0;
}

.btn-back, .btn-next {
    padding: 10px 32px;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
}

.btn-back {
    background: var(--muted);
    color: #333;
}

.btn-next {
    background: var(--primary);
    color: var(--primary-foreground);
}

.btn-next:hover {
    opacity: 0.9;
}

.app-footer {
    background: var(--primary);
    color: var(--primary-foreground);
    text-align: center;
    padding: 16px;
    font-size: 12px;
    margin-top: 40px;
}

@media (max-width: 768px) {
    .stepper-horizontal { display: none; }
    .form-check-group { flex-direction: column; }
}
`;

    const INS_JS = `
// Form navigation and conditional logic
(function() {
    'use strict';
    let currentStep = 1;
    const totalSteps = document.querySelectorAll('.step-section').length;
    const stepperSteps = document.querySelectorAll('.stepper-step');

    function showStep(n) {
        document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
        const target = document.querySelector('[data-step="' + n + '"]');
        if (target) target.classList.add('active');
        stepperSteps.forEach((s, i) => {
            s.classList.toggle('active', i + 1 === n);
            s.classList.toggle('completed', i + 1 < n);
        });
        currentStep = n;
        updateButtons();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function updateButtons() {
        const btnBack = document.getElementById('btnBack');
        const btnNext = document.getElementById('btnNext');
        if (btnBack) btnBack.style.visibility = currentStep === 1 ? 'hidden' : 'visible';
        if (btnNext) btnNext.textContent = currentStep === totalSteps ? 'Enviar' : 'Siguiente';
    }

    document.getElementById('btnNext')?.addEventListener('click', function() {
        if (currentStep < totalSteps) showStep(currentStep + 1);
    });

    document.getElementById('btnBack')?.addEventListener('click', function() {
        if (currentStep > 1) showStep(currentStep - 1);
    });

    stepperSteps.forEach(s => {
        s.addEventListener('click', function() {
            showStep(parseInt(this.dataset.stepIndex));
        });
    });

    // Conditional logic: Si/No toggles
    document.querySelectorAll('[data-toggle-target]').forEach(radio => {
        radio.addEventListener('change', function() {
            const target = document.getElementById(this.dataset.toggleTarget);
            if (!target) return;
            const show = this.dataset.toggleAction === 'show';
            target.style.display = show ? 'block' : 'none';
            if (show) target.classList.add('visible');
            else target.classList.remove('visible');
        });
    });

    // Radio card selection
    document.querySelectorAll('.form-check-card input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', function() {
            this.closest('.form-check-group').querySelectorAll('.form-check-card').forEach(c => c.classList.remove('selected'));
            this.closest('.form-check-card').classList.add('selected');
        });
    });

    // Initialize
    showStep(1);
})();
`;

    /**
     * Generate complete HTML form from fields
     */
    function generate(fields, options = {}) {
        const title = options.title || 'Formulario INS';
        const steps = organizeBySteps(fields.filter(f => f.visible));
        const conditionals = options.conditionals || [];

        let html = buildDoctype(title);
        html += buildHeader(title);
        html += buildStepper(steps);
        html += '<main class="form-body">\n';
        html += '<form id="mainForm" novalidate>\n';

        steps.forEach((step, idx) => {
            html += buildStep(step, idx + 1, conditionals);
        });

        html += '</form>\n';
        html += buildActionButtons();
        html += '</main>\n';
        html += buildFooter();
        html += buildScripts();
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

    function buildStep(step, stepNum, conditionals) {
        const activeClass = stepNum === 1 ? ' active' : '';
        let html = `    <section class="step-section${activeClass}" data-step="${stepNum}">\n`;
        html += `        <div class="step-header"><h2>${escHtml(step.name)}</h2></div>\n`;

        for (const [sectionName, fields] of step.sections) {
            html += `        <div class="form-card">\n`;
            html += `            <h3 class="card-title">${escHtml(sectionName)}</h3>\n`;
            html += `            <div class="row g-3 form-card-grid">\n`;

            // Check if this is a dynamic section (dependientes, beneficiarios)
            const sectionLower = sectionName.toLowerCase();
            const isDynamic = sectionLower.includes('dependiente') || sectionLower.includes('beneficiario');

            for (const field of fields) {
                html += buildField(field, conditionals);
            }

            html += `            </div>\n`;

            if (isDynamic) {
                const itemName = sectionLower.includes('dependiente') ? 'dependiente' : 'beneficiario';
                html += `            <div class="dynamic-section-controls">\n`;
                html += `                <button type="button" class="btn-add-item">+ Agregar ${itemName}</button>\n`;
                html += `            </div>\n`;
            }

            html += `        </div>\n`;
        }

        html += `    </section>\n\n`;
        return html;
    }

    function buildField(field, conditionals) {
        const colClass = field.colWidth || 'col-12';
        const requiredAttr = field.required ? ' required' : '';
        const disabledAttr = field.prefilled ? ' disabled' : '';
        const prefilledData = field.prefilled ? ' data-prefilled="true"' : '';
        const requiredMark = field.required ? ' <span class="required-mark">*</span>' : '';
        const label = field.customLabel || field.label || field.fieldName;

        // Check if this field is a conditional trigger
        const trigger = field.conditionalTrigger;
        const triggerAttr = trigger ? ` data-conditional-trigger="${field.id}"` : '';

        let html = `                <div class="${colClass}"${triggerAttr}
                    data-json-path="${escAttr(field.jsonPath)}"
                    data-pdf-field="${escAttr(field.pdfField)}"
                    data-required="${field.required}"
                    data-field-id="${field.id}">\n`;

        html += `                    <label class="form-label">${escHtml(label)}${requiredMark}</label>\n`;

        switch (field.dataType) {
            case 'select':
                html += buildSelect(field, requiredAttr, disabledAttr, prefilledData);
                break;
            case 'radio':
                html += buildRadio(field, requiredAttr, trigger);
                break;
            case 'checkbox':
                html += buildCheckbox(field);
                break;
            case 'date':
                html += `                    <input type="text" class="form-control" placeholder="dd/mm/aaaa"${requiredAttr}${disabledAttr}${prefilledData}>\n`;
                break;
            default:
                html += buildTextInput(field, requiredAttr, disabledAttr, prefilledData);
                break;
        }

        // Validation hint
        if (field.rule) {
            html += `                    <div class="form-hint">${escHtml(field.rule)}</div>\n`;
        }

        html += `                </div>\n`;

        // Build conditional section if this is a trigger
        if (trigger) {
            html += buildConditionalSection(field, trigger);
        }

        return html;
    }

    function buildTextInput(field, requiredAttr, disabledAttr, prefilledData) {
        const placeholder = field.placeholder ? ` placeholder="${escAttr(field.placeholder)}"` : '';
        const maxLen = field.validation.maxLength ? ` maxlength="${field.validation.maxLength}"` : '';
        return `                    <input type="text" class="form-control"${placeholder}${maxLen}${requiredAttr}${disabledAttr}${prefilledData}>\n`;
    }

    function buildSelect(field, requiredAttr, disabledAttr, prefilledData) {
        let html = `                    <select class="form-select"${requiredAttr}${disabledAttr}${prefilledData}>\n`;
        html += `                        <option value="">Seleccionar...</option>\n`;
        for (const opt of field.options) {
            html += `                        <option value="${escAttr(opt)}">${escHtml(opt)}</option>\n`;
        }
        html += `                    </select>\n`;
        return html;
    }

    function buildRadio(field, requiredAttr, trigger) {
        const name = sanitizeId(field.id);
        let html = `                    <div class="form-check-group">\n`;

        for (const opt of field.options) {
            const optVal = opt.toLowerCase().trim();
            let toggleAttrs = '';

            if (trigger) {
                const show = optVal === 'si' || optVal === 'sí';
                toggleAttrs = ` data-toggle-target="cond_${field.id}" data-toggle-action="${show ? 'show' : 'hide'}"`;
            }

            html += `                        <label class="form-check-card">
                            <input type="radio" name="${name}" value="${escAttr(optVal)}"${toggleAttrs}${requiredAttr}>
                            <span class="form-check-card-label">${escHtml(opt)}</span>
                        </label>\n`;
        }

        html += `                    </div>\n`;
        return html;
    }

    function buildCheckbox(field) {
        return `                    <div class="form-check">
                        <input type="checkbox" class="form-check-input" id="chk_${field.id}">
                        <label class="form-check-label" for="chk_${field.id}">${escHtml(field.value || '')}</label>
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
            html += `                        <div class="col-12">
                            <label class="form-label">${escHtml(tf.label || tf.fieldName)}</label>
                            <input type="text" class="form-control"${placeholder}>
                        </div>\n`;
        }
        html += `                    </div>\n`;
        html += `                </div>\n`;
        return html;
    }

    function buildActionButtons() {
        return `    <div class="action-buttons">
        <button type="button" class="btn-back" id="btnBack">Anterior</button>
        <button type="button" class="btn-next" id="btnNext">Siguiente</button>
    </div>\n`;
    }

    function buildFooter() {
        return `    <footer class="app-footer">
        <p>&copy; Instituto Nacional de Seguros &mdash; Formulario Digital</p>
    </footer>\n`;
    }

    function buildScripts() {
        return `    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"><\/script>
    <script>${INS_JS}<\/script>\n`;
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
