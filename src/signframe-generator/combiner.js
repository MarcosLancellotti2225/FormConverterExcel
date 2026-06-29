'use strict';

var matrixParser = require('./matrix-parser');
var fieldBuilder = require('./field-builder');
var validator = require('./validator');
var constants = require('./constants');

var NEVER_CONDITION = constants.NEVER_CONDITION;
var NUMBER_FORMATS = constants.NUMBER_FORMATS;

/**
 * Combines an existing signframe.json skeleton with matrix XLSX data
 * to produce an enriched form definition.
 *
 * @param {Object} opts
 * @param {Object} opts.signframeJson  - parsed signframe JSON object (skeleton)
 * @param {Buffer|Uint8Array} opts.matrixBytes - raw bytes of the matrix XLSX
 * @param {string} [opts.targetJsonText] - optional target JSON text for validation
 * @returns {Promise<{json, validation, warnings, stats}>}
 */
async function combineWithSignframe(opts) {
    var signframeJson = opts.signframeJson;
    var matrixBytes = opts.matrixBytes;
    var targetJsonText = opts.targetJsonText || null;
    var warnings = [];

    // 1. Parse matrix
    var matrix = matrixParser.parseMatrix(matrixBytes);
    var matrixRows = matrix.rows;
    if (matrix.warnings.length) {
        for (var w = 0; w < matrix.warnings.length; w++) {
            warnings.push({ stage: 'matrix', detail: matrix.warnings[w] });
        }
    }

    // 2. signframeJson is already an object

    // 3. Extract all fields from signframeJson sections -> subsections -> fields
    var sfFields = collectSignframeFields(signframeJson);

    // 4. Build lookup: matrix rows by sourceName and acroActual
    var mxBySource = {};
    var mxByAcro = {};
    for (var mi = 0; mi < matrixRows.length; mi++) {
        var mrow = matrixRows[mi];
        var sn = mrow.sourceName;
        var aa = mrow.acroActual;
        if (sn) {
            mxBySource[String(sn)] = mrow;
        }
        if (aa) {
            mxByAcro[String(aa)] = mrow;
        }
    }

    // 5. Build label -> fieldId lookup for conditional visibility
    var labelToId = {};
    for (var li = 0; li < matrixRows.length; li++) {
        var lrow = matrixRows[li];
        var etiq = lrow.etiqueta;
        var lsn = lrow.sourceName || lrow.acroActual || '';
        if (etiq && lsn) {
            labelToId[String(etiq).toLowerCase().trim()] = 'field_' + String(lsn);
        }
    }

    // 6. Detect radio groups: only groups where at least one member has nativeType 'Btn'
    var candidateGroups = {};
    for (var gi = 0; gi < matrixRows.length; gi++) {
        var grow = matrixRows[gi];
        var grupo = grow.grupo;
        if (grupo) {
            grupo = String(grupo).trim();
            if (!candidateGroups[grupo]) {
                candidateGroups[grupo] = [];
            }
            candidateGroups[grupo].push(grow);
        }
    }

    var radioGroups = {};
    for (var gName in candidateGroups) {
        var gRows = candidateGroups[gName];
        var hasBtn = false;
        var hasRadioType = false;
        for (var bi = 0; bi < gRows.length; bi++) {
            if (String(gRows[bi].nativeType || '').trim() === 'Btn') {
                hasBtn = true;
            }
            if (String(gRows[bi].tipoDato || '').toLowerCase().indexOf('radio') !== -1) {
                hasRadioType = true;
            }
        }
        if (hasBtn || hasRadioType) {
            radioGroups[gName] = gRows;
        }
    }

    // 7. Cross-reference: match signframe fields to matrix rows
    var fieldsWithSection = [];
    var unmatchedSf = [];
    var usedMxKeys = {};

    for (var fi = 0; fi < sfFields.length; fi++) {
        var field = sfFields[fi];
        var key = sourceKey(field);
        var mx = mxBySource[key] || mxByAcro[key] || null;

        if (mx) {
            usedMxKeys[String(mx.sourceName || '')] = true;
            usedMxKeys[String(mx.acroActual || '')] = true;
            var secName = String(mx.seccionPdf || 'Sin Seccion').trim();
            enrichField(field, mx, radioGroups, labelToId);
            fieldsWithSection.push({ field: field, sectionName: secName });
        } else {
            unmatchedSf.push(field);
            warnings.push({
                stage: 'cross-reference',
                detail: 'Campo signframe "' + (field.id || '') + '" (source=' + key + ') sin match en matriz -> seccion Sistema',
            });
        }
    }

    // Track unmatched matrix rows
    var unmatchedMatrixCount = 0;
    for (var umi = 0; umi < matrixRows.length; umi++) {
        var umrow = matrixRows[umi];
        var umSn = String(umrow.sourceName || '');
        var umAa = String(umrow.acroActual || '');
        if (!usedMxKeys[umSn] && !usedMxKeys[umAa]) {
            unmatchedMatrixCount++;
            warnings.push({
                stage: 'cross-reference',
                detail: 'Fila de matriz sourceName="' + umSn + '" (acro="' + umAa + '") sin match en signframe.json',
            });
        }
    }

    // Repeater warnings
    for (var ri = 0; ri < sfFields.length; ri++) {
        if (sfFields[ri].repeaterConfig) {
            warnings.push({
                stage: 'repeater',
                detail: 'Campo "' + (sfFields[ri].id || '') + '" tiene repeaterConfig -> preservado tal cual, revisar manualmente',
            });
        }
    }

    // 9. Organize into sections using seccionPdf
    var sections = organizeSections(fieldsWithSection, unmatchedSf);

    // 10. Validate: fix order=0, checkbox values, conditional operators
    validateOutput(sections, warnings);

    // 11. Build final output preserving top-level keys
    var output = {};
    for (var topKey in signframeJson) {
        if (signframeJson.hasOwnProperty(topKey)) {
            if (topKey === 'sections') continue;
            output[topKey] = signframeJson[topKey];
        }
    }
    output.sections = sections;

    // Parse target JSON for validation
    var targetJson = null;
    if (targetJsonText) {
        try {
            targetJson = JSON.parse(targetJsonText);
        } catch (e) {
            warnings.push({ stage: 'target-json', detail: 'No se pudo parsear JSON destino: ' + e.message });
        }
    }

    // Build pseudo pdfFields array from signframe sourceMeta for validator
    var pdfFieldsForValidation = [];
    for (var vi = 0; vi < sfFields.length; vi++) {
        var vf = sfFields[vi];
        if (vf.sourceMeta && vf.sourceMeta.sourceName) {
            pdfFieldsForValidation.push({ name: vf.sourceMeta.sourceName });
        }
    }

    var validation = validator.validate(output, pdfFieldsForValidation, targetJson);

    // Count total fields in final output
    var totalFields = 0;
    for (var si = 0; si < sections.length; si++) {
        var subs = sections[si].subsections || [];
        for (var ssi = 0; ssi < subs.length; ssi++) {
            totalFields += (subs[ssi].fields || []).length;
        }
    }

    return {
        json: output,
        validation: validation,
        warnings: warnings,
        stats: {
            matrixRows: matrixRows.length,
            signframeFields: sfFields.length,
            totalFields: totalFields,
            sections: sections.length,
            radioGroups: Object.keys(radioGroups).length,
            unmatchedSignframe: unmatchedSf.length,
            unmatchedMatrix: unmatchedMatrixCount,
        },
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Collect all fields from a signframe JSON, reading BOTH
 * sections[].fields and sections[].subsections[].fields.
 * (Some skeletons place fields directly on the section.)
 */
function collectSignframeFields(data) {
    var fields = [];
    var sections = data.sections || [];
    for (var s = 0; s < sections.length; s++) {
        var direct = sections[s].fields || [];
        for (var d = 0; d < direct.length; d++) {
            fields.push(direct[d]);
        }
        var subs = sections[s].subsections || [];
        for (var ss = 0; ss < subs.length; ss++) {
            var ff = subs[ss].fields || [];
            for (var f = 0; f < ff.length; f++) {
                fields.push(ff[f]);
            }
        }
    }
    return fields;
}

/**
 * Build a label -> fieldId lookup for conditional visibility resolution.
 */
function buildLabelToId(matrixRows) {
    var labelToId = {};
    for (var li = 0; li < matrixRows.length; li++) {
        var lrow = matrixRows[li];
        var etiq = lrow.etiqueta;
        var lsn = lrow.sourceName || lrow.acroActual || '';
        if (etiq && lsn) {
            labelToId[String(etiq).toLowerCase().trim()] = 'field_' + String(lsn);
        }
    }
    return labelToId;
}

/**
 * Detect radio groups: groups where at least one member has nativeType 'Btn'
 * or a tipoDato containing 'radio'.
 */
function detectRadioGroups(matrixRows) {
    var candidateGroups = {};
    for (var gi = 0; gi < matrixRows.length; gi++) {
        var grow = matrixRows[gi];
        var grupo = grow.grupo;
        if (grupo) {
            grupo = String(grupo).trim();
            if (!candidateGroups[grupo]) candidateGroups[grupo] = [];
            candidateGroups[grupo].push(grow);
        }
    }
    var radioGroups = {};
    for (var gName in candidateGroups) {
        var gRows = candidateGroups[gName];
        var hasBtn = false, hasRadioType = false;
        for (var bi = 0; bi < gRows.length; bi++) {
            if (String(gRows[bi].nativeType || '').trim() === 'Btn') hasBtn = true;
            if (String(gRows[bi].tipoDato || '').toLowerCase().indexOf('radio') !== -1) hasRadioType = true;
        }
        if (hasBtn || hasRadioType) radioGroups[gName] = gRows;
    }
    return radioGroups;
}

/**
 * Extract the matching key from a signframe field.
 * Uses sourceMeta.sourceName if present, else strips 'field_' prefix from id.
 */
function sourceKey(field) {
    var sm = field.sourceMeta;
    if (sm && sm.sourceName) {
        return sm.sourceName;
    }
    var fid = field.id || '';
    if (fid.indexOf('field_') === 0) {
        return fid.substring(6);
    }
    return fid;
}

/**
 * Convert a section name to a slug key for ids.
 */
function toKey(name) {
    if (!name) return 'otros';
    var k = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    k = k.replace(/[^a-z0-9]+/g, '_');
    k = k.replace(/^_+|_+$/g, '');
    return k || 'otros';
}

/**
 * Split numbered sections: "BENEFICIARIO 1" -> { base: "BENEFICIARIO", num: "1" }
 */
function sectionParent(name) {
    var trimmed = (name || '').trim();
    var m = trimmed.match(/^(.+?)\s+(\d+)\s*$/);
    if (m) {
        return { base: m[1].trim(), num: m[2] };
    }
    return { base: trimmed, num: null };
}

/**
 * Humanize a group name: replace underscores with spaces and title-case.
 */
function humanizeGroup(grupo) {
    var s = String(grupo).replace(/_/g, ' ');
    return s.replace(/\w\S*/g, function (word) {
        return word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
    });
}

/**
 * Resolve number format from row.formato.
 */
function resolveNumberFormat(row) {
    if (!row.formato) return null;
    var f = String(row.formato).toLowerCase();
    if (f.indexOf('monto') !== -1 || f.indexOf('moneda') !== -1 || f.indexOf('currency') !== -1) {
        return NUMBER_FORMATS.monto;
    }
    if (f.indexOf('porcentaje') !== -1 || f.indexOf('%') !== -1) {
        return NUMBER_FORMATS.porcentaje;
    }
    if (f.indexOf('entero') !== -1 || f.indexOf('integer') !== -1) {
        return NUMBER_FORMATS.entero;
    }
    if (f === 'numerico' || f === 'numérico' || f === 'numero') {
        return NUMBER_FORMATS.entero;
    }
    return null;
}

/**
 * Build conditional visibility, resolving label references using labelToId lookup.
 */
function buildConditionalVisibilityWithLabels(raw, labelToId) {
    if (!raw) return null;
    var trimmed = String(raw).trim();
    if (!trimmed) return null;

    // Try parsing as JSON first
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        try {
            var parsed = JSON.parse(trimmed);
            ensureFieldPrefix(parsed);
            validateOperators(parsed);
            return JSON.stringify(parsed);
        } catch (e) { /* fall through */ }
    }

    // Try natural-language patterns
    var match = trimmed.match(/[Ss]i\s+"([^"]+)"\s+(?:seleccionado|marcado)/i);
    if (!match) {
        match = trimmed.match(/[Ss]i\s+(?:se\s+)?(?:selecciona|elige|marca)\s+"?([^"]+?)"?\s*(?:->|→|,|\s+mostrar)/i);
    }
    if (match) {
        var refLabel = match[1].trim();
        var fid = labelToId[refLabel.toLowerCase()];
        if (!fid) {
            var ref = refLabel.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');
            fid = 'field_' + ref;
        }
        return JSON.stringify({
            logic: 'and',
            conditions: [{ fieldId: fid, operator: 'not_empty' }],
        });
    }

    return null;
}

