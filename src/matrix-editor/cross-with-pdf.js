'use strict';

function crossWithPdf(excelRows, acroFields) {
    const matchedFieldNames = new Set();
    const results = [];

    for (let i = 0; i < excelRows.length; i++) {
        const row = excelRows[i];
        const match = matchExcelRowToAcroForm(row, acroFields, matchedFieldNames);
        if (match && match.field && match.confidence >= 75) {
            matchedFieldNames.add(match.field.name);
        }
        results.push({
            rowIndex: i,
            match,
        });
    }

    return results;
}

function matchExcelRowToAcroForm(row, acroFields, alreadyMatched) {
    const targetName = (row['Nombre del Campo en PDF'] || '').trim();
    if (targetName) {
        const exact = acroFields.find(f => f.name === targetName && !alreadyMatched.has(f.name));
        if (exact) return { field: exact, confidence: 100, source: 'exact-pdf-name' };
    }

    const targetLabel = normalize(row['Nombre en PDF']);
    if (targetLabel) {
        const labelMatches = acroFields.filter(f =>
            normalize(f.detectedLabel) === targetLabel && !alreadyMatched.has(f.name)
        );
        if (labelMatches.length === 1) {
            return { field: labelMatches[0], confidence: 90, source: 'pdf-label' };
        }
        if (labelMatches.length > 1) {
            return { candidates: labelMatches, confidence: 50, source: 'ambiguous-label' };
        }
    }

    const formLabel = normalize(row['Nombre del campo en formulario']);
    if (formLabel) {
        const matches = acroFields.filter(f => {
            if (alreadyMatched.has(f.name)) return false;
            const fl = normalize(f.detectedLabel);
            if (!fl) return false;
            return fl.includes(formLabel) || formLabel.includes(fl);
        });
        if (matches.length === 1) {
            return { field: matches[0], confidence: 75, source: 'form-label' };
        }
        if (matches.length > 1) {
            return { candidates: matches, confidence: 50, source: 'ambiguous-form-label' };
        }
    }

    const searchLabel = formLabel || targetLabel;
    if (searchLabel) {
        const fuzzyMatches = acroFields
            .filter(f => !alreadyMatched.has(f.name))
            .map(f => ({ field: f, score: similarity(searchLabel, normalize(f.detectedLabel)) }))
            .filter(m => m.score >= 0.65)
            .sort((a, b) => b.score - a.score);
        if (fuzzyMatches.length > 0) {
            return {
                field: fuzzyMatches[0].field,
                confidence: Math.round(fuzzyMatches[0].score * 100),
                source: 'fuzzy',
            };
        }
    }

    return null;
}

function applyMatchToRow(row, match) {
    if (!match || !match.field) return row;
    const f = match.field;
    const rectStr = f.rect
        ? f.rect.x + ',' + f.rect.y + ',' + (f.rect.width || f.rect.w || 0) + ',' + (f.rect.height || f.rect.h || 0)
        : '';
    const nativeType = mapNativeType(f.type || f.typeName || '');

    row['Nombre del Campo en PDF'] = f.name;
    row['PDF AcroForm Name'] = f.name;
    row['PDF Tipo Nativo'] = nativeType;
    row['PDF Página'] = f.page != null ? f.page + 1 : '';
    row['PDF Rect'] = rectStr;
    row['_matchConfidence'] = match.confidence;
    row['_matchSource'] = match.source;
    return row;
}

function mapNativeType(t) {
    if (!t) return '';
    const low = String(t).toLowerCase();
    if (low === 'text' || /text/i.test(low)) return 'Tx';
    if (low === 'checkbox' || /check/i.test(low)) return 'Ch';
    if (low === 'radio' || /radio/i.test(low)) return 'Btn';
    if (low === 'button' || /button/i.test(low)) return 'Btn';
    if (low === 'select' || /drop|option/i.test(low)) return 'Ch';
    return low.substring(0, 3);
}

function normalize(s) {
    if (!s) return '';
    return String(s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    return (longer.length - editDistance(longer, shorter)) / longer.length;
}

function editDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

module.exports = { crossWithPdf, matchExcelRowToAcroForm, applyMatchToRow, normalize };
