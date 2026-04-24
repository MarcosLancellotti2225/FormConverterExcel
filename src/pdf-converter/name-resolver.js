'use strict';

const XLSX = require('xlsx');

const AMBIGUOUS_LABELS = new Set([
    'dia', 'mes', 'ano', 'otro', 'si', 'no', 'desde', 'hasta',
]);

const MERGE_Y_TOLERANCE = 3;
const MERGE_X_GAP = 12;

function resolveNames(labeledFields, excelBuffer, referenceJson, textItems) {
    const excelRows = parseExcelMatrix(excelBuffer);
    const excelIndex = buildExcelIndex(excelRows);
    const refIndex = referenceJson ? buildRefIndex(referenceJson) : null;
    const mergedByPage = buildMergedTextByPage(textItems || []);

    const warnings = [];
    const matches = [];
    const usedNames = new Set();

    for (const field of labeledFields) {
        const result = resolveOne(field, excelIndex, refIndex, warnings);
        let finalName = result.newName;

        const baseName = finalName.replace(/_\d+$/, '');
        if (AMBIGUOUS_LABELS.has(baseName)) {
            const ctx = detectContextPrefix(field, mergedByPage);
            const prefix = buildContextPrefix(ctx);
            if (prefix) {
                finalName = prefix + '_' + finalName;
            }
        }

        if (usedNames.has(finalName) && finalName !== field.name) {
            warnings.push({
                type: 'collision-unresolved',
                field: field.name,
                reason: `"${finalName}" already used — keeping original name for manual resolution`,
            });
            finalName = sanitizeName(field.name.replace(/\./g, '_'));
        }

        usedNames.add(finalName);

        matches.push({
            originalName: field.name,
            detectedLabel: field.detectedLabel || '',
            newName: finalName,
            source: result.source,
            confidence: result.confidence,
            page: field.page,
            type: field.type,
            rect: field.rect,
        });
    }

    return { matches, warnings };
}

function resolveOne(field, excelIndex, refIndex, warnings) {
    const label = field.detectedLabel;

    if (label) {
        const exactMatch = findExcelMatch(label, excelIndex, 'exact');
        if (exactMatch) {
            const newName = deriveNameFromExcelRow(exactMatch, field);
            if (newName) return { newName, source: 'excel-exact', confidence: 95 };
        }

        const fuzzyMatch = findExcelMatch(label, excelIndex, 'fuzzy');
        if (fuzzyMatch) {
            const newName = deriveNameFromExcelRow(fuzzyMatch, field);
            if (newName) return { newName, source: 'excel-fuzzy', confidence: 75 };
        }
    }

    if (refIndex) {
        const refMatch = findRefMatch(field, refIndex);
        if (refMatch) {
            return { newName: refMatch, source: 'reference-json', confidence: 85 };
        }
    }

    if (label) {
        const derived = toSnakeCase(label);
        if (derived && derived !== field.name) {
            return { newName: derived, source: 'derived', confidence: 50 };
        }
    }

    return { newName: field.name, source: 'unchanged', confidence: 0 };
}

function isPlaceholder(s) {
    const n = (s || '').toLowerCase().trim();
    return !n || n === 'no se llena en pdf' || n === 'no aplica' || n === 'n/a' || n === '-';
}

function deriveNameFromExcelRow(row, field) {
    if (row.pdfFieldName && !isPlaceholder(row.pdfFieldName)) {
        let name = row.pdfFieldName;
        const rowNum = extractRowNumber(field.name);
        if (rowNum && !/_\d+_/.test(name) && !/\d$/.test(name)) {
            name = applyRowNumber(name, rowNum);
        }
        return sanitizeName(name);
    }

    if (row.jsonName) {
        const leaf = row.jsonName.split(',')[0].trim().split('.').pop();
        if (leaf) {
            let snake = camelToSnake(leaf);
            const rowNum = extractRowNumber(field.name);
            if (rowNum) {
                snake = applyRowNumber(snake, rowNum);
            }
            return sanitizeName(snake);
        }
    }

    if (field.detectedLabel) {
        return sanitizeName(toSnakeCase(field.detectedLabel));
    }

    return null;
}

// --- Context prefix detection for ambiguous names ---

function buildMergedTextByPage(textItems) {
    const byPage = new Map();
    for (const item of textItems) {
        if (!byPage.has(item.page)) byPage.set(item.page, []);
        byPage.get(item.page).push(item);
    }
    const mergedByPage = new Map();
    for (const [page, items] of byPage) {
        mergedByPage.set(page, mergeAdjacentText(items));
    }
    return mergedByPage;
}

