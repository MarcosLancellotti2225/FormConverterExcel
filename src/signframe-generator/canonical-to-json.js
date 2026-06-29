'use strict';

/**
 * Generador de JSON Signframe desde la Matriz Canónica de 2 hojas.
 *
 * Lee la hoja "Campos" (1 fila por campo lógico, con negocio) y la hoja
 * "Opciones" (detalle de radios/repeaters/repeaterLookup) y expande cada fila
 * según tipoCampo a campos Signframe, heredando sourceMeta SIEMPRE que el
 * sourceName exista en el JSON. Solo van a "Sistema oculto" los que de verdad
 * no tienen sourceName.
 *
 * REGLA DE ORO: nunca se modifican id ni sourceMeta de los campos existentes.
 */

var XLSX = require('xlsx');
var combiner = require('./combiner');
var validator = require('./validator');

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function sourceNameOf(field) {
    var sm = field.sourceMeta;
    if (sm && sm.sourceName) return sm.sourceName;
    var fid = field.id || '';
    return fid.indexOf('field_') === 0 ? fid.substring(6) : fid;
}

// ─── Read the 2-sheet workbook ────────────────────────────────────────────────

function sheetToObjects(ws) {
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) return [];
    var headers = raw[0].map(function (h) { return String(h || '').trim(); });
    var out = [];
    for (var i = 1; i < raw.length; i++) {
        var r = raw[i];
        var obj = {};
        var any = false;
        for (var c = 0; c < headers.length; c++) {
            if (!headers[c]) continue;
            var v = r[c];
            obj[headers[c]] = v;
            if (v !== '' && v != null) any = true;
        }
        if (any) out.push(obj);
    }
    return out;
}

function isCanonicalWorkbook(matrixBytes) {
    try {
        var wb = XLSX.read(matrixBytes, { type: 'array' });
        return wb.SheetNames.indexOf('Campos') !== -1 && wb.SheetNames.indexOf('Opciones') !== -1;
    } catch (e) { return false; }
}

function readCanonical(matrixBytes) {
    var wb = XLSX.read(matrixBytes, { type: 'array' });
    var campos = sheetToObjects(wb.Sheets['Campos']);
    var opciones = wb.Sheets['Opciones'] ? sheetToObjects(wb.Sheets['Opciones']) : [];
    var opcionesByGrupo = {};
    for (var i = 0; i < opciones.length; i++) {
        var g = String(opciones[i].grupo || '').trim();
        if (!g) continue;
        (opcionesByGrupo[g] = opcionesByGrupo[g] || []).push(opciones[i]);
    }
    return { campos: campos, opcionesByGrupo: opcionesByGrupo };
}

// ─── Business application ─────────────────────────────────────────────────────

function applyBusiness(field, biz, opts) {
    opts = opts || {};
    if (biz.label) field.label = biz.label;
    else if (field.label == null) field.label = sourceNameOf(field);

    field.required = biz.required === true;

    // type: business override or keep
    if (opts.type) field.type = opts.type;

    // readOnly false always (per rules)
    field.readOnly = false;
    if (field.hidden === undefined) field.hidden = false;
    if (field.width === undefined) field.width = 'full';

    // paths
    if (biz.path) {
        field.salidaJSON = biz.path;
        field.jsonOutputPath = biz.path;
        field.prefillKey = biz.path;
        field.excludeFromJson = false;
    } else if (!field.salidaJSON) {
        field.excludeFromJson = true;
    }

    // conditional visibility (string JSON, fieldId with field_)
    if (biz.visibility) {
        var cv = combiner.buildConditionalVisibilityWithLabels(biz.visibility, {});
        if (cv) field.conditionalVisibility = cv;
        else if (field.conditionalVisibility === undefined) field.conditionalVisibility = null;
    } else if (field.conditionalVisibility === undefined) {
        field.conditionalVisibility = null;
    }
    if (field.conditionalRequired === undefined) field.conditionalRequired = null;

    return field;
}

