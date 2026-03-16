/**
 * Field Manager Module
 * Manages field state, CRUD operations, filtering, and normalization
 */
const FieldManager = (() => {
    'use strict';

    let _fields = [];
    let _catalogs = {};
    let _selectedFieldId = null;
    let _onChangeCallbacks = [];

    // Data type normalization map
    const TYPE_MAP = {
        'texto': 'text',
        'alfanumérico': 'text',
        'alfanumerico': 'text',
        'numérico': 'number',
        'numerico': 'number',
        'fecha': 'date',
        'combo': 'select',
        'combo/radio': 'radio',
        'radio': 'radio',
        'check box': 'checkbox',
        'checkbox': 'checkbox',
        'botones': 'buttons',
        'botón': 'buttons',
        'boton': 'buttons',
        '': 'text'
    };

    // Type badge config
    const TYPE_BADGES = {
        'text':     { label: 'TXT',  color: '#6366f1' },
        'number':   { label: 'NUM',  color: '#ef4444' },
        'date':     { label: 'DATE', color: '#22c55e' },
        'select':   { label: 'SEL',  color: '#14b8a6' },
        'radio':    { label: 'OPT',  color: '#f59e0b' },
        'checkbox': { label: 'CHK',  color: '#a855f7' },
        'buttons':  { label: 'BTN',  color: '#ec4899' },
        'json-internal': { label: 'JSON', color: '#64748b' }
    };

    /**
     * Initialize with parsed spec data
     */
    function init(specData, catalogData) {
        _catalogs = catalogData || {};
        _fields = normalizeFields(specData.fields);
        _selectedFieldId = null;
        _notifyChange();
    }

    /**
     * Normalize raw parsed fields into structured field objects
     */
    function normalizeFields(rawFields) {
        let idCounter = 0;
        return rawFields.map(raw => {
            const id = `field_${++idCounter}`;
            const normalizedType = normalizeType(raw.dataType);
            const isJsonInternal = raw.step && raw.step.toUpperCase() === 'JSON';
            const isRequired = raw.required && raw.required.toLowerCase().startsWith('si');

            // Determine if field is prefilled (disabled)
            const sectionLower = (raw.section || '').toLowerCase();
            const isPrefilled = sectionLower.includes('póliza madre') ||
                sectionLower.includes('poliza madre') ||
                sectionLower.includes('asesor') ||
                sectionLower.includes('intermediario');

            // Auto-detect if radio (<=4 options or Si/No)
            let finalType = isJsonInternal ? 'json-internal' : normalizedType;
            if (finalType === 'select' && raw.options && raw.options.length <= 4) {
                finalType = 'radio';
            }
            if (finalType === 'select' && raw.options) {
                const optLower = raw.options.map(o => o.toLowerCase());
                if (optLower.length === 2 && optLower.includes('si') && optLower.includes('no')) {
                    finalType = 'radio';
                }
            }

            // Parse validation rules
            const validation = parseValidation(raw.rule, raw.value);

            // Parse variant
            const variants = parseVariant(raw.variant);

            return {
                id,
                step: raw.step || '',
                section: raw.section || '',
                fieldName: raw.fieldName || '',
                label: raw.fieldName || '',
                customLabel: '',
                dataType: finalType,
                originalDataType: raw.dataType,
                value: raw.value || '',
                options: raw.options || [],
                rule: raw.rule || '',
                required: isRequired,
                variant: raw.variant || '',
                variants,
                obs: raw.obs || '',
                jsonPath: raw.jsonPath || '',
                pdfField: raw.pdfField || '',
                notes: raw.notes || '',
                visible: !isJsonInternal,
                prefilled: isPrefilled,
                validation,
                placeholder: generatePlaceholder(raw, normalizedType),
                colWidth: 'col-12',
                conditionalTrigger: null,
                conditionalTarget: null,
                _rowIndex: raw._rowIndex
            };
        });
    }

    function normalizeType(rawType) {
        if (!rawType) return 'text';
        const lower = rawType.toLowerCase().trim();
        return TYPE_MAP[lower] || 'text';
    }

    function parseValidation(rule, value) {
        const v = {};
        if (!rule && !value) return v;

        const combined = `${rule} ${value}`.toLowerCase();

        // Extract max length
        const lenMatch = combined.match(/(\d+)\s*(?:car[aá]cteres|caracteres|chars|dígitos|digitos)/);
        if (lenMatch) v.maxLength = parseInt(lenMatch[1]);

        // Extract digit count
        const digitMatch = combined.match(/(\d+)\s*d[ií]gitos/);
        if (digitMatch) v.maxLength = parseInt(digitMatch[1]);

        // Detect numeric-only
        if (combined.includes('numérico') || combined.includes('numerico') || combined.includes('solo números')) {
            v.pattern = '[0-9]*';
        }

        // Detect email
        if (combined.includes('email') || combined.includes('correo')) {
            v.format = 'email';
        }

        // Date format
        if (combined.includes('dd/mm/aaaa') || combined.includes('dd/mm/yyyy')) {
            v.format = 'date';
            v.placeholder = 'dd/mm/aaaa';
        }

        return v;
    }

    function parseVariant(variantStr) {
        if (!variantStr) return ['completo', 'abreviado', 'enrolamiento'];
        const lower = variantStr.toLowerCase();
        const result = [];
        if (lower.includes('completo')) result.push('completo');
        if (lower.includes('abreviado')) result.push('abreviado');
        if (lower.includes('enrolamiento')) result.push('enrolamiento');
        if (lower.includes('solo json')) result.push('json-only');
        if (result.length === 0) result.push('completo', 'abreviado', 'enrolamiento');
        return result;
    }

    function generatePlaceholder(raw, type) {
        if (type === 'date') return 'dd/mm/aaaa';
        if (raw.rule) {
            const lenMatch = raw.rule.match(/(\d+)\s*(?:car|dígitos|digitos)/i);
            if (lenMatch) return `Máx. ${lenMatch[1]} caracteres`;
        }
        return '';
    }

    // === CRUD Operations ===

    function getFields() {
        return _fields;
    }

    function getFieldById(id) {
        return _fields.find(f => f.id === id);
    }

    function updateField(id, updates) {
        const field = getFieldById(id);
        if (!field) return;
        Object.assign(field, updates);
        _notifyChange();
    }

    function getSelectedField() {
        return _selectedFieldId ? getFieldById(_selectedFieldId) : null;
    }

    function selectField(id) {
        _selectedFieldId = id;
        _notifyChange();
    }

    // === Filtering ===

    function getFilteredFields(variant, searchText) {
        let filtered = _fields.filter(f => f.visible);

        if (variant && variant !== 'all') {
            filtered = filtered.filter(f => f.variants.includes(variant));
        }

        if (searchText) {
            const lower = searchText.toLowerCase();
            filtered = filtered.filter(f =>
                f.fieldName.toLowerCase().includes(lower) ||
                f.jsonPath.toLowerCase().includes(lower) ||
                f.label.toLowerCase().includes(lower)
            );
        }

        return filtered;
    }

    // === Structured Data ===

    /**
     * Get fields organized by step > section
     */
    function getFieldTree(variant, searchText) {
        const filtered = getFilteredFields(variant, searchText);
        const tree = [];
        let currentStep = null;
        let currentSection = null;

        for (const field of filtered) {
            const stepName = field.step || 'Sin paso';
            const sectionName = field.section || 'General';

            if (!currentStep || currentStep.name !== stepName) {
                currentStep = { name: stepName, sections: [], fieldCount: 0 };
                tree.push(currentStep);
                currentSection = null;
            }

            if (!currentSection || currentSection.name !== sectionName) {
                currentSection = { name: sectionName, fields: [] };
                currentStep.sections.push(currentSection);
            }

            currentSection.fields.push(field);
            currentStep.fieldCount++;
        }

        return tree;
    }

    /**
     * Get stats for the current field set
     */
    function getStats(variant) {
        const fields = variant && variant !== 'all'
            ? _fields.filter(f => f.visible && f.variants.includes(variant))
            : _fields.filter(f => f.visible);

        const steps = new Set(fields.map(f => f.step).filter(Boolean));
        const requiredCount = fields.filter(f => f.required).length;
        const jsonCount = fields.filter(f => f.jsonPath).length;

        return {
            steps: steps.size,
            fields: fields.length,
            required: requiredCount,
            json: jsonCount
        };
    }

    /**
     * Detect conditional logic patterns (Si/No fields followed by detail fields)
     *
     * Strategy:
     * 1. Find all Si/No radio fields (triggers)
     * 2. Look at subsequent fields in the same section
     * 3. Use multiple signals: obs text, field name patterns, proximity
     * 4. Fields like "Clase/Tipo", "Cantidad", "Frecuencia", "Detalle" after
     *    a Si/No are almost certainly conditional
     */
    function detectConditionals() {
        const conditionals = [];

        // Detail field name patterns (typically follow a Si/No question)
        const detailPatterns = [
            'clase', 'tipo', 'cantidad', 'frecuencia', 'detalle',
            'especifique', 'describa', 'cuál', 'cual', 'nombre del',
            'tiempo', 'duración', 'duracion', 'motivo', 'fecha de',
            'resultado', 'tratamiento', 'medicamento', 'dosis',
            'hospital', 'clínica', 'clinica', 'médico', 'medico'
        ];

        for (let i = 0; i < _fields.length; i++) {
            const field = _fields[i];
            if (field.dataType !== 'radio' || !field.options) continue;

            const optLower = field.options.map(o => o.toLowerCase().trim());
            const isSiNo = optLower.includes('si') && optLower.includes('no');
            if (!isSiNo) continue;

            // Look ahead for dependent fields
            const dependents = [];
            for (let j = i + 1; j < _fields.length; j++) {
                const next = _fields[j];

                // Stop at step boundary
                if (next.step !== field.step) break;

                // Stop if we hit another Si/No question (new trigger)
                if (next.dataType === 'radio' && next.options) {
                    const nextOptLower = next.options.map(o => o.toLowerCase().trim());
                    if (nextOptLower.includes('si') && nextOptLower.includes('no')) break;
                }

                // Stop if we moved to a different section (unless still close)
                if (next.section !== field.section && j - i > 3) break;

                const nextObs = (next.obs || '').toLowerCase();
                const nextNotes = (next.notes || '').toLowerCase();
                const nextName = (next.fieldName || '').toLowerCase();

                // Signal 1: Explicit conditional mention in obs/notes
                const obsHint = nextObs.includes('en caso de si') ||
                    nextObs.includes('si responde si') ||
                    nextObs.includes('si la respuesta es si') ||
                    nextObs.includes('solo si') ||
                    nextObs.includes('si selecciona si') ||
                    nextObs.includes('cuando si') ||
                    nextObs.includes('aplica si') ||
                    nextNotes.includes('condicional') ||
                    nextNotes.includes('depende de');

                // Signal 2: Field name matches detail patterns
                const nameIsDetail = detailPatterns.some(p => nextName.includes(p));

                // Signal 3: Proximity (non-radio/non-select field right after a Si/No)
                const isCloseFollower = j - i <= 4 &&
                    next.section === field.section &&
                    next.dataType !== 'radio' &&
                    !next.options;

                // Determine if dependent
                const isDependent = obsHint ||
                    (isCloseFollower && nameIsDetail) ||
                    (isCloseFollower && dependents.length > 0 && dependents.length < 6);

                if (isDependent) {
                    dependents.push(next.id);
                    next.conditionalTarget = field.id;
                }
            }

            if (dependents.length > 0) {
                field.conditionalTrigger = {
                    targetIds: dependents,
                    showWhen: 'si'
                };
                conditionals.push({
                    triggerId: field.id,
                    triggerName: field.fieldName,
                    targetIds: dependents
                });
            }
        }

        return conditionals;
    }

    function getCatalogs() {
        return _catalogs;
    }

    // === Event system ===

    function onChange(callback) {
        _onChangeCallbacks.push(callback);
    }

    function _notifyChange() {
        for (const cb of _onChangeCallbacks) {
            try { cb(); } catch (e) { console.error('FieldManager onChange error:', e); }
        }
    }

    return {
        init,
        getFields,
        getFieldById,
        updateField,
        selectField,
        getSelectedField,
        getFilteredFields,
        getFieldTree,
        getStats,
        detectConditionals,
        getCatalogs,
        onChange,
        TYPE_BADGES
    };
})();