function ensureFieldPrefix(obj) {
    if (!obj || typeof obj !== 'object') return;
    var conditions = obj.conditions;
    if (!conditions) return;
    for (var i = 0; i < conditions.length; i++) {
        var c = conditions[i];
        if (c.fieldId && c.fieldId.indexOf('field_') !== 0) {
            c.fieldId = 'field_' + c.fieldId;
        }
    }
}

var VALID_OPERATORS = { not_empty: true, empty: true, equals: true };

function validateOperators(obj) {
    if (!obj || typeof obj !== 'object') return;
    var conditions = obj.conditions;
    if (!conditions) return;
    for (var i = 0; i < conditions.length; i++) {
        var c = conditions[i];
        var op = c.operator || '';
        if (op && !VALID_OPERATORS[op]) {
            c.operator = 'not_empty';
        }
        if (op === 'equals' && !('value' in c)) {
            c.value = '';
        }
    }
}

/**
 * Find a matching option by label (exact then partial).
 */
function findMatchingOption(label, options) {
    var ll = String(label).toLowerCase().trim();
    for (var i = 0; i < options.length; i++) {
        if ((options[i].label || '').toLowerCase().trim() === ll) {
            return options[i];
        }
    }
    for (var j = 0; j < options.length; j++) {
        var ol = (options[j].label || '').toLowerCase();
        if (ll.indexOf(ol) !== -1 || ol.indexOf(ll) !== -1) {
            return options[j];
        }
    }
    return null;
}

