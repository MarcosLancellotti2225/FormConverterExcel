'use strict';

const { TYPE_MAP, NATIVE_TYPE_MAP, NUMBER_FORMATS, PATH_CORRECTIONS, NEVER_CONDITION } = require('./constants');

function resolveType(row) {
    if (row.tipoDato) {
        var mapped = TYPE_MAP[row.tipoDato];
        if (mapped) return mapped;
    }
    if (row.nativeType) {
        var nt = row.nativeType.trim();
        if (NATIVE_TYPE_MAP[nt]) return NATIVE_TYPE_MAP[nt];
    }
    if (row.grupo) return 'radio';
    if (row.optionsParsed && row.optionsParsed.length) return 'select';
    return 'text';
}

function resolveSourceName(row) {
    if (row.sourceName) return row.sourceName;
    if (row.acroPropuesto) return row.acroPropuesto;
    return row.acroActual;
}

function buildFieldId(sName) {
    return 'field_' + sName;
}

function correctPath(path) {
    if (!path) return path;
    var corrected = path;
    for (var wrong in PATH_CORRECTIONS) {
        if (corrected.indexOf(wrong) !== -1) {
            corrected = corrected.replace(wrong, PATH_CORRECTIONS[wrong]);
        }
    }
    return corrected;
}

function buildOptions(row) {
    if (row.optionsParsed && Array.isArray(row.optionsParsed)) {
        return row.optionsParsed.map(function (opt) {
            if (typeof opt === 'string') return { value: opt, label: opt };
            return {
                value: opt.value || opt.jsonValue || opt.label || '',
                label: opt.label || opt.value || '',
                jsonValue: opt.jsonValue || opt.value || opt.label || '',
                pdfValue: opt.pdfValue || opt.label || opt.value || '',
            };
        });
    }
    return null;
}

function buildConditionalVisibility(raw) {
    if (!raw) return null;
    var trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        try {
            var parsed = JSON.parse(trimmed);
            ensureFieldPrefix(parsed);
            return JSON.stringify(parsed);
        } catch (e) { /* fall through */ }
    }

    var match = trimmed.match(/[Ss]i\s+(?:se\s+)?(?:selecciona|elige|marca)\s+"?([^"]+)"?\s+/i);
    if (match) {
        return JSON.stringify({
            logic: 'and',
            conditions: [{ fieldId: 'field_' + match[1].trim().replace(/\s+/g, '_').toLowerCase(), operator: 'not_empty' }],
        });
    }
    return null;
}

function ensureFieldPrefix(obj) {
    if (!obj) return;
    if (Array.isArray(obj.conditions)) {
        for (var i = 0; i < obj.conditions.length; i++) {
            var c = obj.conditions[i];
            if (c.fieldId && c.fieldId.indexOf('field_') !== 0) {
                c.fieldId = 'field_' + c.fieldId;
            }
        }
    }
}

function resolveNumberFormat(row) {
    if (!row.formato) return null;
    var f = row.formato.toLowerCase();
    if (f.indexOf('monto') !== -1 || f.indexOf('moneda') !== -1 || f.indexOf('currency') !== -1) return NUMBER_FORMATS.monto;
    if (f.indexOf('porcentaje') !== -1 || f.indexOf('%') !== -1) return NUMBER_FORMATS.porcentaje;
    if (f.indexOf('entero') !== -1 || f.indexOf('integer') !== -1) return NUMBER_FORMATS.entero;
    if (f === 'numérico' || f === 'numerico' || f === 'numero') return NUMBER_FORMATS.entero;
    return null;
}

