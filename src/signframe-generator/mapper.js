'use strict';

/**
 * mapper.js — Two-stage assisted mapping for Signframe form definitions.
 *
 * ETAPA 1 (prepareMapping): iterate every signframe JSON field and, for each,
 *   propose the best matrix row. The HUMAN confirms the link (or marks "not in
 *   matrix"). The cross axis is the sourceName; it is LINKED here, never guessed
 *   in Etapa 2.
 *
 * ETAPA 2 (generateFromMapping): generate the form definition driven by the
 *   VERIFIED matrix:
 *     - pintaPdf=si  → find the signframe field by its linked sourceName,
 *                      inherit sourceMeta intact, apply matrix props.
 *     - pintaPdf=no  → create a brand new field, no sourceMeta.
 *
 * REGLA DE ORO: id and sourceMeta are NEVER modified.
 */

var matrixParser = require('./matrix-parser');
var fieldBuilder = require('./field-builder');
var validator = require('./validator');
var combiner = require('./combiner');

var NONE = 'NONE'; // sentinel: json field explicitly not in the matrix

// ─── String helpers ──────────────────────────────────────────────────────────

function norm(s) {
    if (!s) return '';
    return String(s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(s) {
    var n = norm(s);
    return n ? n.split(' ') : [];
}

function similarity(a, b) {
    var na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    // Dice coefficient on bigrams — cheap and good enough for suggestions.
    var pairs = function (str) {
        var p = {};
        for (var i = 0; i < str.length - 1; i++) {
            var bg = str.substr(i, 2);
            p[bg] = (p[bg] || 0) + 1;
        }
        return p;
    };
    var pa = pairs(na), pb = pairs(nb);
    var inter = 0, total = 0;
    for (var k in pa) { total += pa[k]; if (pb[k]) inter += Math.min(pa[k], pb[k]); }
    for (var k2 in pb) total += pb[k2];
    return total ? (2 * inter) / total : 0;
}

function tokenOverlap(a, b) {
    var ta = tokenize(a), tb = tokenize(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {};
    for (var i = 0; i < tb.length; i++) setB[tb[i]] = true;
    var shared = 0;
    for (var j = 0; j < ta.length; j++) if (setB[ta[j]]) shared++;
    return shared / Math.min(ta.length, tb.length);
}

// ─── Field extraction ────────────────────────────────────────────────────────

function sourceNameOf(field) {
    var sm = field.sourceMeta;
    if (sm && sm.sourceName) return sm.sourceName;
    var fid = field.id || '';
    return fid.indexOf('field_') === 0 ? fid.substring(6) : fid;
}

function liteJsonField(field) {
    var sm = field.sourceMeta || {};
    var sn = sourceNameOf(field);
    return {
        sourceName: sn,
        id: field.id || ('field_' + sn),
        page: sm.page != null ? sm.page : null,
        nativeType: sm.nativeType || '',
        type: field.type || '',
        label: field.label || sn,
    };
}

// ─── Suggestion scoring ──────────────────────────────────────────────────────

function scoreRow(jf, mx) {
    var sn = jf.sourceName || '';
    // Strongest signal: the matrix already names this exact source field.
    if (mx.acroActual && mx.acroActual === sn) return 100;
    if (mx.sourceName && mx.sourceName === sn) return 100;

    var score = 0;
    if (mx.acroActual && norm(mx.acroActual) === norm(sn)) score = Math.max(score, 90);
    if (mx.sourceName && norm(mx.sourceName) === norm(sn)) score = Math.max(score, 90);

    score += similarity(mx.etiqueta, jf.label) * 40;
    score += similarity(mx.etiqueta, sn) * 15;
    score += similarity(mx.acroActual, sn) * 20;
    score += tokenOverlap(mx.etiqueta, jf.label) * 15;
    if (mx.pagina != null && jf.page != null && Number(mx.pagina) === Number(jf.page)) score += 5;
    return score;
}

function bestSuggestion(jf, matrixRows) {
    var best = null, bestScore = 0;
    for (var i = 0; i < matrixRows.length; i++) {
        var s = scoreRow(jf, matrixRows[i]);
        if (s > bestScore) { bestScore = s; best = matrixRows[i]; }
    }
    if (!best) return null;
    return {
        rowNum: best.rowNum,
        score: Math.min(bestScore / 100, 1),
        label: best.etiqueta || best.acroActual || ('fila ' + best.rowNum),
    };
}

// ─── ETAPA 1: prepare ────────────────────────────────────────────────────────

/**
 * Parse the matrix and the signframe JSON, returning every JSON field with its
 * best matrix suggestion plus the list of matrix rows for the picker UI.
 *
 * @param {Object} opts
 * @param {Object} opts.signframeJson
 * @param {Buffer|Uint8Array} opts.matrixBytes
 * @returns {{jsonFields:Array, matrixRows:Array, warnings:Array}}
 */
function prepareMapping(opts) {
    var signframeJson = opts.signframeJson;
    var matrix = matrixParser.parseMatrixAuto(opts.matrixBytes);
    var matrixRows = matrix.rows;

    var sfFields = combiner.collectSignframeFields(signframeJson);
    var jsonFields = [];
    for (var i = 0; i < sfFields.length; i++) {
        var jf = liteJsonField(sfFields[i]);
        var sug = bestSuggestion(jf, matrixRows);
        jf.suggestionRowNum = sug ? sug.rowNum : null;
        jf.suggestionScore = sug ? sug.score : 0;
        jf.suggestionLabel = sug ? sug.label : '';
        jsonFields.push(jf);
    }

    var rowsLite = matrixRows.map(function (r) {
        return {
            rowNum: r.rowNum,
            etiqueta: r.etiqueta,
            seccionPdf: r.seccionPdf,
            acroActual: r.acroActual,
            sourceName: r.sourceName,
            nativeType: r.nativeType,
            tipoDato: r.tipoDato,
            pagina: r.pagina,
        };
    });

    return { jsonFields: jsonFields, matrixRows: rowsLite, warnings: matrix.warnings };
}

// ─── ETAPA 2: generate from verified mapping ─────────────────────────────────

function cloneField(field) {
    return JSON.parse(JSON.stringify(field));
}

/**
 * For a "pintaPdf=no" row with no PDF name, derive a stable, unique sourceName
 * from the label so the new field gets a meaningful id (never just "field_").
 */
function ensureSyntheticSource(mx) {
    if (mx.sourceName || mx.acroActual || mx.acroPropuesto) return;
    var base = norm(mx.etiqueta).replace(/\s+/g, '_').slice(0, 40);
    if (!base) base = 'campo';
    mx.acroPropuesto = base + '_r' + mx.rowNum;
}

/**
 * Generate the form definition driven by the verified matrix + the human link.
 *
 * @param {Object} opts
 * @param {Object} opts.signframeJson
 * @param {Buffer|Uint8Array} opts.matrixBytes
 * @param {Object} opts.mapping       - { links: { [sourceName]: rowNum | 'NONE' } }
 * @param {string} [opts.targetJsonText]
 * @returns {{json, validation, warnings, stats}}
 */
function generateFromMapping(opts) {
    var signframeJson = opts.signframeJson;
    var mapping = opts.mapping || { links: {} };
    var links = mapping.links || {};
    var targetJsonText = opts.targetJsonText || null;
    var warnings = [];

    var matrix = matrixParser.parseMatrixAuto(opts.matrixBytes);
    var matrixRows = matrix.rows;
    for (var w = 0; w < matrix.warnings.length; w++) {
        warnings.push({ stage: 'matrix', detail: matrix.warnings[w] });
    }

    // signframe fields indexed by sourceName
    var sfFields = combiner.collectSignframeFields(signframeJson);
    var sfBySource = {};
    for (var i = 0; i < sfFields.length; i++) {
        sfBySource[sourceNameOf(sfFields[i])] = sfFields[i];
    }

    // Invert the human links: matrix rowNum -> [sourceName, ...]
    var rowToSources = {};
    for (var sn in links) {
        if (!links.hasOwnProperty(sn)) continue;
        var target = links[sn];
        if (target == null || target === NONE) continue;
        var rn = Number(target);
        if (isNaN(rn)) continue;
        if (!rowToSources[rn]) rowToSources[rn] = [];
        rowToSources[rn].push(sn);
    }

    var radioGroups = combiner.detectRadioGroups(matrixRows);
    var labelToId = combiner.buildLabelToId(matrixRows);

    var fieldsWithSection = [];
    var usedSf = {};
    var paintsPdf = 0, createdNew = 0;

    // Matrix-driven: every matrix row becomes a field.
    for (var mi = 0; mi < matrixRows.length; mi++) {
        var mx = matrixRows[mi];
        var linkedSources = rowToSources[mx.rowNum] || [];
        var field;

        if (linkedSources.length) {
            // pintaPdf = si: inherit the signframe field (keep id + sourceMeta intact)
            var primarySn = linkedSources[0];
            var sfField = sfBySource[primarySn];
            if (sfField) {
                field = cloneField(sfField);
                usedSf[primarySn] = true;
                combiner.enrichField(field, mx, radioGroups, labelToId);
                paintsPdf++;
                if (linkedSources.length > 1) {
                    for (var ls = 1; ls < linkedSources.length; ls++) usedSf[linkedSources[ls]] = true;
                    warnings.push({
                        stage: 'mapping',
                        detail: 'Fila ' + mx.rowNum + ' tiene ' + linkedSources.length +
                            ' campos vinculados; se usó "' + primarySn + '" como sourceMeta.',
                    });
                }
            } else {
                warnings.push({
                    stage: 'mapping',
                    detail: 'sourceName "' + primarySn + '" vinculado a la fila ' + mx.rowNum +
                        ' no existe en el JSON de Signframe — se creó campo sin sourceMeta.',
                });
                ensureSyntheticSource(mx);
                field = fieldBuilder.buildField(mx, null);
                createdNew++;
            }
        } else {
            // pintaPdf = no: brand new field, no sourceMeta
            ensureSyntheticSource(mx);
            field = fieldBuilder.buildField(mx, null);
            createdNew++;
        }

        var secName = String(mx.seccionPdf || 'Sin Seccion').trim();
        fieldsWithSection.push({ field: field, sectionName: secName });
    }

    // signframe fields that were never linked → preserved in hidden "Sistema"
    var unmatchedSf = [];
    for (var k = 0; k < sfFields.length; k++) {
        var sk = sourceNameOf(sfFields[k]);
        if (!usedSf[sk]) unmatchedSf.push(cloneField(sfFields[k]));
    }

    var sections = combiner.organizeSections(fieldsWithSection, unmatchedSf);
    combiner.validateOutput(sections, warnings);

    // Preserve top-level keys
    var output = {};
    for (var topKey in signframeJson) {
        if (signframeJson.hasOwnProperty(topKey) && topKey !== 'sections') {
            output[topKey] = signframeJson[topKey];
        }
    }
    output.sections = sections;

    // Validation
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
            matrixRows: matrixRows.length,
            signframeFields: sfFields.length,
            totalFields: totalFields,
            sections: sections.length,
            radioGroups: Object.keys(radioGroups).length,
            paintsPdf: paintsPdf,
            createdNew: createdNew,
            unmatchedSignframe: unmatchedSf.length,
            unmatchedMatrix: 0,
        },
    };
}

module.exports = { prepareMapping, generateFromMapping, NONE };