// ─── Field enrichment ───────────────────────────────────────────────────────

/**
 * Enrich a signframe field with matrix data.
 * REGLA DE ORO: id and sourceMeta are NEVER modified.
 * autoFillConcat, repeaterConfig, sourceMeta are PRESERVED as-is.
 */
function enrichField(field, mx, radioGroups, labelToId) {
    var ftype = fieldBuilder.resolveType(mx);
    var path = fieldBuilder.correctPath(mx.pathPrincipal);
    var options = fieldBuilder.buildOptions(mx);
    var condVis = buildConditionalVisibilityWithLabels(mx.visibilidadCondicional, labelToId);
    var numFmt = resolveNumberFormat(mx);

    // Label
    field.label = mx.etiqueta || field.label || '';

    // Type (may be overridden below for radio)
    field.type = ftype;

    // Required
    field.required = mx.obligatorio === true;

    // readOnly: false for any field with sourceMeta (ALWAYS)
    if (field.sourceMeta) {
        field.readOnly = false;
    } else if (field.readOnly === undefined) {
        field.readOnly = false;
    }

    // Defaults if not present
    if (field.hidden === undefined) {
        field.hidden = false;
    }
    if (field.width === undefined) {
        field.width = 'full';
    }

    // prefillMode
    if (mx.preRellenado === true) {
        field.prefillMode = 'required';
    } else if (mx.preRellenado === false) {
        field.prefillMode = 'none';
    }

    // Paths
    if (path) {
        field.salidaJSON = path;
        field.jsonOutputPath = path;
        field.prefillKey = path;
        field.excludeFromJson = false;
    } else if (!field.salidaJSON) {
        field.excludeFromJson = true;
    }

    // Secondary paths
    if (mx.pathsSecundarios) {
        var rawPaths = String(mx.pathsSecundarios);
        var sep = rawPaths.indexOf('|') !== -1 ? '|' : ',';
        var paths = rawPaths.split(sep);
        var cleanPaths = [];
        for (var pi = 0; pi < paths.length; pi++) {
            var p = paths[pi].trim();
            if (p) cleanPaths.push(p);
        }
        if (cleanPaths.length) {
            field.mappedPaths = cleanPaths;
        }
    }

    // conditionalVisibility
    if (condVis) {
        field.conditionalVisibility = condVis;
    } else if (field.conditionalVisibility === undefined) {
        field.conditionalVisibility = null;
    }

    if (field.conditionalRequired === undefined) {
        field.conditionalRequired = null;
    }

    // maxLength
    if (mx.maxLength) {
        field.maxLength = mx.maxLength;
    }

    // validationPattern
    if (mx.patron) {
        field.validationPattern = String(mx.patron);
    }

    // options
    if (options) {
        field.options = options;
    }

    // numberFormat
    if (numFmt) {
        field.jsonNumberFormat = numFmt;
    }

    // Checkbox: checkedPdfValue depends on sourceMeta presence
    if (ftype === 'checkbox') {
        if (field.sourceMeta) {
            field.checkedPdfValue = true;
            field.checkedJsonValue = true;
        }
        // No sourceMeta -> leave existing (can be "X")
    }

    // Width hints
    if (ftype === 'date') {
        field.width = 'half';
    }
    if (ftype === 'select' && options) {
        field.width = 'half';
    }

    // autoFillConcat: PRESERVE, never overwrite
    // repeaterConfig: PRESERVE, never overwrite

    // Radio group handling
    var grupo = mx.grupo;
    if (grupo) {
        grupo = String(grupo).trim();
    }
    if (grupo && radioGroups[grupo] && radioGroups[grupo].length > 1) {
        field.type = 'radio';
        var groupRows = radioGroups[grupo];
        var groupIds = [];
        for (var gri = 0; gri < groupRows.length; gri++) {
            var grSn = String(groupRows[gri].sourceName || groupRows[gri].acroActual || '');
            groupIds.push('field_' + grSn);
        }

        field.radioGroupLabel = humanizeGroup(grupo);
        var otherIds = [];
        for (var oi = 0; oi < groupIds.length; oi++) {
            if (groupIds[oi] !== field.id) {
                otherIds.push(groupIds[oi]);
            }
        }
        field.radioGroupFields = otherIds;

        if (options) {
            field.options = options;
        }

        var etiqueta = mx.etiqueta || '';
        if (options) {
            var matchedOpt = findMatchingOption(String(etiqueta), options);
            if (matchedOpt) {
                field.jsonValue = matchedOpt.jsonValue || matchedOpt.value || etiqueta;
                field.pdfValue = matchedOpt.pdfValue || matchedOpt.label || etiqueta;
            } else {
                field.jsonValue = etiqueta;
                field.pdfValue = etiqueta;
            }
        } else {
            field.jsonValue = etiqueta;
            field.pdfValue = etiqueta;
        }
    }

    return field;
}

