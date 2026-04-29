/**
 * @file excel-reader.js
 * @version 1.0.1
 * @description Parses the 22-column mapping Excel and returns a structured array.
 * @changelog
 *   - v1.0.1: Initial implementation
 */
'use strict';

const XLSX = require('xlsx');

const EXPECTED_HEADERS = [
    '#',
    'Sección del PDF',
    'AcroForm Actual',
    'AcroForm Propuesto',
    'Etiqueta para el público',
    'Nombre interno (sourceName)',
    'Tipo',
    'Grupo',
    'Página',
    'Path JSON principal',
    'Paths secundarios',
    'Pre-rellenado',
    'Obligatorio',
    'MaxLength',
    'Patrón regex',
    'Formato',
    'Visibilidad condicional',
    'Catálogo (nombre)',
    'Opciones formato Lovable (JSON)',
    'Tipo de dato (matriz)',
    'Regla original',
    'Hoja del Excel catálogo',
];

function readMappingExcel(excelBytes) {
    const wb = XLSX.read(excelBytes, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (!raw.length) {
        throw new Error('El Excel de mapeo está vacío');
    }

    const headerRow = raw[0];
    const warnings = validateHeaders(headerRow);

    const rows = [];
    for (let i = 1; i < raw.length; i++) {
        const r = raw[i];
        if (!r || !r[2]) continue;

        const optionsRaw = String(r[18] || '').trim();
        let optionsParsed = null;
        if (optionsRaw) {
            try {
                optionsParsed = JSON.parse(optionsRaw);
            } catch {
                warnings.push({
                    type: 'invalid_options_json',
                    row: i + 1,
                    field: r[2],
                    reason: 'No se pudo parsear JSON de opciones',
                });
            }
        }

        rows.push({
            rowNum: r[0] || i,
            seccionPdf: String(r[1] || '').trim(),
            acroFormActual: String(r[2] || '').trim(),
            acroFormPropuesto: String(r[3] || '').trim(),
            etiqueta: String(r[4] || '').trim(),
            sourceName: String(r[5] || '').trim(),
            tipo: String(r[6] || '').trim(),
            grupo: String(r[7] || '').trim(),
            pagina: r[8] != null ? Number(r[8]) : null,
            pathPrincipal: String(r[9] || '').trim(),
            pathsSecundarios: String(r[10] || '').trim(),
            preRellenado: normalizeYesNo(r[11]),
            obligatorio: normalizeYesNo(r[12]),
            maxLength: r[13] != null ? Number(r[13]) || null : null,
            patron: String(r[14] || '').trim(),
            formato: String(r[15] || '').trim(),
            visibilidadCondicional: String(r[16] || '').trim(),
            catalogoNombre: String(r[17] || '').trim(),
            opcionesLovable: optionsParsed,
            opcionesRaw: optionsRaw,
            tipoDatoMatriz: String(r[19] || '').trim(),
            reglaOriginal: String(r[20] || '').trim(),
            hojaExcelCatalogo: String(r[21] || '').trim(),
        });
    }

    return { rows, warnings, sheetName };
}

function validateHeaders(headerRow) {
    const warnings = [];
    if (!headerRow || headerRow.length < 20) {
        warnings.push({
            type: 'missing_columns',
            reason: `Se esperaban 22 columnas, se encontraron ${headerRow ? headerRow.length : 0}`,
        });
        return warnings;
    }

    for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
        const expected = EXPECTED_HEADERS[i];
        const actual = String(headerRow[i] || '').trim();
        if (actual !== expected && actual.toLowerCase() !== expected.toLowerCase()) {
            warnings.push({
                type: 'header_mismatch',
                column: i + 1,
                expected,
                actual,
            });
        }
    }

    return warnings;
}

function normalizeYesNo(val) {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'sí' || s === 'si' || s === 'yes' || s === 's') return true;
    if (s === 'no' || s === 'n') return false;
    return null;
}

function buildRenameMapping(rows) {
    const mapping = [];
    for (const row of rows) {
        if (!row.acroFormActual || !row.acroFormPropuesto) continue;
        if (row.acroFormActual === row.acroFormPropuesto) continue;
        mapping.push({
            oldName: row.acroFormActual,
            newName: row.acroFormPropuesto,
        });
    }
    return mapping;
}

module.exports = {
    readMappingExcel,
    buildRenameMapping,
    EXPECTED_HEADERS,
    _internal: { validateHeaders, normalizeYesNo },
};
