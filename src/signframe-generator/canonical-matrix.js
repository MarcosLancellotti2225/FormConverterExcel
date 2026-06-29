'use strict';

/**
 * Generador de Matriz Canónica (2 hojas).
 *
 * Inputs:
 *   - mappingBytes: xlsx de mapeo del PDF renombrado (sourceNames en orden de
 *     lectura + tipo + página). Define la ESTRUCTURA técnica.
 *   - fichaBytes (opcional): Ficha original con las REGLAS DE NEGOCIO (matriz de
 *     14 columnas). Se fusiona por sourceName / etiqueta.
 *
 * Output (xlsx con 2 hojas):
 *   - "Campos":   1 fila por campo lógico canónico = estructura + negocio.
 *   - "Opciones": detalle de cada grupo (radio/repeater/repeaterLookup):
 *                 sus sourceNames individuales con opción/jsonValue/pdfValue/item.
 *
 * Lógica canónica por prefijo/sufijo del sourceName — nada hardcodeado del form
 * (todo sale de canonical-config.js).
 */

var XLSX = require('xlsx');
var config = require('./canonical-config');
var matrixParser = require('./matrix-parser');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function stripIndex(sn) { return sn.replace(/\[\d+\]$/, ''); }
function hasIndex(sn) { return /\[\d+\]$/.test(sn); }
function indexOf(sn) { var m = sn.match(/\[(\d+)\]$/); return m ? Number(m[1]) : null; }

function optionSuffix(sn) {
    var sfx = config.optionSuffixes || [];
    for (var i = 0; i < sfx.length; i++) {
        var re = new RegExp('_?' + sfx[i] + '$');
        if (re.test(sn) && sn.replace(re, '').length > 0) return sfx[i];
    }
    return null;
}
function stripOption(sn) {
    var sfx = config.optionSuffixes || [];
    for (var i = 0; i < sfx.length; i++) {
        var re = new RegExp('_?' + sfx[i] + '$');
        if (re.test(sn)) { var b = sn.replace(re, ''); if (b.length) return b; }
    }
    return sn;
}
function matchedLookup(sn) {
    var lps = config.lookupPrefixes || [];
    var best = null;
    for (var i = 0; i < lps.length; i++) {
        if (sn.indexOf(lps[i].prefix) === 0 && (!best || lps[i].prefix.length > best.prefix.length)) best = lps[i];
    }
    return best;
}
function sectionFor(root) {
    var map = config.sectionByPrefix || {};
    var bestKey = null;
    for (var key in map) {
        if (map.hasOwnProperty(key) && root.indexOf(key) === 0 && (!bestKey || key.length > bestKey.length)) bestKey = key;
    }
    return bestKey ? map[bestKey] : (config.defaultSection || 'General');
}
function isEntity(root) {
    var eps = config.entityPrefixes || [];
    var best = '';
    for (var i = 0; i < eps.length; i++) {
        if (root.indexOf(eps[i]) === 0 && eps[i].length > best.length) best = eps[i];
    }
    return best || '';
}
// Humanize an identifier into a readable needle guess: "VertigoSomareos" -> "Vertigo Somareos"
function humanize(s) {
    return String(s)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Read the mapping xlsx ────────────────────────────────────────────────────

var SOURCENAME_HEADERS = [
    /nombre\s+interno/i, /sourcename/i, /source\s*name/i,
    /acroform\s+propuesto/i, /nombre\s+del\s+campo\s+en\s+el\s+pdf/i,
    /nombre\s+del\s+campo\s+en\s+pdf/i, /propuesto/i, /acroform/i,
];
function detectColumn(headers, patterns) {
    for (var p = 0; p < patterns.length; p++) {
        for (var c = 0; c < headers.length; c++) {
            if (patterns[p].test(String(headers[c] || ''))) return c;
        }
    }
    return -1;
}
function readMappingItems(mappingBytes) {
    var wb = XLSX.read(mappingBytes, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) throw new Error('El xlsx de mapeo está vacío');
    var headers = raw[0];
    var colSn = detectColumn(headers, SOURCENAME_HEADERS);
    if (colSn === -1) {
        throw new Error('No encontré la columna de sourceNames. Headers: ' +
            headers.map(function (h) { return String(h); }).join(' | '));
    }
    var colTipo = detectColumn(headers, [/^tipo$/i, /tipo/i]);
    var colPag = detectColumn(headers, [/p[áa]gina/i, /^p[áa]g/i]);
    var items = [];
    for (var i = 1; i < raw.length; i++) {
        var r = raw[i];
        var sn = String(r[colSn] || '').trim();
        if (!sn) continue;
        items.push({
            sourceName: sn,
            tipo: colTipo !== -1 ? String(r[colTipo] || '').trim() : '',
            page: colPag !== -1 ? (r[colPag] !== '' ? r[colPag] : null) : null,
            idx: items.length,
        });
    }
    return items;
}

// ─── Collapse to canonical groups ─────────────────────────────────────────────

function collapse(items) {
    var groups = [];
    var byKey = {};
    function ensure(key, tipoCampo, extra) {
        if (byKey[key]) return byKey[key];
        var g = {
            key: key, tipoCampo: tipoCampo,
            grupo: extra && extra.grupo != null ? extra.grupo : key,
            catalogo: extra && extra.catalogo ? extra.catalogo : '',
            seccion: extra && extra.seccion ? extra.seccion : '',
            members: [], page: null, order: null,
        };
        byKey[key] = g; groups.push(g); return g;
    }

    var optBaseCount = {};
    for (var t = 0; t < items.length; t++) {
        var it0 = items[t];
        if (matchedLookup(it0.sourceName) || hasIndex(it0.sourceName)) continue;
        var ob = stripOption(it0.sourceName);
        if (ob !== it0.sourceName) optBaseCount[ob] = (optBaseCount[ob] || 0) + 1;
    }

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var sn = it.sourceName;
        var g;
        var lookup = matchedLookup(sn);
        if (lookup) {
            g = ensure('lookup:' + lookup.prefix, 'repeaterLookup',
                { grupo: lookup.grupo || lookup.prefix, catalogo: lookup.catalogo || '', seccion: lookup.seccion || '' });
        } else if (hasIndex(sn)) {
            g = ensure('rep:' + stripIndex(sn), 'repeater', { grupo: stripIndex(sn) });
        } else {
            var ob2 = stripOption(sn);
            var isRadio = ob2 !== sn && (optBaseCount[ob2] || 0) >= 2;
            g = isRadio ? ensure('radio:' + ob2, 'radio', { grupo: ob2 }) : ensure('simple:' + sn, 'simple', { grupo: sn });
        }
        g.members.push(it);
        if (g.order == null) { g.order = it.idx; g.page = it.page; }
    }

    var rows = groups.map(function (g) {
        return {
            seccion: g.seccion || sectionFor(g.grupo),
            tipoCampo: g.tipoCampo,
            grupo: g.grupo,
            catalogo: g.catalogo,
            entity: isEntity(g.grupo),
            members: g.members.slice(), // {sourceName, tipo, page, idx}
            count: g.members.length,
            page: g.page,
            order: g.order,
        };
    });
    rows.sort(function (a, b) { return a.order - b.order; });
    return rows;
}