// ─── Section organization ───────────────────────────────────────────────────

/**
 * Assign incremental order starting at 1 (NEVER 0).
 */
function assignOrder(fields) {
    for (var i = 0; i < fields.length; i++) {
        fields[i].order = i + 1;
    }
}

/**
 * Organize fields into sections based on the matrix seccionPdf column.
 */
function organizeSections(fieldsWithSection, unmatchedSf) {
    // Collect unique section names in order of appearance
    var seen = {};
    var sectionNamesOrdered = [];
    var sectionFieldsMap = {};

    for (var i = 0; i < fieldsWithSection.length; i++) {
        var fws = fieldsWithSection[i];
        var secName = fws.sectionName;
        if (!seen[secName]) {
            seen[secName] = true;
            sectionNamesOrdered.push(secName);
            sectionFieldsMap[secName] = [];
        }
        sectionFieldsMap[secName].push(fws.field);
    }

    // Group numbered sections: "BENEFICIARIO 1" / "BENEFICIARIO 2" -> parent "BENEFICIARIO"
    var parentGroups = {};
    var parentInsertionOrder = [];

    for (var ni = 0; ni < sectionNamesOrdered.length; ni++) {
        var sName = sectionNamesOrdered[ni];
        var sp = sectionParent(sName);
        var base = sp.base;
        var num = sp.num;
        if (!parentGroups[base]) {
            parentGroups[base] = [];
            parentInsertionOrder.push(base);
        }
        parentGroups[base].push({ name: sName, num: num });
    }

    var sections = [];
    var secOrder = 1;

    for (var pi = 0; pi < parentInsertionOrder.length; pi++) {
        var parentName = parentInsertionOrder[pi];
        var children = parentGroups[parentName];
        var hasNumbered = false;
        for (var ci = 0; ci < children.length; ci++) {
            if (children[ci].num !== null) {
                hasNumbered = true;
                break;
            }
        }

        if (hasNumbered && children.length > 1) {
            // Multiple numbered subsections under one parent section
            var subsections = [];
            var subOrder = 1;
            for (var chi = 0; chi < children.length; chi++) {
                var childName = children[chi].name;
                var childFields = sectionFieldsMap[childName] || [];
                assignOrder(childFields);
                var subId = 'subsection_' + toKey(childName);
                subsections.push({
                    id: subId,
                    title: titleCase(childName),
                    order: subOrder,
                    fields: childFields,
                    childrenOrder: childFields.map(function (f) {
                        return { kind: 'field', id: f.id };
                    }),
                });
                subOrder++;
            }

            var secId = 'section_' + toKey(parentName);
            var parentTitle = titleCase(parentName);
            // Pluralize if not already ending in s/es
            if (parentTitle.charAt(parentTitle.length - 1) !== 's') {
                parentTitle += 's';
            }

            sections.push({
                id: secId,
                title: parentTitle,
                order: secOrder,
                subsections: subsections,
                childrenOrder: subsections.map(function (s) {
                    return { kind: 'subsection', id: s.id };
                }),
            });
            secOrder++;
        } else {
            // Single section per child, each with one subsection (same title)
            for (var schi = 0; schi < children.length; schi++) {
                var cName = children[schi].name;
                var cFields = sectionFieldsMap[cName] || [];
                assignOrder(cFields);
                var cSecId = 'section_' + toKey(cName);
                var cSubId = 'subsection_' + toKey(cName);
                var cleanTitle = titleCase(cName);

                var subsection = {
                    id: cSubId,
                    title: cleanTitle,
                    order: 1,
                    fields: cFields,
                    childrenOrder: cFields.map(function (f) {
                        return { kind: 'field', id: f.id };
                    }),
                };

                sections.push({
                    id: cSecId,
                    title: cleanTitle,
                    order: secOrder,
                    subsections: [subsection],
                    childrenOrder: [{ kind: 'subsection', id: cSubId }],
                });
                secOrder++;
            }
        }
    }

    // Unmatched signframe fields -> hidden "Sistema" section with NEVER_CONDITION
    if (unmatchedSf.length > 0) {
        assignOrder(unmatchedSf);
        var sysSubId = 'subsection_sistema_oculto';
        var sysSubsection = {
            id: sysSubId,
            title: 'Datos del Sistema (oculto)',
            order: 1,
            conditionalVisibility: NEVER_CONDITION,
            fields: unmatchedSf,
            childrenOrder: unmatchedSf.map(function (f) {
                return { kind: 'field', id: f.id };
            }),
        };
        sections.push({
            id: 'section_sistema',
            title: 'Sistema',
            order: secOrder,
            subsections: [sysSubsection],
            childrenOrder: [{ kind: 'subsection', id: sysSubId }],
        });
    }

    return sections;
}

