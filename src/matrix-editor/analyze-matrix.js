'use strict';

const { parseAmbiguous } = require('./parse-ambiguous');
const { deriveFromJsonPath } = require('./derive-pdf-name');
const { mapFormulario } = require('./normalize-values');

const COLUMNS = [
    'Pasos Formulario',
    'Sección',
    'Nombre en PDF',
    'Nombre del campo en formulario',
    'Tipo de dato',
    'Valor',
    'Regla',
    'Obligatorio',
    'Formulario a visualizar',
    'Visualización en Formularios',
    'Observaciones',
    'Nombre del Campo en Json',
    'Nombre del Campo en PDF',
];

function analyzeRow(row, idx) {
    const issues = [];

    const nombrePDF = row['Nombre en PDF'] || '';
    const ambiguityRegex = /Vida\s+(Colectiva|Universal)/i;
    if (ambiguityRegex.test(nombrePDF) && nombrePDF.includes('/')) {
        issues.push({ type: 'ambiguous_pdf_name', detail: parseAmbiguous(nombrePDF) });
    }

    const pdfFieldName = row['Nombre del Campo en PDF'];
    const jsonPath = row['Nombre del Campo en Json'];
    if ((!pdfFieldName || !pdfFieldName.trim()) && jsonPath && jsonPath.trim()) {
        issues.push({ type: 'missing_pdf_field', suggested: deriveFromJsonPath(jsonPath) });
    }

    const oblig = String(row['Obligatorio'] || '').trim();
    if (oblig === 'NO' || oblig === 'no') {
        issues.push({ type: 'obligatorio_case', original: oblig, suggested: 'No' });
    }

    const formVis = String(row['Formulario a visualizar'] || '').trim();
    if (formVis) {
        issues.push({ type: 'derive_formulario', suggested: mapFormulario(formVis) });
    }

    return { row: { ...row }, idx, issues };
}

module.exports = { analyzeRow, COLUMNS };