// ─── Merge business rules from the Ficha ──────────────────────────────────────

function buildFichaIndex(fichaBytes) {
    var parsed = matrixParser.parseMatrixAuto(fichaBytes);
    var bySource = {};
    var byEtiqueta = {};
    for (var i = 0; i < parsed.rows.length; i++) {
        var r = parsed.rows[i];
        var sn = r.sourceName || r.acroActual || r.acroPropuesto;
        if (sn && bySource[sn] === undefined) bySource[sn] = r;
        var e = norm(r.etiqueta);
        if (e && byEtiqueta[e] === undefined) byEtiqueta[e] = r;
    }
    return { bySource: bySource, byEtiqueta: byEtiqueta, rows: parsed.rows };
}

function fichaBusiness(fr) {
    if (!fr) {
        return { nombreFormulario: '', salidaJSON: '', obligatorio: '', regla: '', visibilidad: '', valorOpciones: '', observaciones: '', seccionJson: '' };
    }
    return {
        nombreFormulario: fr.etiqueta || '',
        salidaJSON: fr.pathPrincipal || '',
        obligatorio: fr.obligatorio === true ? 'Sí' : (fr.obligatorio === false ? 'No' : ''),
        regla: fr.reglaOriginal || '',
        visibilidad: fr.visibilidadCondicional || '',
        valorOpciones: fr.valor || '',
        observaciones: fr.observaciones || '',
        seccionJson: fr.seccionJson || '',
    };
}

function mergeBusiness(rows, fichaIdx, stats) {
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var fr = null;
        // 1) por sourceName (root + miembros)
        var cands = [row.grupo].concat(row.members.map(function (m) { return m.sourceName; }));
        for (var c = 0; c < cands.length && !fr; c++) {
            if (fichaIdx.bySource[cands[c]]) fr = fichaIdx.bySource[cands[c]];
        }
        if (fr) { stats.mergedBySource++; }
        row.business = fichaBusiness(fr);
        row._matched = !!fr;
    }
    return rows;
}

