/**
 * @file json-enricher.js
 * @version 1.1.3
 * @description Generates Lovable v8 JSON from the 22-column mapping Excel rows.
 * @changelog
 *   - v1.1.1: Basic Lovable v8 shape — sections, fields, options from Excel
 *   - v1.1.2: Beneficiary cascade + hidden Encabezado section
 *   - v1.1.3: prefillMode rules + radio groups + helpText + date selects
 */
'use strict';

const { resolveCatalog } = require('./catalogos');
const { getDateOptions } = require('./precharged-lists');
const { buildEncabezadoSection, NEVER_VISIBLE } = require('./encabezado-section');
const { determinePrefillMode } = require('./prefill-mode-rules');
const { getHelpText } = require('./help-texts');

function buildEnrichedJson(excelRows) {
    const warnings = [];

    const sectionGroups = groupBySection(excelRows);
    const sections = [];
    let sectionOrder = 2;

    const encabezado = buildEncabezadoSection();
    sections.push(encabezado);

    const allFields = [];

    for (const [sectionTitle, rows] of sectionGroups) {
        const sectionId = buildSectionId(sectionTitle);
        const conditionalVis = buildSectionConditionalVisibility(sectionTitle);

        const fields = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const field = buildField(row, i + 1, warnings);
            fields.push(field);
            allFields.push({ field, row });
        }

        sections.push({
            id: sectionId,
            title: sectionTitle || 'Sin Sección',
            description: null,
            instructions: null,
            conditionalVisibility: conditionalVis,
            order: sectionOrder++,
            fields,
        });
    }

    wireRadioGroups(allFields);

    const json = {
        sections,
        validationRules: [],
        prefillMappings: [],
        version: 1,
    };

    const stats = computeStats(sections);

    return { json, warnings, stats };
}

function groupBySection(rows) {
    const map = new Map();
    for (const row of rows) {
        const section = row.seccionPdf || 'Sin Sección';
        if (!map.has(section)) map.set(section, []);
        map.get(section).push(row);
    }
    return map;
}

function buildSectionId(title) {
    if (!title) return 'section_sin_seccion';
    const slug = title.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return 'section_' + (slug || 'sin_seccion');
}

function buildSectionConditionalVisibility(title) {
    if (!title) return null;
    const normalized = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    const m = normalized.match(/beneficiario\s*(\d+)/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 2) {
            const prevField = 'field_beneficiario_' + (n - 1) + '_nombre';
            return JSON.stringify({
                logic: 'and',
                conditions: [{ fieldId: prevField, operator: 'not_empty' }],
            });
        }
    }

    return null;
}

function buildField(row, order, warnings) {
    const sourceName = row.sourceName || row.acroFormPropuesto || '';
    const fieldType = resolveFieldType(row);
    const options = resolveOptions(row, fieldType, sourceName, warnings);
    const prefillMode = determinePrefillMode(sourceName, row.pathPrincipal, row.grupo);
    const helpText = getHelpText(sourceName);
    const defaultValue = resolveDefaultValue(sourceName);
    const readOnly = resolveReadOnly(sourceName);
    const conditionalVis = resolveFieldConditionalVisibility(row);

    const field = {
        id: 'field_' + sourceName,
        type: fieldType,
        label: row.etiqueta || sourceName,
        required: row.obligatorio === true,
        readOnly,
        defaultValue,
        order,
        options: options || [],
        sourceMeta: {
            sourceName,
            page: row.pagina || null,
            nativeType: row.tipo === 'Tx' ? 'Text' : (row.tipo === 'Btn' ? 'Button' : row.tipo),
            rect: { X: 0, Y: 0, Width: 0, Height: 0 },
        },
        prefillKey: row.pathPrincipal || null,
        prefillMode,
        salidaJSON: row.pathPrincipal || null,
        jsonOutputPath: row.pathPrincipal || null,
        conditionalVisibility: conditionalVis,
        helpText,
        placeholder: null,
    };

    if (row.maxLength && fieldType !== 'select' && fieldType !== 'radio' && fieldType !== 'checkbox') {
        field.maxLength = row.maxLength;
    }

    if (row.patron && sourceName !== 'solicitud_lugar') {
        field.validationPattern = row.patron;
    }

    if (row.pathsSecundarios) {
        field.pathsSecundarios = row.pathsSecundarios;
    }

    return field;
}

