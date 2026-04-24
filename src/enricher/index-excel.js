'use strict';

const XLSX = require('xlsx');

function parseEnrichExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = findMatrixSheet(workbook);
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rawRows.length < 2) throw new Error(`Sheet "${sheetName}" is empty`);

    const { headerRow, columnMap } = findHeaderAndColumns(rawRows);

    const rows = [];
    for (let i = headerRow + 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || r.every(c => c === '' || c == null)) continue;

        const row = {
            step:          clean(cell(r, columnMap.step)),
            section:       clean(cell(r, columnMap.section)),
            pdfLabel:      clean(cell(r, columnMap.pdfLabel)),
            fieldLabel:    clean(cell(r, columnMap.fieldLabel)),
            dataType:      clean(cell(r, columnMap.dataType)),
            value:         clean(cell(r, columnMap.value)),
            rule:          clean(cell(r, columnMap.rule)),
            required:      clean(cell(r, columnMap.required)),
            productScope:  clean(cell(r, columnMap.productScope)),
            visualization: clean(cell(r, columnMap.visualization)),
            obs:           clean(cell(r, columnMap.obs)),
            jsonName:      clean(cell(r, columnMap.jsonName)),
            pdfFieldName:  clean(cell(r, columnMap.pdfFieldName)),
            _rowIndex:     i + 1,
            _consumed:     false,
        };

        if (!row.fieldLabel && !row.value && !row.pdfLabel) continue;
        rows.push(row);
    }

    return rows;
}

function buildCascadeIndex(rows) {
    const byPdfFieldName = new Map();
    const byPdfLabel = new Map();
    const byFormLabel = new Map();
    const byJsonLeaf = new Map();

    for (const row of rows) {
        if (row.pdfFieldName) {
            setIfAbsent(byPdfFieldName, normalize(row.pdfFieldName), row);
        }
        if (row.pdfLabel) {
            setIfAbsent(byPdfLabel, normalize(row.pdfLabel), row);
        }
        if (row.fieldLabel) {
            setIfAbsent(byFormLabel, normalize(row.fieldLabel), row);
        }
        if (row.jsonName) {
            const leaf = extractJsonLeaf(row.jsonName);
            if (leaf) setIfAbsent(byJsonLeaf, leaf, row);
        }
    }

    return { byPdfFieldName, byPdfLabel, byFormLabel, byJsonLeaf, rows };
}

function matchField(field, index) {
    const sourceName = field.sourceMeta?.sourceName || '';
    const fieldLabel = field.label || '';

    const repeatMatch = sourceName.match(/_(\d+)$/) || sourceName.match(/_Row_(\d+)$/i);
    const rowIndex = repeatMatch ? parseInt(repeatMatch[1], 10) : null;
    const baseName = sourceName.replace(/_(\d+)$/, '').replace(/_Row_(\d+)$/i, '');
    const cleanLabel = fieldLabel.replace(/_Row_\d+$/i, '').replace(/:_?$/, '').replace(/_/g, ' ').trim();

    const attempts = [
        { key: normalize(sourceName), idx: 'byPdfFieldName', confidence: 100, source: 'pdf-field-name' },
        { key: normalize(baseName),   idx: 'byPdfFieldName', confidence: 95,  source: 'pdf-field-name-base' },
        { key: normalize(cleanLabel), idx: 'byPdfLabel',     confidence: 90,  source: 'pdf-label' },
        { key: normalize(cleanLabel), idx: 'byFormLabel',    confidence: 85,  source: 'form-label' },
        { key: normalize(snakeToHuman(baseName)), idx: 'byFormLabel', confidence: 80, source: 'snake-to-form' },
        { key: normalize(snakeToHuman(baseName)), idx: 'byPdfLabel',  confidence: 75, source: 'snake-to-pdf' },
        { key: normalize(snakeToHuman(baseName)), idx: 'byJsonLeaf',  confidence: 70, source: 'json-leaf' },
    ];

    for (const a of attempts) {
        if (!a.key) continue;
        const row = index[a.idx].get(a.key);
        if (row) return { row, rowIndex, confidence: a.confidence, source: a.source };
    }

    const fuzzy = findFuzzyMatch(cleanLabel, baseName, index);
    if (fuzzy) return { ...fuzzy, rowIndex };

    return null;
}

