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

// ─── GROUP-BASED FLOW (robust auto-link by sourceName root) ──────────────────
//
// The sourceName already carries the classification. Grouping by root collapses
// the ~388 fields into ~225 logical groups, which mirror the matrix (1 row = 1
// question). We align groups ↔ matrix rows by section + reading order (from the
// renamed-PDF mapping xlsx), not by text fuzzy.

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function stripIndex(sn) { return sn.replace(/\[\d+\]$/, ''); }
function stripSiNo(sn) { return sn.replace(/(NoAplica|Si|No)$/, ''); }
function optionSuffix(sn) {
    var m = sn.match(/(NoAplica|Si|No)$/);
    return m ? m[1] : null;
}

/**
 * Classify ordered sourceName items into logical groups.
 * @param {Array} items - [{sourceName, section, page, tipo, idx}] in reading order
 * @returns {Array} groups - [{root, kind, members, section, page, order}]
 */
function classifyGroups(items) {
    // Tentative Si/No sibling index (only used to confirm real radio groups)
    var bySiNo = {};
    for (var s = 0; s < items.length; s++) {
        var it = items[s];
        if (/\[\d+\]$/.test(it.sourceName)) continue;
        var b = stripSiNo(it.sourceName);
        (bySiNo[b] = bySiNo[b] || []).push(it);
    }

    var groups = [];
    var seen = {};
    function ensure(root, kind) {
        if (seen[root]) return seen[root];
        var g = { root: root, kind: kind, members: [], section: '', page: null, order: null };
        seen[root] = g;
        groups.push(g);
        return g;
    }

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var g;
        if (/\[\d+\]$/.test(item.sourceName)) {
            g = ensure(stripIndex(item.sourceName), 'repeater');
        } else {
            var base = stripSiNo(item.sourceName);
            var sib = bySiNo[base] || [];
            var siNoSibs = 0;
            for (var k = 0; k < sib.length; k++) if (optionSuffix(sib[k].sourceName)) siNoSibs++;
            var isRadio = base !== item.sourceName && sib.length >= 2 && siNoSibs >= 2;
            g = isRadio ? ensure(base, 'radio') : ensure(item.sourceName, 'simple');
        }
        g.members.push(item);
        if (g.order == null) { g.order = item.idx; g.section = item.section; g.page = item.page; }
    }
    return groups;
}

/**
 * Parse the renamed-PDF mapping xlsx (22-col format) into ordered sourceName items.
 * For each row picks the column value that matches a signframe sourceName.
 */
function parseMappingItems(mappingBytes, signframeSet) {
    var parsed = matrixParser.parseMatrix(mappingBytes);
    var items = [];
    var warnings = parsed.warnings ? parsed.warnings.slice() : [];
    for (var i = 0; i < parsed.rows.length; i++) {
        var r = parsed.rows[i];
        var cands = [r.sourceName, r.acroPropuesto, r.acroActual].filter(Boolean);
        var sn = null;
        for (var c = 0; c < cands.length; c++) {
            if (signframeSet[cands[c]]) { sn = cands[c]; break; }
        }
        if (!sn) sn = cands[0] || null;
        if (!sn) continue;
        items.push({
            sourceName: sn,
            section: r.seccionPdf || '',
            page: r.pagina != null ? r.pagina : null,
            tipo: r.nativeType || '',
            idx: i,
            inSignframe: !!signframeSet[sn],
        });
    }
    return { items: items, warnings: warnings };
}

/**
 * Collapse consecutive matrix option-rows (same etiqueta + valor, no path) into
 * a single logical row carrying the options.
 */
function collapseMatrixLogical(rows) {
    var out = [];
    var i = 0;
    while (i < rows.length) {
        var p = rows[i];
        var opts = [];
        if (p.valor) opts.push(String(p.valor));
        var j = i + 1;
        while (j < rows.length) {
            var nx = rows[j];
            if (norm(nx.etiqueta) === norm(p.etiqueta) && nx.valor && !nx.pathPrincipal) {
                opts.push(String(nx.valor));
                j++;
            } else break;
        }
        var logical = {};
        for (var key in p) if (p.hasOwnProperty(key)) logical[key] = p[key];
        if (opts.length > 1) logical.optionsParsed = opts.map(function (v) { return { value: v, label: v }; });
        out.push(logical);
        i = j;
    }
    return out;
}

/**
 * ETAPA 1 (group flow): parse everything, build ordered groups + logical matrix
 * rows, and a positional/exact alignment suggestion per group.
 */
