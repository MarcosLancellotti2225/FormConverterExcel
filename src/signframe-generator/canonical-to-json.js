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
var config = require('./canonical-config');

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ─── Repeater helpers (shape per Signframe official repeater docs) ────────────

// Which entity repeater (dep/benef/...) does a grupo belong to? Longest match.
function entityOf(grupo) {
    var ers = config.entityRepeaters || {};
    var best = null;
    for (var k in ers) {
        if (ers.hasOwnProperty(k) && grupo.indexOf(k) === 0 && (!best || k.length > best.length)) best = k;
    }
    return best;
}

// Wrap a lookup needle in double quotes if it contains comma/paren/slash.
function quoteNeedle(n) {
    return /[,()/]/.test(n) ? '"' + n + '"' : n;
}

// Last segment of a jq-style path: "datosFormulario.personas[].nombre" -> "nombre".
function lastPathSegment(p) {
    if (!p) return '';
    var parts = String(p).replace(/\[[^\]]*\]/g, '').split('.');
    return parts[parts.length - 1] || '';
}

// Derive the PDF slot pattern from real sourceNames and validate it reproduces
// them exactly. members: [{sourceName, item}]. entity prefix + subSuffix + [idx].
// Returns { pdfSlotPattern, subfields:[{suffix, indices}], maxIdx, extra:[], ok }.
function derivePdfPattern(entity, subRows) {
    // subRows: [{ grupo, members:[sourceName...] }]
    var real = {};
    var maxIdx = -1;
    var subs = [];
    for (var s = 0; s < subRows.length; s++) {
        var grupo = subRows[s].grupo;
        var suffix = grupo.slice(entity.length); // e.g. "NombreCompleto"
        var indices = [];
        for (var m = 0; m < subRows[s].members.length; m++) {
            var sn = subRows[s].members[m];
            real[sn] = true;
            var mm = sn.match(/\[(\d+)\]$/);
            if (mm) { var idx = Number(mm[1]); indices.push(idx); if (idx > maxIdx) maxIdx = idx; }
        }
        subs.push({ suffix: suffix, jsonKey: subRows[s].jsonKey, indices: indices, type: subRows[s].type, label: subRows[s].label, required: subRows[s].required });
    }
    var pattern = entity + '{sub}[{i0}]';
    // Validate: every generated slot for present indices must exist; every real
    // member must be reproducible (no extras left over).
    var reproduced = {};
    for (var si = 0; si < subs.length; si++) {
        for (var ii = 0; ii < subs[si].indices.length; ii++) {
            var gen = entity + subs[si].suffix + '[' + subs[si].indices[ii] + ']';
            reproduced[gen] = true;
        }
    }
    var extra = [];
    for (var rn in real) if (real.hasOwnProperty(rn) && !reproduced[rn]) extra.push(rn);
    return { pdfSlotPattern: pattern, subfields: subs, maxIdx: maxIdx, extra: extra, ok: extra.length === 0 };
}

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

    // Pre-scan: agrupar filas repeater por entidad (dep/benef/...).
    var entityRows = {};   // entity -> [ {grupo, members, biz} ]
    var entityFirstCi = {}; // entity -> primer ci (para emitir en orden)
    for (var pci = 0; pci < campos.length; pci++) {
        if (String(campos[pci].tipoCampo || '').trim() !== 'repeater') continue;
        var pgrupo = String(campos[pci].grupo || '').trim();
        var ent = entityOf(pgrupo);
        if (!ent) continue;
        if (!entityRows[ent]) { entityRows[ent] = []; entityFirstCi[ent] = pci; }
        var pmembers = (opcionesByGrupo[pgrupo] || []).map(function (m) { return String(m.sourceName).trim(); }).filter(Boolean);
        var pbiz = bizFromCampo(campos[pci]);
        entityRows[ent].push({ grupo: pgrupo, members: pmembers, jsonKey: lastPathSegment(pbiz.path), type: 'text', label: pbiz.label || pgrupo, required: pbiz.required, businessPath: pbiz.path });
    }

    function buildEntityRepeater(entity, secName) {
        var cfg = (config.entityRepeaters || {})[entity] || {};
        var subRows = entityRows[entity];
        var derived = derivePdfPattern(entity, subRows);

        // marcar usados todos los sourceNames de todos los subcampos
        for (var sr = 0; sr < subRows.length; sr++) {
            for (var mm = 0; mm < subRows[sr].members.length; mm++) { usedNames[subRows[sr].members[mm]] = true; stats.paintsPdf++; }
        }

        var maxItems = cfg.maxItems || (derived.maxIdx + 1);
        var subfields = derived.subfields.map(function (s) {
            var sub = { id: s.suffix, type: s.type || 'text', label: s.label || s.suffix, required: !!s.required };
            return sub;
        });

        var field = {
            id: 'field_' + entity,
            type: 'repeater',
            label: cfg.itemLabelPlural || entity,
            itemLabel: cfg.itemLabel || entity,
            itemLabelPlural: cfg.itemLabelPlural || entity,
            addButtonLabel: cfg.addButtonLabel || ('Agregar ' + (cfg.itemLabel || entity)),
            minItems: 0,
            maxItems: maxItems,
            fields: subfields,
            pdfSlotPattern: derived.pdfSlotPattern,
            jsonSlotPattern: (cfg.jsonPath || ('datosFormulario.' + entity)) + '[{i0}].{sub}',
            sourceMeta: null,
            readOnly: false,
            hidden: false,
            width: 'full',
            excludeFromJson: false,
            conditionalVisibility: null,
            conditionalRequired: null,
            order: 0,
        };

        if (!derived.ok) {
            warnings.push({ stage: 'repeater', detail: 'Repeater "' + entity + '": el patrón "' + derived.pdfSlotPattern + '" NO reproduce ' + derived.extra.length + ' sourceName reales (' + derived.extra.slice(0, 5).join(', ') + '). El PDF no se rellenaría — revisar.' });
        } else {
            warnings.push({ stage: 'repeater', detail: 'Repeater "' + entity + '": patrón "' + derived.pdfSlotPattern + '" reproduce 1:1 los sourceName (' + subfields.length + ' subcampos, maxItems=' + maxItems + ').' });
        }
        stats.repeaterEntities = (stats.repeaterEntities || 0) + 1;
        fieldsWithSection.push({ field: field, sectionName: secName, subsectionName: secName });
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
            var entity = entityOf(grupo);
            if (entity) {
                // repeater de entidad (dep/benef): se emite UNA vez con subcampos
                if (ci === entityFirstCi[entity]) buildEntityRepeater(entity, secName);
                // (filas siguientes de la misma entidad ya quedaron incluidas)
            } else {
                // repeater standalone (array de 1 subcampo): patrón derivado del root
                var snames = members.map(function (m) { return String(m.sourceName).trim(); }).filter(Boolean);
                snames.forEach(function (sn) { usedNames[sn] = true; });
                var maxI = -1;
                snames.forEach(function (sn) { var mm = sn.match(/\[(\d+)\]$/); if (mm) maxI = Math.max(maxI, Number(mm[1])); });
                fieldsWithSection.push({
                    field: {
                        id: 'field_' + grupo, type: 'repeater', label: biz.label || grupo,
                        itemLabel: biz.label || grupo, itemLabelPlural: biz.label || grupo,
                        addButtonLabel: 'Agregar', minItems: 0, maxItems: maxI + 1,
                        fields: [{ id: 'value', type: 'text', label: biz.label || grupo, required: biz.required }],
                        pdfSlotPattern: grupo + '[{i0}]',
                        jsonSlotPattern: (biz.path || ('datosFormulario.' + grupo)) + '[{i0}]',
                        sourceMeta: null, readOnly: false, hidden: false, width: 'full',
                        excludeFromJson: false, conditionalVisibility: null, conditionalRequired: null, order: 0,
                    },
                    sectionName: secName, subsectionName: subName,
                });
                stats.paintsPdf += snames.length;
                warnings.push({ stage: 'repeater', detail: 'Repeater standalone "' + grupo + '": patrón "' + grupo + '[{i0}]" (maxItems=' + (maxI + 1) + ').' });
            }
        } else if (tipoCampo === 'repeaterLookup') {
            // repeater alimentado por catálogo + cada checkbox del PDF se rellena
            // por lookup con autoFillConcat (part repeaterLookup), heredando sourceMeta.
            var repeaterId = 'field_' + grupo;
            var catalogo = String(campo['catálogo'] || campo.catalogo || '').trim();
            // 1) repeater catálogo (selección del usuario)
            fieldsWithSection.push({
                field: {
                    id: repeaterId, type: 'repeater', label: biz.label || grupo,
                    itemLabel: 'Enfermedad', itemLabelPlural: biz.label || grupo,
                    addButtonLabel: 'Agregar', minItems: 0, maxItems: members.length || 0,
                    catalog: catalogo || null,
                    fields: [{ id: 'enfermedad', type: 'select', label: 'Enfermedad', required: false, catalog: catalogo || null }],
                    pdfSlotPattern: null, jsonSlotPattern: (biz.path || ('datosFormulario.' + grupo)),
                    sourceMeta: null, readOnly: false, hidden: false, width: 'full',
                    excludeFromJson: false, conditionalVisibility: null, conditionalRequired: null, order: 0,
                },
                sectionName: secName, subsectionName: subName,
            });
            // 2) checkboxes Si/No del PDF con lookup
            for (var li = 0; li < members.length; li++) {
                var snl = String(members[li].sourceName).trim();
                if (!snl) continue;
                var opc = String(members[li]['opción'] || members[li].opcion || '').trim();
                var needle = quoteNeedle(String(members[li].needle || '').trim());
                var f = emit(snl, biz, secName, { subName: subName, type: 'checkbox', labelOverride: String(members[li].needle || '').trim() || biz.label });
                f.autoFillConcat = {
                    parts: [{
                        type: 'repeaterLookup',
                        repeaterId: repeaterId,
                        needle: needle,
                        ifFound: opc === 'Si' ? 'X' : '',
                        ifNotFound: opc === 'Si' ? '' : 'X',
                    }],
                };
            }
            warnings.push({ stage: 'repeaterLookup', detail: 'repeaterLookup "' + grupo + '": ' + members.length + ' checkboxes con autoFillConcat→repeaterLookup (ifFound). Si Signframe no lo soporta nativo, quedan como checkboxes con sourceMeta para configurar el lookup a mano.' });
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
            repeaterEntities: stats.repeaterEntities || 0,
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