// ─── Build the 2-sheet workbook ───────────────────────────────────────────────

var CAMPOS_HEADERS = [
    '#', 'Sección', 'tipoCampo', 'grupo', 'catálogo', 'sourceNames', '#campos', 'Página',
    'Nombre en formulario', 'salidaJSON', 'Obligatorio', 'Regla', 'Visibilidad condicional',
    'Valor/opciones', 'Observaciones', 'Sección JSON',
];

var OPCIONES_HEADERS = [
    'grupo', 'tipoCampo', 'sourceName', 'opción', 'jsonValue', 'pdfValue', 'item', 'needle',
];

function buildOptionRows(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.tipoCampo === 'simple') continue;
        for (var m = 0; m < r.members.length; m++) {
            var sn = r.members[m].sourceName;
            var opcion = '', jsonValue = '', pdfValue = '', item = '', needle = '';
            if (r.tipoCampo === 'radio') {
                opcion = optionSuffix(sn) || '';
                jsonValue = opcion; pdfValue = opcion;
            } else if (r.tipoCampo === 'repeater') {
                var idx = indexOf(sn);
                item = idx != null ? idx : '';
            } else if (r.tipoCampo === 'repeaterLookup') {
                opcion = optionSuffix(sn) || '';
                var lk = matchedLookup(sn);
                var base = stripOption(sn);
                if (lk) base = base.slice(lk.prefix.length);
                needle = humanize(base);
                pdfValue = opcion ? 'X' : '';
            }
            out.push([r.grupo, r.tipoCampo, sn, opcion, jsonValue, pdfValue, item, needle]);
        }
    }
    return out;
}

function buildWorkbook(rows) {
    var camposAoa = [CAMPOS_HEADERS];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var b = r.business || fichaBusiness(null);
        camposAoa.push([
            i + 1, r.seccion, r.tipoCampo, r.grupo, r.catalogo,
            r.members.map(function (m) { return m.sourceName; }).join(', '),
            r.count, r.page != null ? r.page : '',
            b.nombreFormulario, b.salidaJSON, b.obligatorio, b.regla, b.visibilidad,
            b.valorOpciones, b.observaciones, b.seccionJson,
        ]);
    }
    var wsCampos = XLSX.utils.aoa_to_sheet(camposAoa);
    wsCampos['!cols'] = [
        { wch: 5 }, { wch: 22 }, { wch: 15 }, { wch: 26 }, { wch: 20 }, { wch: 44 }, { wch: 8 }, { wch: 7 },
        { wch: 26 }, { wch: 30 }, { wch: 11 }, { wch: 26 }, { wch: 24 }, { wch: 24 }, { wch: 26 }, { wch: 20 },
    ];

    var opcionesAoa = [OPCIONES_HEADERS].concat(buildOptionRows(rows));
    var wsOpciones = XLSX.utils.aoa_to_sheet(opcionesAoa);
    wsOpciones['!cols'] = [
        { wch: 26 }, { wch: 15 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 30 },
    ];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsCampos, 'Campos');
    XLSX.utils.book_append_sheet(wb, wsOpciones, 'Opciones');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {Buffer|Uint8Array} mappingBytes
 * @param {Buffer|Uint8Array} [fichaBytes] - Ficha de negocio (opcional)
 * @returns {{ rows, stats, xlsxBytes }}
 */
function buildCanonicalMatrix(mappingBytes, fichaBytes) {
    var items = readMappingItems(mappingBytes);
    var rows = collapse(items);

    var stats = { totalFields: items.length, totalRows: rows.length, byType: {}, mergedBySource: 0, fichaRows: 0 };

    if (fichaBytes) {
        var fichaIdx = buildFichaIndex(fichaBytes);
        stats.fichaRows = fichaIdx.rows.length;
        mergeBusiness(rows, fichaIdx, stats);
    } else {
        for (var i = 0; i < rows.length; i++) rows[i].business = fichaBusiness(null);
    }

    for (var k = 0; k < rows.length; k++) {
        stats.byType[rows[k].tipoCampo] = (stats.byType[rows[k].tipoCampo] || 0) + 1;
    }

    return { rows: rows, stats: stats, xlsxBytes: buildWorkbook(rows) };
}

module.exports = { buildCanonicalMatrix, collapse, readMappingItems, buildFichaIndex };