function prepareGroupMapping(opts) {
    var signframeJson = opts.signframeJson;
    var sfFields = combiner.collectSignframeFields(signframeJson);
    var signframeSet = {};
    for (var i = 0; i < sfFields.length; i++) signframeSet[sourceNameOf(sfFields[i])] = true;

    var mapping = parseMappingItems(opts.mappingBytes, signframeSet);
    var groups = classifyGroups(mapping.items);

    var matrix = matrixParser.parseMatrixAuto(opts.matrixBytes);
    var logicalRows = collapseMatrixLogical(matrix.rows);

    // exact match lookup by normalized matrix sourceName / acro / etiqueta
    var rowByExact = {};
    for (var r = 0; r < logicalRows.length; r++) {
        var lr = logicalRows[r];
        [lr.sourceName, lr.acroActual, lr.etiqueta].forEach(function (v) {
            if (v) { var key = norm(v); if (key && rowByExact[key] === undefined) rowByExact[key] = lr.rowNum; }
        });
    }

    var groupsOut = groups.map(function (g, gi) {
        // exact: group root or any member matches a matrix row
        var exact = null;
        var candidates = [g.root].concat(g.members.map(function (m) { return m.sourceName; }));
        for (var ci = 0; ci < candidates.length; ci++) {
            var key = norm(candidates[ci]);
            if (rowByExact[key] !== undefined) { exact = rowByExact[key]; break; }
        }
        var posRow = logicalRows[Math.min(gi, logicalRows.length - 1)];
        return {
            root: g.root,
            kind: g.kind,
            section: g.section,
            page: g.page,
            members: g.members.map(function (m) { return m.sourceName; }),
            suggestionRowNum: exact != null ? exact : (posRow ? posRow.rowNum : null),
            suggestionKind: exact != null ? 'exact' : 'position',
        };
    });

    var matrixOut = logicalRows.map(function (lr) {
        return {
            rowNum: lr.rowNum,
            etiqueta: lr.etiqueta,
            seccionPdf: lr.seccionPdf,
            nombrePdf: lr.nombrePdf,
            tipoDato: lr.tipoDato,
        };
    });

    var warnings = mapping.warnings.slice();
    // signframe fields missing from the mapping (can't be ordered)
    var inMapping = {};
    for (var mi = 0; mi < mapping.items.length; mi++) inMapping[mapping.items[mi].sourceName] = true;
    var missing = [];
    for (var fi = 0; fi < sfFields.length; fi++) {
        var sn = sourceNameOf(sfFields[fi]);
        if (!inMapping[sn]) missing.push(sn);
    }
    if (missing.length) {
        warnings.push({ stage: 'mapping', detail: missing.length + ' campos del JSON no aparecen en el xlsx de mapeo: ' + missing.slice(0, 10).join(', ') + (missing.length > 10 ? '…' : '') });
    }

    return { groups: groupsOut, matrixRows: matrixOut, warnings: warnings, missing: missing };
}

/**
 * Expand a group into one or more enriched fields, inheriting sourceMeta intact.
 */
function expandGroup(g, mx, sfByName, warnings) {
    var out = [];
    var memberNames = g.members.map(function (m) { return typeof m === 'string' ? m : m.sourceName; });
    if (g.kind === 'radio') {
        var ids = memberNames.map(function (sn) { var f = sfByName[sn]; return f ? f.id : ('field_' + sn); });
        for (var i = 0; i < memberNames.length; i++) {
            var sn = memberNames[i];
            var f = sfByName[sn];
            if (!f) { warnings.push({ stage: 'expand', detail: 'radio member "' + sn + '" sin campo en JSON' }); continue; }
            var fld = clone(f);
            combiner.enrichField(fld, mx, {}, {});
            fld.type = 'radio';
            fld.radioGroupLabel = mx.etiqueta || g.root;
            fld.radioGroupFields = ids.filter(function (id) { return id !== fld.id; });
            var suffix = optionSuffix(sn) || sn;
            fld.jsonValue = suffix;
            fld.pdfValue = suffix;
            out.push(fld);
        }
    } else if (g.kind === 'repeater') {
        warnings.push({ stage: 'repeater', detail: 'Repeater "' + g.root + '" (' + memberNames.length + ' items) dejado como campos sueltos agrupados (v1).' });
        for (var ri = 0; ri < memberNames.length; ri++) {
            var rf = sfByName[memberNames[ri]];
            if (!rf) continue;
            var rfld = clone(rf);
            combiner.enrichField(rfld, mx, {}, {});
            if (mx.etiqueta) rfld.label = mx.etiqueta + ' (' + (ri + 1) + ')';
            out.push(rfld);
        }
    } else {
        var sf0 = sfByName[memberNames[0]];
        if (sf0) {
            var s = clone(sf0);
            combiner.enrichField(s, mx, {}, {});
            out.push(s);
        }
    }
    return out;
}