function resolveFieldType(row) {
    const formato = String(row.formato || '').toLowerCase();
    if (formato === 'fecha') return 'date';
    if (formato === 'numérico' || formato === 'numerico') return 'number';

    const sn = String(row.sourceName || '').toLowerCase();
    if (sn.endsWith('_dia') || sn.endsWith('_mes') || sn.endsWith('_ano')) return 'select';

    const tipo = String(row.tipo || '').trim();
    const grupo = String(row.grupo || '').trim();

    if (tipo === 'Btn' && grupo) return 'radio';
    if (tipo === 'Btn') return 'checkbox';

    if (row.catalogoNombre || (row.opcionesLovable && row.opcionesLovable.length > 0)) {
        return 'select';
    }

    return 'text';
}

function resolveOptions(row, fieldType, sourceName, warnings) {
    const dateOpts = getDateOptions(sourceName);
    if (dateOpts) {
        return dateOpts.map(o => ({ value: o.value, label: o.label }));
    }

    if (row.opcionesLovable && Array.isArray(row.opcionesLovable) && row.opcionesLovable.length > 0) {
        return row.opcionesLovable;
    }

    if (row.catalogoNombre) {
        const catalog = resolveCatalog(row.catalogoNombre, row.grupo);
        if (catalog) return catalog;

        if (fieldType === 'select') {
            warnings.push({
                type: 'catalog_not_found',
                field: sourceName,
                catalog: row.catalogoNombre,
                reason: `Catálogo "${row.catalogoNombre}" no encontrado — field queda como text`,
            });
        }
    }

    return null;
}

function resolveDefaultValue(sourceName) {
    if (!sourceName) return null;
    const m = sourceName.match(/^beneficiario_(\d+)_numero$/);
    if (m) return parseInt(m[1], 10);
    return null;
}

function resolveReadOnly(sourceName) {
    if (!sourceName) return false;
    return /^beneficiario_\d+_numero$/.test(sourceName);
}

function resolveFieldConditionalVisibility(row) {
    if (!row.visibilidadCondicional) return null;
    return row.visibilidadCondicional;
}

function wireRadioGroups(allFields) {
    const groups = new Map();
    for (const { field, row } of allFields) {
        if (field.type !== 'radio' || !row.grupo) continue;
        const key = row.seccionPdf + '::' + row.grupo;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(field);
    }

    for (const [, members] of groups) {
        if (members.length < 2) continue;
        for (const field of members) {
            field.radioGroupFields = members
                .filter(m => m.id !== field.id)
                .map(m => m.id);
        }
    }
}

function computeStats(sections) {
    let totalFields = 0;
    let withRequired = 0;
    let withOptions = 0;
    let withPrefill = 0;
    let withConditional = 0;
    let withHelpText = 0;
    let mandatory = 0;
    let optional = 0;
    let hidden = 0;
    const types = {};

    for (const section of sections) {
        for (const field of section.fields) {
            totalFields++;
            if (field.required) withRequired++;
            if (field.options && field.options.length > 0) withOptions++;
            if (field.prefillKey) withPrefill++;
            if (field.conditionalVisibility) withConditional++;
            if (field.helpText) withHelpText++;
            if (field.prefillMode === 'mandatory') mandatory++;
            if (field.prefillMode === 'optional') optional++;
            if (field.readOnly && section.conditionalVisibility === NEVER_VISIBLE) hidden++;
            types[field.type] = (types[field.type] || 0) + 1;
        }
    }

    return {
        totalSections: sections.length,
        totalFields,
        withRequired,
        withOptions,
        withPrefill,
        withConditional,
        withHelpText,
        mandatory,
        optional,
        hidden,
        types,
    };
}

module.exports = {
    buildEnrichedJson,
    _internal: {
        groupBySection, buildSectionId, buildSectionConditionalVisibility,
        buildField, resolveFieldType, resolveOptions, resolveDefaultValue,
        wireRadioGroups, computeStats,
    },
};