/**
 * Title-case a string: capitalize first letter of each word.
 */
function titleCase(str) {
    return String(str).replace(/\w\S*/g, function (word) {
        return word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
    });
}

// ─── Output validation ──────────────────────────────────────────────────────

/**
 * Fix order=0, checkbox values, conditional operator issues in-place.
 */
function validateOutput(sections, warnings) {
    for (var si = 0; si < sections.length; si++) {
        var subs = sections[si].subsections || [];
        for (var ssi = 0; ssi < subs.length; ssi++) {
            var fields = subs[ssi].fields || [];
            for (var fi = 0; fi < fields.length; fi++) {
                var f = fields[fi];

                // order must not be 0
                if (f.order === 0 || f.order === undefined) {
                    warnings.push({
                        stage: 'validation',
                        detail: 'Campo "' + (f.id || '') + '" tenia order=0, corregido a 1',
                    });
                    f.order = 1;
                }

                // conditionalVisibility validation
                var cv = f.conditionalVisibility;
                if (cv && typeof cv === 'string') {
                    try {
                        var parsed = JSON.parse(cv);
                        var modified = false;
                        var conditions = parsed.conditions || [];
                        for (var ci = 0; ci < conditions.length; ci++) {
                            var cond = conditions[ci];
                            var op = cond.operator || '';
                            if (op && !VALID_OPERATORS[op]) {
                                var oldOp = op;
                                cond.operator = 'not_empty';
                                modified = true;
                                warnings.push({
                                    stage: 'validation',
                                    detail: 'Campo "' + (f.id || '') + '" operador invalido "' + oldOp + '" -> "not_empty"',
                                });
                            }
                            if (op === 'equals' && !('value' in cond)) {
                                cond.value = '';
                                modified = true;
                            }
                            var fid = cond.fieldId || '';
                            if (fid && fid.indexOf('field_') !== 0) {
                                cond.fieldId = 'field_' + fid;
                                modified = true;
                            }
                        }
                        if (modified) {
                            f.conditionalVisibility = JSON.stringify(parsed);
                        }
                    } catch (e) {
                        // invalid JSON, leave as-is
                    }
                }

                // checkbox with sourceMeta must use true, not "X"
                if (f.type === 'checkbox' && f.sourceMeta) {
                    var cpv = f.checkedPdfValue;
                    if (cpv === 'X' || cpv === 'x') {
                        f.checkedPdfValue = true;
                        f.checkedJsonValue = true;
                        warnings.push({
                            stage: 'validation',
                            detail: 'Checkbox "' + (f.id || '') + '" con sourceMeta tenia "X" -> true',
                        });
                    }
                }
            }
        }
    }
}

module.exports = {
    combineWithSignframe,
    collectSignframeFields,
    buildLabelToId,
    detectRadioGroups,
    buildConditionalVisibilityWithLabels,
    enrichField,
    organizeSections,
    validateOutput,
    sourceKey,
};
