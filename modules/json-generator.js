/**
 * JSON Schema Generator Module
 * Generates JSON Schema following the INS API structure from field definitions
 */
const JsonGenerator = (() => {
    'use strict';

    /**
     * Generate JSON Schema from fields
     */
    function generate(fields) {
        const schema = {
            encabezado: {
                codigoTipoTramite: { type: 'string', label: 'Tipo Trámite' },
                codigoTipoFormulario: { type: 'string', label: 'Tipo Formulario' },
                identificadorTransaccionInterno: { type: 'string' },
                correoElectronico: { type: 'string', format: 'email' }
            },
            datosFormulario: {}
        };

        // Build nested structure from jsonPath of each field
        for (const field of fields) {
            if (!field.jsonPath) continue;

            const path = field.jsonPath.trim();
            // Remove leading "datosFormulario." if present — we'll place it there
            let cleanPath = path;
            if (cleanPath.startsWith('datosFormulario.')) {
                cleanPath = cleanPath.substring('datosFormulario.'.length);
            }

            const parts = cleanPath.split('.').filter(Boolean);
            if (parts.length === 0) continue;

            // Navigate/create the nested structure
            let current = schema.datosFormulario;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current[part] || typeof current[part] !== 'object' || current[part].type) {
                    current[part] = {};
                }
                current = current[part];
            }

            // Set the leaf node
            const leafKey = parts[parts.length - 1];
            current[leafKey] = buildFieldSchema(field);
        }

        return schema;
    }

    /**
     * Build schema definition for a single field
     */
    function buildFieldSchema(field) {
        const schema = {};

        // Type mapping
        switch (field.dataType) {
            case 'number':
                schema.type = 'number';
                break;
            case 'date':
                schema.type = 'date';
                schema.format = 'dd/mm/aaaa';
                break;
            case 'select':
            case 'radio':
                schema.type = 'select';
                if (field.options && field.options.length > 0) {
                    schema.options = field.options.slice();
                }
                break;
            case 'checkbox':
                schema.type = 'boolean';
                break;
            default:
                schema.type = 'string';
        }

        // Label
        if (field.label || field.fieldName) {
            schema.label = field.customLabel || field.label || field.fieldName;
        }

        // Validation
        if (field.validation) {
            if (field.validation.maxLength) {
                schema.maxLength = field.validation.maxLength;
            }
            if (field.validation.format && field.validation.format !== 'date') {
                schema.format = field.validation.format;
            }
            if (field.validation.pattern) {
                schema.pattern = field.validation.pattern;
            }
        }

        // Required
        if (field.required) {
            schema.required = true;
        }

        // Prefilled
        if (field.prefilled) {
            schema.prefilled = true;
            schema.disabled = true;
        }

        return schema;
    }

    /**
     * Generate formatted JSON string
     */
    function generateString(fields) {
        const schema = generate(fields);
        return JSON.stringify(schema, null, 2);
    }

    return { generate, generateString };
})();