function buildField(row, pdfField) {
    var sName = resolveSourceName(row);
    var id = buildFieldId(sName);
    var type = resolveType(row);
    var options = buildOptions(row);
    var condVis = buildConditionalVisibility(row.visibilidadCondicional);
    var numberFmt = resolveNumberFormat(row);
    var path = correctPath(row.pathPrincipal);

    var sourceMeta = null;
    if (pdfField) {
        sourceMeta = {
            sourceName: pdfField.name,
            page: pdfField.page,
            nativeType: pdfField.type || row.nativeType || 'Text',
            rect: { X: pdfField.x, Y: pdfField.y, Width: pdfField.width, Height: pdfField.height },
        };
    }

    var field = {
        id: id,
        type: type,
        label: row.etiqueta || sName,
        required: row.obligatorio === true,
        readOnly: false,
        hidden: false,
        width: 'full',
        sourceMeta: sourceMeta,
        prefillMode: row.preRellenado === true ? 'required' : (row.preRellenado === false ? 'none' : null),
        prefillKey: path || null,
        salidaJSON: path || null,
        jsonOutputPath: path || null,
        excludeFromJson: !path ? true : false,
        conditionalVisibility: condVis,
        conditionalRequired: null,
        autoFillConcat: null,
        order: row.rowNum || 1,
    };

    if (row.maxLength) field.maxLength = row.maxLength;
    if (row.patron) field.validationPattern = row.patron;
    if (options) field.options = options;
    if (numberFmt) field.jsonNumberFormat = numberFmt;

    if (type === 'checkbox') {
        field.checkedPdfValue = true;
        field.checkedJsonValue = true;
    }

    if (type === 'date') {
        field.width = 'half';
    }

    if (type === 'select' && options) {
        field.width = 'half';
    }

    if (row.pathsSecundarios) {
        field.mappedPaths = row.pathsSecundarios.split('|').map(function (p) { return p.trim(); }).filter(Boolean);
    }

    return field;
}

function buildRadioGroup(groupName, groupRows, pdfFieldsMap) {
    var fields = [];
    var groupFieldIds = [];
    for (var i = 0; i < groupRows.length; i++) {
        var sn = resolveSourceName(groupRows[i]);
        groupFieldIds.push(buildFieldId(sn));
    }

    for (var i = 0; i < groupRows.length; i++) {
        var row = groupRows[i];
        var sName = resolveSourceName(row);
        var pdfField = pdfFieldsMap[row.acroActual] || null;
        var field = buildField(row, pdfField);

        field.type = 'radio';
        field.radioGroupLabel = groupName;
        field.radioGroupFields = groupFieldIds.filter(function (fid) { return fid !== field.id; });
        field.order = i + 1;

        var optLabel = row.etiqueta || sName;
        field.jsonValue = optLabel;
        field.pdfValue = optLabel;

        if (row.optionsParsed && row.optionsParsed.length === 1) {
            field.jsonValue = row.optionsParsed[0].value || row.optionsParsed[0].jsonValue || optLabel;
            field.pdfValue = row.optionsParsed[0].pdfValue || row.optionsParsed[0].label || optLabel;
        }

        fields.push(field);
    }
    return fields;
}

function buildHiddenHelper(id, sourceFieldIds, separator, parts) {
    return {
        id: id,
        type: 'text',
        label: '',
        required: false,
        readOnly: false,
        hidden: true,
        width: 'full',
        sourceMeta: null,
        prefillMode: null,
        prefillKey: null,
        salidaJSON: null,
        jsonOutputPath: null,
        excludeFromJson: true,
        conditionalVisibility: null,
        conditionalRequired: null,
        autoFillConcat: {
            sourceFieldIds: sourceFieldIds,
            separator: separator || ' ',
            parts: parts || [],
        },
        order: 0,
    };
}

function buildSystemField(name, value, path) {
    return {
        id: buildFieldId(name),
        type: 'text',
        label: name,
        required: false,
        readOnly: true,
        hidden: true,
        width: 'full',
        sourceMeta: null,
        defaultValue: value || null,
        prefillMode: 'required',
        prefillKey: path || null,
        salidaJSON: path || null,
        jsonOutputPath: path || null,
        excludeFromJson: !path,
        conditionalVisibility: NEVER_CONDITION,
        conditionalRequired: null,
        autoFillConcat: null,
        order: 0,
    };
}

module.exports = {
    buildField,
    buildRadioGroup,
    buildHiddenHelper,
    buildSystemField,
    resolveSourceName,
    buildFieldId,
    resolveType,
    correctPath,
    buildOptions,
    buildConditionalVisibility,
};