function mergeAdjacentText(items) {
    const sorted = [...items].sort((a, b) => {
        if (Math.abs(a.y - b.y) > MERGE_Y_TOLERANCE) return b.y - a.y;
        return a.x - b.x;
    });
    const merged = [];
    let cur = null;
    for (const item of sorted) {
        if (cur &&
            Math.abs(item.y - cur.y) <= MERGE_Y_TOLERANCE &&
            (item.x - (cur.x + cur.width)) <= MERGE_X_GAP &&
            (item.x - (cur.x + cur.width)) >= -2) {
            cur.str = (cur.str + ' ' + item.str).trim();
            cur.width = (item.x + item.width) - cur.x;
            cur.height = Math.max(cur.height, item.height);
        } else {
            if (cur) merged.push(cur);
            cur = { ...item };
        }
    }
    if (cur) merged.push(cur);
    return merged;
}

function detectContextPrefix(field, mergedByPage) {
    const pageTexts = mergedByPage.get(field.page) || [];
    const fy = field.rect.y;
    const fh = field.rect.height;
    const fx = field.rect.x;
    const fieldTop = fy + fh;

    let nearestHeading = null;
    let headingDist = Infinity;

    for (const t of pageTexts) {
        const distAbove = t.y - fieldTop;
        if (distAbove <= 0 || distAbove > 200) continue;
        if (!isHeadingText(t.str)) continue;
        if (distAbove < headingDist) {
            headingDist = distAbove;
            nearestHeading = t.str.trim();
        }
    }

    let nearestSubLabel = null;
    let subLabelDist = Infinity;

    for (const t of pageTexts) {
        const yDiff = Math.abs(t.y - fy);
        if (yDiff > 30) continue;
        const textRight = t.x + t.width;
        if (textRight > fx) continue;
        const dist = fx - textRight;
        if (dist > 300) continue;
        const str = t.str.trim().toLowerCase().replace(/:$/, '');
        if (/^(desde|hasta)$/.test(str)) {
            if (dist < subLabelDist) {
                subLabelDist = dist;
                nearestSubLabel = str;
            }
        }
    }

    return { heading: nearestHeading, subLabel: nearestSubLabel };
}

function isHeadingText(str) {
    const text = str.trim();
    if (text.length < 5) return false;
    const letters = text.replace(/[^A-ZÁÉÍÓÚÑÜ]/gi, '');
    if (letters.length < 5) return false;
    return letters === letters.toUpperCase() && letters.length > text.length * 0.5;
}

function buildContextPrefix(ctx) {
    if (!ctx.heading && !ctx.subLabel) return null;

    const parts = [];
    if (ctx.heading) {
        const h = ctx.heading.toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (h.includes('vigencia')) parts.push('vigencia');
        else if (h.includes('nacimiento')) parts.push('fecha_nacimiento');
        else if (h.includes('fecha')) parts.push('fecha');
        else if (h.includes('beneficiario')) parts.push('beneficiario');
    }
    if (ctx.subLabel) {
        parts.push(ctx.subLabel);
    }

    if (parts.length === 0) return null;
    return sanitizeName(parts.join('_'));
}

// --- Excel parsing ---

function parseExcelMatrix(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = findMatrixSheet(workbook);
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const { headerRow, columnMap } = findColumns(rawRows);
    const rows = [];

    for (let i = headerRow + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.every(c => c === '' || c == null)) continue;

        const pdfLabel = cleanStr(getCell(row, columnMap.pdfLabel));
        const pdfFieldName = cleanStr(getCell(row, columnMap.pdfFieldName));
        const jsonName = cleanStr(getCell(row, columnMap.jsonName));
        const fieldLabel = cleanStr(getCell(row, columnMap.fieldLabel));

        if (!pdfLabel && !pdfFieldName && !fieldLabel) continue;

        rows.push({ pdfLabel, pdfFieldName, jsonName, fieldLabel });
    }

    return rows;
}

function findMatrixSheet(workbook) {
    const names = workbook.SheetNames;
    const preferred = names.find(n =>
        /formulario\s*digital/i.test(n) || /formulario/i.test(n)
    );
    if (preferred) return preferred;

    let biggest = names[0];
    let maxRows = 0;
    for (const n of names) {
        const range = XLSX.utils.decode_range(workbook.Sheets[n]['!ref'] || 'A1');
        const rows = range.e.r - range.s.r + 1;
        if (rows > maxRows) { maxRows = rows; biggest = n; }
    }
    return biggest;
}

