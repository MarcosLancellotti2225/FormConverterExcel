/**
 * @file index.js
 * @version 1.2.0
 * @description Entry point for PDF Converter v2. Orchestrates Excel reading,
 *              PDF renaming, JSON enrichment, and zip packaging.
 * @changelog
 *   - v1.0.0: Stub
 *   - v1.2.0: Full orchestration — convertPdf() returns zip blob
 */
'use strict';

const JSZip = require('jszip');
const { readMappingExcel, buildRenameMapping } = require('./lib/excel-reader');
const { renamePdf } = require('./lib/pdf-renamer');
const { buildEnrichedJson } = require('./lib/json-enricher');

const FORMULARIO_CODES = {
    '1009052': { name: 'Vida_Colectiva', tag: 'VCA' },
    'D0306':   { name: 'Vida_Universal', tag: 'VUA' },
    'D0309':   { name: 'Proteccion_Crediticia', tag: 'PCA' },
};

async function convertPdf(pdfBytes, excelBytes, options) {
    const opts = options || {};
    const allWarnings = [];

    const { rows: excelRows, warnings: excelWarnings } = readMappingExcel(excelBytes);
    allWarnings.push(...excelWarnings);

    if (!excelRows.length) {
        throw new Error('El Excel de mapeo no tiene filas de datos');
    }

    const renameMapping = buildRenameMapping(excelRows);
    const {
        pdfBytes: renamedPdfBytes,
        warnings: renameWarnings,
        renamedCount,
        renamedFields,
        summary: renameSummary,
    } = await renamePdf(pdfBytes, renameMapping);
    allWarnings.push(...renameWarnings);

    const {
        json: enrichedJson,
        warnings: jsonWarnings,
        stats: jsonStats,
    } = buildEnrichedJson(excelRows);
    allWarnings.push(...jsonWarnings);

    const code = opts.formularioCode || detectFormularioCode(excelRows);
    const formInfo = FORMULARIO_CODES[code] || { name: code || 'Formulario', tag: '' };
    const baseName = code ? code + '_' + formInfo.name : 'Formulario';

    const zip = new JSZip();
    zip.file(baseName + '_renamed.pdf', renamedPdfBytes);
    zip.file('form-definition-' + (code || 'formulario') + '_enriched.json',
        JSON.stringify(enrichedJson, null, 2));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipFilename = baseName + '.zip';

    return {
        zipBlob,
        zipFilename,
        renamedPdfBytes,
        enrichedJson,
        renamedFields: renamedFields || [],
        warnings: allWarnings,
        stats: {
            excelRows: excelRows.length,
            renamedCount,
            renameSummary,
            json: jsonStats,
        },
    };
}

function detectFormularioCode(rows) {
    for (const row of rows) {
        const actual = row.acroFormActual || '';
        if (/Text3\.\d+\.\d+/.test(actual) || /Check\s*Box4/.test(actual)) {
            return '1009052';
        }
    }
    return null;
}

module.exports = { convertPdf, FORMULARIO_CODES };