function findFuzzyMatch(cleanLabel, baseName, index) {
    const candidates = [
        normalize(cleanLabel),
        normalize(snakeToHuman(baseName)),
    ].filter(Boolean);

    let best = null;
    let bestScore = 0;
    const threshold = 0.80;

    const allMaps = [index.byPdfLabel, index.byFormLabel, index.byJsonLeaf];

    for (const candidate of candidates) {
        if (!candidate || candidate.length < 3) continue;
        for (const m of allMaps) {
            for (const [key, row] of m) {
                if (!key || key.length < 3) continue;
                const score = similarity(candidate, key);
                if (score > threshold && score > bestScore) {
                    bestScore = score;
                    best = { row, confidence: Math.round(score * 65), source: 'fuzzy' };
                }
            }
        }
    }

    return best;
}

function collectComboOptions(matchedRow, index) {
    const label = matchedRow.fieldLabel;
    if (!label) return [];

    const seen = new Set();
    const options = [];
    for (const row of index.rows) {
        if (row.fieldLabel === label && row.value) {
            const m = row.value.match(/^([A-Z0-9]{1,6})\s*[-|,]\s*(.+)$/);
            const code = m ? m[1].trim() : row.value;
            const optLabel = m ? m[2].trim() : row.value;
            const dedup = `${code}|${optLabel}`.toLowerCase();
            if (seen.has(dedup)) continue;
            seen.add(dedup);
            options.push({ code, label: optLabel });
            row._consumed = true;
        }
    }
    return options;
}

function normalize(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function snakeToHuman(s) {
    return String(s || '').replace(/_/g, ' ');
}

function extractJsonLeaf(path) {
    if (!path) return null;
    const leaf = String(path).split(',')[0].trim().split('.').pop();
    return normalize(leaf.replace(/([A-Z])/g, ' $1'));
}

function similarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const dist = levenshtein(a, b);
    return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
    }
    return dp[m][n];
}

function setIfAbsent(map, key, val) {
    if (key && !map.has(key)) map.set(key, val);
}

function clean(v) {
    return v === null || v === undefined ? '' : String(v).trim();
}

function cell(row, idx) {
    return idx === undefined || idx === null ? '' : (row[idx] !== undefined ? row[idx] : '');
}

const COLUMN_MATCHERS = {
    step:          ['pasos formulario', 'paso', 'pasos'],
    section:       ['sección', 'seccion'],
    pdfLabel:      ['nombre en pdf'],
    fieldLabel:    ['nombre del campo en formulario', 'campo en formulario'],
    dataType:      ['tipo de dato', 'tipo dato'],
    value:         ['valor'],
    rule:          ['regla'],
    required:      ['obligatorio'],
    productScope:  ['formulario a visualizar'],
    visualization: ['visualización en formularios', 'visualizacion en formularios'],
    obs:           ['observaciones'],
    jsonName:      ['nombre del campo en json', 'campo en json'],
    pdfFieldName:  ['nombre del campo en pdf', 'campo en pdf'],
};

function findHeaderAndColumns(rawRows) {
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
        const row = rawRows[i];
        if (!row) continue;
        const tempMap = {};
        let matchCount = 0;
        for (let j = 0; j < row.length; j++) {
            const c = clean(String(row[j] || '')).toLowerCase();
            if (!c) continue;
            for (const [key, matchers] of Object.entries(COLUMN_MATCHERS)) {
                if (tempMap[key] !== undefined) continue;
                if (matchers.some(m => c.includes(m))) {
                    tempMap[key] = j;
                    matchCount++;
                    break;
                }
            }
        }
        if (matchCount >= 4 && tempMap.fieldLabel !== undefined) {
            return { headerRow: i, columnMap: tempMap };
        }
    }
    return { headerRow: 0, columnMap: {} };
}

function findMatrixSheet(workbook) {
    const names = workbook.SheetNames;
    const preferred = names.find(n =>
        /formulario\s*digital/i.test(n) || /formulario/i.test(n)
    );
    if (preferred) return preferred;
    let biggest = names[0], maxRows = 0;
    for (const n of names) {
        const range = XLSX.utils.decode_range(workbook.Sheets[n]['!ref'] || 'A1');
        const rows = range.e.r - range.s.r + 1;
        if (rows > maxRows) { maxRows = rows; biggest = n; }
    }
    return biggest;
}

module.exports = { parseEnrichExcel, buildCascadeIndex, matchField, collectComboOptions, normalize };
