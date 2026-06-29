'use strict';

/**
 * Generador de Matriz Canónica.
 *
 * Input:  xlsx de mapeo del PDF renombrado (columna de sourceNames en orden de
 *         lectura + tipo + página).
 * Output: matriz canónica (xlsx) — los 387 campos colapsados a ~191 filas
 *         lógicas, una por unidad de negocio (campo simple, radio, repeater,
 *         repeaterLookup), con columnas de negocio vacías para que las complete
 *         el humano. Esta matriz es el input del Generador de JSON.
 *
 * La lógica es canónica: clasifica por prefijo/sufijo del sourceName. NADA
 * específico del formulario se hardcodea — todo sale de canonical-config.js.
 */

var XLSX = require('xlsx');
var config = require('./canonical-config');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function stripIndex(sn) {
    return sn.replace(/\[\d+\]$/, '');
}

function hasIndex(sn) {
    return /\[\d+\]$/.test(sn);
}

// Returns the matched option suffix (e.g. "Si", "No", "NoAplica") or null.
function optionSuffix(sn) {
    var sfx = config.optionSuffixes || [];
    for (var i = 0; i < sfx.length; i++) {
        var s = sfx[i];
        var re = new RegExp('_?' + s + '$');
        if (re.test(sn) && sn.replace(re, '').length > 0) return s;
    }
    return null;
}

function stripOption(sn) {
    var sfx = config.optionSuffixes || [];
    for (var i = 0; i < sfx.length; i++) {
        var re = new RegExp('_?' + sfx[i] + '$');
        if (re.test(sn)) {
            var base = sn.replace(re, '');
            if (base.length > 0) return base;
        }
    }
    return sn;
}

function matchedLookup(sn) {
    var lps = config.lookupPrefixes || [];
    var best = null;
    for (var i = 0; i < lps.length; i++) {
        if (sn.indexOf(lps[i].prefix) === 0) {
            if (!best || lps[i].prefix.length > best.prefix.length) best = lps[i];
        }
    }
    return best;
}

function sectionFor(root) {
    var map = config.sectionByPrefix || {};
    var bestKey = null;
    for (var key in map) {
        if (!map.hasOwnProperty(key)) continue;
        if (root.indexOf(key) === 0 && (!bestKey || key.length > bestKey.length)) bestKey = key;
    }
    return bestKey ? map[bestKey] : (config.defaultSection || 'General');
}

function isEntity(root) {
    var eps = config.entityPrefixes || [];
    var best = '';
    for (var i = 0; i < eps.length; i++) {
        if (root.indexOf(eps[i]) === 0 && eps[i].length > best.length) best = eps[i];
    }
    return best || null;
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

// ─── Collapse to canonical rows ───────────────────────────────────────────────

/**
 * @param {Array} items - [{sourceName, tipo, page, idx}] en orden de lectura
 * @returns {Array} rows - filas canónicas en orden de aparición
 */
function collapse(items) {
    var groups = [];
    var byKey = {};

    function ensure(key, tipoCampo, extra) {
        if (byKey[key]) return byKey[key];
        var g = {
            key: key,
            tipoCampo: tipoCampo,
            grupo: extra && extra.grupo != null ? extra.grupo : key,
            catalogo: extra && extra.catalogo ? extra.catalogo : '',
            seccion: extra && extra.seccion ? extra.seccion : '',
            members: [],
            page: null,
            order: null,
        };
        byKey[key] = g;
        groups.push(g);
        return g;
    }

    // First pass: tentative option-base sibling counts (to confirm real radios)
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
            // todas las del prefijo -> UNA fila
            g = ensure('lookup:' + lookup.prefix, 'repeaterLookup', {
                grupo: lookup.grupo || lookup.prefix,
                catalogo: lookup.catalogo || '',
                seccion: lookup.seccion || '',
            });
        } else if (hasIndex(sn)) {
            var rootR = stripIndex(sn);
            g = ensure('rep:' + rootR, 'repeater', { grupo: rootR });
        } else {
            var ob2 = stripOption(sn);
            var isRadio = ob2 !== sn && (optBaseCount[ob2] || 0) >= 2;
            if (isRadio) {
                g = ensure('radio:' + ob2, 'radio', { grupo: ob2 });
            } else {
                g = ensure('simple:' + sn, 'simple', { grupo: sn });
            }
        }

        g.members.push(sn);
        if (g.order == null) {
            g.order = it.idx;
            g.page = it.page;
        }
    }

    // Derive section + entity flag, build final rows
    var rows = groups.map(function (g) {
        var seccion = g.seccion || sectionFor(g.grupo);
        var entity = isEntity(g.grupo);
        return {
            seccion: seccion,
            tipoCampo: g.tipoCampo,
            grupo: g.grupo,
            catalogo: g.catalogo,
            entity: entity || '',
            sourceNames: g.members.slice(),
            count: g.members.length,
            page: g.page,
            order: g.order,
        };
    });

    rows.sort(function (a, b) { return a.order - b.order; });
    return rows;
}

// ─── Write the canonical xlsx ─────────────────────────────────────────────────

var OUTPUT_HEADERS = [
    '#', 'Sección', 'tipoCampo', 'grupo', 'catálogo', 'sourceNames', '#campos', 'Página',
    // columnas de negocio (las completa el humano):
    'Nombre en formulario', 'salidaJSON', 'Obligatorio', 'Visibilidad', 'Observaciones',
];

function buildXlsx(rows) {
    var aoa = [OUTPUT_HEADERS];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        aoa.push([
            i + 1,
            r.seccion,
            r.tipoCampo,
            r.grupo,
            r.catalogo,
            r.sourceNames.join(', '),
            r.count,
            r.page != null ? r.page : '',
            '', '', '', '', '',
        ]);
    }
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 5 }, { wch: 24 }, { wch: 15 }, { wch: 28 }, { wch: 22 },
        { wch: 50 }, { wch: 8 }, { wch: 8 },
        { wch: 28 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 28 },
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Matriz Canónica');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {Buffer|Uint8Array} mappingBytes
 * @returns {{ rows, stats, xlsxBytes }}
 */
function buildCanonicalMatrix(mappingBytes) {
    var items = readMappingItems(mappingBytes);
    var rows = collapse(items);

    var stats = { totalFields: items.length, totalRows: rows.length, byType: {} };
    for (var i = 0; i < rows.length; i++) {
        stats.byType[rows[i].tipoCampo] = (stats.byType[rows[i].tipoCampo] || 0) + 1;
    }

    return { rows: rows, stats: stats, xlsxBytes: buildXlsx(rows) };
}

module.exports = { buildCanonicalMatrix, collapse, readMappingItems };
