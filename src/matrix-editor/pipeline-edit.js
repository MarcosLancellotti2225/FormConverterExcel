'use strict';

const XLSX = require('xlsx');
const { analyzeRow, COLUMNS } = require('./analyze-matrix');
const { parseAmbiguous } = require('./parse-ambiguous');
const { deriveFromJsonPath } = require('./derive-pdf-name');
const { normalizeObligatorio, mapFormulario } = require('./normalize-values');
const { exportToXlsx } = require('./export-matrix');
const { crossWithPdf, crossWithMultiplePdfs, applyMatchToRow } = require('./cross-with-pdf');
const { detectOrphans, computeCrossStats } = require('./detect-orphans');
const { extractFields } = require('../pdf-converter/extract-fields');
const { extractText } = require('../pdf-converter/extract-text');
const { detectLabels } = require('../pdf-converter/label-detector');

async function extractPdfFields(pdfBytes) {
    const { fields } = await extractFields(pdfBytes);
    const textItems = await extractText(pdfBytes);
    const labeled = detectLabels(fields, textItems);
    return labeled;
}

async function crossMatrixWithPdfs(rows, pdfEntries) {
    const pdfFieldSets = [];
    const allFields = [];

    for (const { name, bytes } of pdfEntries) {
        const fields = await extractPdfFields(bytes);
        pdfFieldSets.push({ pdfName: name, fields });
        for (const f of fields) {
            allFields.push({ ...f, _pdfSource: name });
        }
    }

    const matchResults = pdfEntries.length === 1
        ? crossWithPdf(rows, pdfFieldSets[0].fields)
        : crossWithMultiplePdfs(rows, pdfFieldSets);

    for (let i = 0; i < rows.length; i++) {
        const mr = matchResults[i];
        if (mr.match && mr.match.field && mr.match.confidence >= 75) {
            applyMatchToRow(rows[i], mr.match);
            if (mr.pdfName) rows[i]['_pdfSource'] = mr.pdfName;
        } else {
            rows[i]['PDF AcroForm Name'] = '';
            rows[i]['PDF Tipo Nativo'] = '';
            rows[i]['PDF Página'] = '';
            rows[i]['PDF Rect'] = '';
            rows[i]['_matchConfidence'] = mr.match ? mr.match.confidence : 0;
            rows[i]['_matchSource'] = mr.match ? mr.match.source : '';
        }
    }

    const crossStats = computeCrossStats(rows, allFields, matchResults);
    const { orphanRows, orphanFields } = detectOrphans(rows, allFields, matchResults);

    return { matchResults, crossStats, orphanRows, orphanFields, acroFields: allFields, pdfFieldSets };
}

function loadMatrix(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = findMatrixSheet(workbook);
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const { headerRow, columnMap } = findHeaderRow(rawRows);
    const headers = rawRows[headerRow];

    const rows = [];
    for (let i = headerRow + 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || r.every(c => c === '' || c == null)) continue;

        const row = {};
        for (const [colName, colIdx] of Object.entries(columnMap)) {
            row[colName] = clean(r[colIdx]);
        }
        rows.push(row);
    }

    return rows;
}

function analyzeMatrix(rows) {
    const analyzed = rows.map((row, i) => analyzeRow(row, i));

    const stats = {
        total: rows.length,
        ambiguous: 0,
        missingPdfField: 0,
        obligatorioToFix: 0,
    };

    for (const a of analyzed) {
        for (const issue of a.issues) {
            if (issue.type === 'ambiguous_pdf_name') stats.ambiguous++;
            if (issue.type === 'missing_pdf_field') stats.missingPdfField++;
            if (issue.type === 'obligatorio_case') stats.obligatorioToFix++;
        }
    }

    return { analyzed, stats };
}

function applySplitAll(rows) {
    const result = [];
    for (const row of rows) {
        const nombrePDF = row['Nombre en PDF'] || '';
        const ambiguityRegex = /Vida\s+(Colectiva|Universal)/i;

        if (ambiguityRegex.test(nombrePDF) && nombrePDF.includes('/')) {
            const parts = parseAmbiguous(nombrePDF);
            if (parts.length > 1) {
                for (const part of parts) {
                    const newRow = { ...row };
                    newRow['Nombre en PDF'] = part.nombrePDF;
                    newRow['Formulario'] = part.formularios.join(', ') || row['Formulario'] || '';
                    result.push(newRow);
                }
                continue;
            }
        }
        result.push({ ...row });
    }
    return result;
}

function applyDerivePdfNames(rows) {
    let count = 0;
    for (const row of rows) {
        if ((!row['Nombre del Campo en PDF'] || !row['Nombre del Campo en PDF'].trim()) &&
            row['Nombre del Campo en Json'] && row['Nombre del Campo en Json'].trim()) {
            const derived = deriveFromJsonPath(row['Nombre del Campo en Json']);
            if (derived) {
                row['Nombre del Campo en PDF'] = derived;
                count++;
            }
        }
    }
    return count;
}

function applyNormalizeObligatorio(rows) {
    let count = 0;
    for (const row of rows) {
        const orig = row['Obligatorio'] || '';
        const normalized = normalizeObligatorio(orig);
        if (normalized !== orig) {
            row['Obligatorio'] = normalized;
            count++;
        }
    }
    return count;
}

function applyDeriveFormulario(rows) {
    for (const row of rows) {
        if (!row['Formulario']) {
            const formVis = row['Formulario a visualizar'] || '';
            row['Formulario'] = mapFormulario(formVis);
        }
    }
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

const COLUMN_MATCHERS = {
    'Pasos Formulario':               ['pasos formulario', 'paso'],
    'Sección':                         ['sección', 'seccion'],
    'Nombre en PDF':                   ['nombre en pdf'],
    'Nombre del campo en formulario':  ['nombre del campo en formulario', 'campo en formulario'],
    'Tipo de dato':                    ['tipo de dato', 'tipo dato'],
    'Valor':                           ['valor'],
    'Regla':                           ['regla'],
    'Obligatorio':                     ['obligatorio'],
    'Formulario a visualizar':         ['formulario a visualizar'],
    'Visualización en Formularios':    ['visualización en formularios', 'visualizacion en formularios'],
    'Observaciones':                   ['observaciones'],
    'Nombre del Campo en Json':        ['nombre del campo en json', 'campo en json'],
    'Nombre del Campo en PDF':         ['nombre del campo en pdf', 'campo en pdf'],
};

function findHeaderRow(rawRows) {
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
        const row = rawRows[i];
        if (!row) continue;
        const tempMap = {};
        let matchCount = 0;
        for (let j = 0; j < row.length; j++) {
            const c = clean(String(row[j] || '')).toLowerCase();
            if (!c) continue;
            for (const [colName, matchers] of Object.entries(COLUMN_MATCHERS)) {
                if (tempMap[colName] !== undefined) continue;
                if (matchers.some(m => c.includes(m))) {
                    tempMap[colName] = j;
                    matchCount++;
                    break;
                }
            }
        }
        if (matchCount >= 4) {
            return { headerRow: i, columnMap: tempMap };
        }
    }
    return { headerRow: 0, columnMap: {} };
}

function clean(v) {
    return v === null || v === undefined ? '' : String(v).trim();
}

module.exports = {
    loadMatrix,
    analyzeMatrix,
    applySplitAll,
    applyDerivePdfNames,
    applyNormalizeObligatorio,
    applyDeriveFormulario,
    exportToXlsx,
    crossMatrixWithPdfs,
    extractPdfFields,
    COLUMNS,
};