const COLUMN_MATCHERS = {
    pdfLabel:     ['nombre en pdf'],
    fieldLabel:   ['nombre del campo en formulario', 'campo en formulario'],
    pdfFieldName: ['nombre del campo en pdf', 'campo en pdf'],
    jsonName:     ['nombre del campo en json', 'campo en json'],
};

function findColumns(rawRows) {
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
        const row = rawRows[i];
        if (!row) continue;
        const tempMap = {};
        let matchCount = 0;

        for (let j = 0; j < row.length; j++) {
            const cell = cleanStr(String(row[j] || '')).toLowerCase();
            if (!cell) continue;

            for (const [key, matchers] of Object.entries(COLUMN_MATCHERS)) {
                if (tempMap[key] !== undefined) continue;
                if (matchers.some(m => cell.includes(m))) {
                    tempMap[key] = j;
                    matchCount++;
                    break;
                }
            }
        }

        if (matchCount >= 2) {
            return { headerRow: i, columnMap: tempMap };
        }
    }

    return { headerRow: 0, columnMap: {} };
}

function buildExcelIndex(rows) {
    const byNorm = new Map();

    for (const row of rows) {
        if (row.pdfLabel) {
            byNorm.set(normalize(row.pdfLabel), row);
        }
        if (row.fieldLabel && row.fieldLabel !== row.pdfLabel) {
            byNorm.set(normalize(row.fieldLabel), row);
        }
    }

    return { rows, byNorm };
}

function findExcelMatch(label, index, mode) {
    const normLabel = normalize(label);

    if (mode === 'exact') {
        return index.byNorm.get(normLabel) || null;
    }

    let bestRow = null;
    let bestScore = 0;
    const threshold = 0.75;

    for (const [normKey, row] of index.byNorm) {
        const score = similarity(normLabel, normKey);
        if (score > threshold && score > bestScore) {
            bestScore = score;
            bestRow = row;
        }
    }

    return bestRow;
}

// --- Reference JSON index ---

function buildRefIndex(json) {
    const positions = [];
    const fp = json?._sourcePdf?.fieldPositions
             || json?.data?.jsonDefinition?._sourcePdf?.fieldPositions
             || json?.jsonDefinition?._sourcePdf?.fieldPositions
             || [];

    for (const entry of fp) {
        if (entry.sourceName && entry.hasCoordinates) {
            positions.push({
                sourceName: entry.sourceName,
                x: entry.xInt || Math.round(entry.xPx || 0),
                y: entry.yInt || Math.round(entry.yPx || 0),
                page: entry.page - 1,
            });
        }
    }

    const sections = json?.sections
                  || json?.data?.jsonDefinition?.sections
                  || json?.jsonDefinition?.sections
                  || [];
    for (const sec of sections) {
        for (const f of (sec.fields || [])) {
            if (f.sourceMeta?.sourceName && f.sourceMeta?.rect) {
                const r = f.sourceMeta.rect;
                positions.push({
                    sourceName: f.sourceMeta.sourceName,
                    x: Math.round(r.x || 0),
                    y: Math.round(r.y || 0),
                    page: (f.sourceMeta.page || 1) - 1,
                });
            }
        }
    }

    return positions;
}

function findRefMatch(field, refPositions) {
    const fx = Math.round(field.rect.x);
    const fy = Math.round(field.rect.y);
    const tolerance = 8;

    for (const ref of refPositions) {
        if (ref.page !== field.page) continue;
        if (Math.abs(ref.x - fx) <= tolerance && Math.abs(ref.y - fy) <= tolerance) {
            return ref.sourceName;
        }
    }
    return null;
}

// --- Utilities ---

function extractRowNumber(name) {
    const m = name.match(/Row\s*(\d+)/i) || name.match(/\.(\d+)\.\d+$/);
    return m ? parseInt(m[1], 10) : null;
}

function applyRowNumber(name, num) {
    if (/beneficiario\d/i.test(name)) return name;
    if (/beneficiario/i.test(name)) {
        return name.replace(/beneficiario/i, `beneficiario${num}`);
    }
    return name + '_' + num;
}

function toSnakeCase(str) {
    return normalize(str)
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function camelToSnake(str) {
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function sanitizeName(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 80) || 'unnamed';
}

function normalize(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function similarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const len = Math.max(a.length, b.length);
    const dist = levenshtein(a, b);
    return 1 - dist / len;
}

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            );
        }
    }

    return dp[m][n];
}

function getCell(row, idx) {
    if (idx === undefined || idx === null) return '';
    return row[idx] !== undefined ? row[idx] : '';
}

function cleanStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

module.exports = { resolveNames };