/**
 * ETAPA 2 (group flow): generate the form definition from the verified
 * group→matrix alignment.
 *
 * @param {Object} opts
 * @param {Object} opts.mapping - { groupLinks: { [root]: matrixRowNum | 'NONE' } }
 */
function generateFromGroupMapping(opts) {
    var signframeJson = opts.signframeJson;
    var groupLinks = (opts.mapping && opts.mapping.groupLinks) || {};
    var targetJsonText = opts.targetJsonText || null;
    var warnings = [];

    var sfFields = combiner.collectSignframeFields(signframeJson);
    var sfByName = {};
    var signframeSet = {};
    for (var i = 0; i < sfFields.length; i++) {
        var sn = sourceNameOf(sfFields[i]);
        sfByName[sn] = sfFields[i];
        signframeSet[sn] = true;
    }

    var mapping = parseMappingItems(opts.mappingBytes, signframeSet);
    var groups = classifyGroups(mapping.items);
    var groupByRoot = {};
    for (var gi = 0; gi < groups.length; gi++) groupByRoot[groups[gi].root] = groups[gi];

    var matrix = matrixParser.parseMatrixAuto(opts.matrixBytes);
    for (var w = 0; w < matrix.warnings.length; w++) warnings.push({ stage: 'matrix', detail: matrix.warnings[w] });
    var logicalRows = collapseMatrixLogical(matrix.rows);
    var rowByNum = {};
    for (var lr = 0; lr < logicalRows.length; lr++) rowByNum[logicalRows[lr].rowNum] = logicalRows[lr];

    // invert: matrixRowNum -> [group, ...]
    var rowToGroups = {};
    var linkedGroups = {};
    for (var root in groupLinks) {
        if (!groupLinks.hasOwnProperty(root)) continue;
        var target = groupLinks[root];
        if (target == null || target === NONE) continue;
        var rn = Number(target);
        if (isNaN(rn)) continue;
        (rowToGroups[rn] = rowToGroups[rn] || []).push(root);
        linkedGroups[root] = true;
    }

    var fieldsWithSection = [];
    var usedNames = {};
    var paintsPdf = 0, createdNew = 0, radioCount = 0, repeaterCount = 0;

    for (var li = 0; li < logicalRows.length; li++) {
        var mx = logicalRows[li];
        var roots = rowToGroups[mx.rowNum] || [];
        var secName = String(mx.seccionPdf || 'Sin Seccion').trim();
        if (roots.length) {
            for (var rgi = 0; rgi < roots.length; rgi++) {
                var g = groupByRoot[roots[rgi]];
                if (!g) continue;
                if (g.kind === 'radio') radioCount++;
                if (g.kind === 'repeater') repeaterCount++;
                var fields = expandGroup(g, mx, sfByName, warnings);
                for (var fx = 0; fx < fields.length; fx++) {
                    fieldsWithSection.push({ field: fields[fx], sectionName: secName });
                    paintsPdf++;
                }
                for (var mm = 0; mm < g.members.length; mm++) {
                    var mn = typeof g.members[mm] === 'string' ? g.members[mm] : g.members[mm].sourceName;
                    usedNames[mn] = true;
                }
            }
        } else {
            ensureSyntheticSource(mx);
            fieldsWithSection.push({ field: fieldBuilder.buildField(mx, null), sectionName: secName });
            createdNew++;
        }
    }

    // signframe fields never linked -> hidden Sistema (preserved)
    var unmatchedSf = [];
    for (var k = 0; k < sfFields.length; k++) {
        var snk = sourceNameOf(sfFields[k]);
        if (!usedNames[snk]) unmatchedSf.push(clone(sfFields[k]));
    }

    var sections = combiner.organizeSections(fieldsWithSection, unmatchedSf);
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
            matrixRows: logicalRows.length,
            signframeFields: sfFields.length,
            groups: groups.length,
            linkedGroups: Object.keys(linkedGroups).length,
            totalFields: totalFields,
            sections: sections.length,
            radioGroups: radioCount,
            repeaters: repeaterCount,
            paintsPdf: paintsPdf,
            createdNew: createdNew,
            unmatchedSignframe: unmatchedSf.length,
            unmatchedMatrix: 0,
        },
    };
}

module.exports = {
    prepareMapping,
    generateFromMapping,
    prepareGroupMapping,
    generateFromGroupMapping,
    classifyGroups,
    NONE,
};