function bizFromCampo(campo) {
    return {
        label: String(campo['Nombre en formulario'] || '').trim(),
        path: String(campo['salidaJSON'] || '').trim(),
        required: norm(campo['Obligatorio']) === 'si' || norm(campo['Obligatorio']) === 'sí',
        visibility: String(campo['Visibilidad condicional'] || '').trim(),
        seccionJson: String(campo['Sección JSON'] || '').trim(),
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function generateFromCanonical(opts) {
    var signframeJson = opts.signframeJson;
    var matrixBytes = opts.matrixBytes;
    var targetJsonText = opts.targetJsonText || null;
    var warnings = [];

    var data = readCanonical(matrixBytes);
    var campos = data.campos;
    var opcionesByGrupo = data.opcionesByGrupo;

    var sfFields = combiner.collectSignframeFields(signframeJson);
    var sfByName = {};
    for (var i = 0; i < sfFields.length; i++) sfByName[sourceNameOf(sfFields[i])] = sfFields[i];

    var idForSource = function (sn) {
        var f = sfByName[sn];
        return f ? f.id : ('field_' + sn);
    };

    var fieldsWithSection = [];
    var usedNames = {};
    var stats = { paintsPdf: 0, createdNew: 0, byType: {}, sectionCounts: {} };
    var pdfNameSeen = {};
    var duplicates = [];

    function emit(sn, biz, secName, extra) {
        extra = extra || {};
        var field;
        if (sfByName[sn]) {
            field = clone(sfByName[sn]); // keeps id + sourceMeta intact
            usedNames[sn] = true;
            stats.paintsPdf++;
            if (field.sourceMeta && field.sourceMeta.sourceName) {
                var key = field.sourceMeta.sourceName;
                if (pdfNameSeen[key]) duplicates.push(key);
                pdfNameSeen[key] = true;
            }
        } else {
            // no existe en el JSON -> campo nuevo sin sourceMeta
            field = { id: 'field_' + sn, type: extra.type || 'text', sourceMeta: null };
            stats.createdNew++;
            warnings.push({ stage: 'canonical', detail: 'sourceName "' + sn + '" no existe en el JSON — campo nuevo sin sourceMeta.' });
        }
        applyBusiness(field, biz, extra);

        // checkbox que pinta -> checkedPdfValue true
        if (field.type === 'checkbox' && field.sourceMeta) {
            field.checkedPdfValue = true;
            field.checkedJsonValue = true;
        }
        // radio props
        if (extra.radio) {
            field.type = 'radio';
            field.radioGroupLabel = extra.radio.groupLabel;
            field.radioGroupFields = extra.radio.otherIds;
            if (extra.radio.jsonValue !== undefined) field.jsonValue = extra.radio.jsonValue;
            if (extra.radio.pdfValue !== undefined) field.pdfValue = extra.radio.pdfValue;
        }
        if (extra.labelOverride) field.label = extra.labelOverride;

        fieldsWithSection.push({ field: field, sectionName: secName, subsectionName: extra.subName || secName });
        return field;
    }

    for (var ci = 0; ci < campos.length; ci++) {
        var campo = campos[ci];
        var tipoCampo = String(campo.tipoCampo || 'simple').trim();
        var grupo = String(campo.grupo || '').trim();
        var secName = String(campo['Sección'] || 'Sin Sección').trim() || 'Sin Sección';
        var biz = bizFromCampo(campo);
        var subName = biz.seccionJson || secName;
        var members = opcionesByGrupo[grupo] || [];

        stats.byType[tipoCampo] = (stats.byType[tipoCampo] || 0) + 1;
        stats.sectionCounts[secName] = (stats.sectionCounts[secName] || 0) + 1;

        if (tipoCampo === 'radio') {
            var ids = members.map(function (m) { return idForSource(String(m.sourceName).trim()); });
            for (var r = 0; r < members.length; r++) {
                var sn = String(members[r].sourceName).trim();
                if (!sn) continue;
                var selfId = idForSource(sn);
                emit(sn, biz, secName, {
                    subName: subName,
                    radio: {
                        groupLabel: biz.label || grupo,
                        otherIds: ids.filter(function (id) { return id !== selfId; }),
                        jsonValue: members[r].jsonValue !== '' ? members[r].jsonValue : (members[r]['opción'] || ''),
                        pdfValue: members[r].pdfValue !== '' ? members[r].pdfValue : (members[r]['opción'] || ''),
                    },
                });
            }
        } else if (tipoCampo === 'repeater') {
            // v1: items individuales heredando sourceMeta (no se pierden). Modelado
            // repeater+agregadores queda pendiente de schema destino.
            warnings.push({ stage: 'repeater', detail: 'Repeater "' + grupo + '" (' + members.length + ' items): items emitidos sueltos; falta modelado repeaterConfig/aggregate (schema).' });
            for (var ri = 0; ri < members.length; ri++) {
                var snr = String(members[ri].sourceName).trim();
                if (!snr) continue;
                var item = members[ri].item;
                emit(snr, biz, secName, { subName: subName, labelOverride: biz.label ? (biz.label + ' (' + (Number(item) + 1) + ')') : undefined });
            }
        } else if (tipoCampo === 'repeaterLookup') {
            warnings.push({ stage: 'repeaterLookup', detail: 'repeaterLookup "' + grupo + '" (' + members.length + ' opciones): checkboxes emitidos heredando sourceMeta; falta modelado repeaterLookup ifFound (schema).' });
            for (var li = 0; li < members.length; li++) {
                var snl = String(members[li].sourceName).trim();
                if (!snl) continue;
                emit(snl, biz, secName, { subName: subName, type: 'checkbox' });
            }
        } else {
            // simple
            var snList = String(campo.sourceNames || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
            var sn0 = snList[0] || grupo;
            emit(sn0, biz, secName, { subName: subName });
        }
    }

    // signframe fields never used -> Sistema oculto (preservados)
    var unmatchedSf = [];
    for (var k = 0; k < sfFields.length; k++) {
        var skn = sourceNameOf(sfFields[k]);
        if (!usedNames[skn]) unmatchedSf.push(clone(sfFields[k]));
    }

    var sections = combiner.organizeSectionsTwoLevel(fieldsWithSection, unmatchedSf);
    combiner.validateOutput(sections, warnings);

    var output = {};
    for (var topKey in signframeJson) {
        if (signframeJson.hasOwnProperty(topKey) && topKey !== 'sections') output[topKey] = signframeJson[topKey];
    }
    output.sections = sections;

    var targetJson = null;
    if (targetJsonText) {
        try { targetJson = JSON.parse(targetJsonText); }
        catch (e) { warnings.push({ stage: 'target-json', detail: 'No se pudo parsear JSON destino: ' + e.message }); }
    }
    var pdfFieldsForValidation = [];
    for (var vi = 0; vi < sfFields.length; vi++) {
        var sm = sfFields[vi].sourceMeta;
        if (sm && sm.sourceName) pdfFieldsForValidation.push({ name: sm.sourceName });
    }
    var validation = validator.validate(output, pdfFieldsForValidation, targetJson);

    if (duplicates.length) {
        warnings.push({ stage: 'duplicate', detail: 'sourceNames del PDF asignados a más de un campo: ' + duplicates.join(', ') });
    }

    var totalFields = 0;
    for (var si = 0; si < sections.length; si++) {
        var subs = sections[si].subsections || [];
        for (var ssi = 0; ssi < subs.length; ssi++) totalFields += (subs[ssi].fields || []).length;
    }

    return {
        json: output,
        validation: validation,
        warnings: warnings,
        stats: {
            matrixRows: campos.length,
            signframeFields: sfFields.length,
            totalFields: totalFields,
            sections: sections.length,
            radioGroups: stats.byType.radio || 0,
            repeaters: stats.byType.repeater || 0,
            repeaterLookups: stats.byType.repeaterLookup || 0,
            paintsPdf: stats.paintsPdf,
            createdNew: stats.createdNew,
            unmatchedSignframe: unmatchedSf.length,
            duplicates: duplicates.length,
            unmatchedMatrix: 0,
            byType: stats.byType,
            sectionCounts: stats.sectionCounts,
        },
    };
}

module.exports = { generateFromCanonical, isCanonicalWorkbook, readCanonical };
