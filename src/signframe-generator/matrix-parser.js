'use strict';

const XLSX = require('xlsx');

const EXPECTED_HEADERS = [
    '#', 'Sección del PDF', 'AcroForm Actual', 'AcroForm Propuesto',
    'Etiqueta para el público', 'Nombre interno (sourceName)', 'Tipo', 'Grupo',
    'Página', 'Path JSON principal', 'Paths secundarios', 'Pre-rellenado',
    'Obligatorio', 'MaxLength', 'Patrón regex', 'Formato',
    'Visibilidad condicional', 'Catálogo (nombre)',
    'Opciones formato Lovable (JSON)', 'Tipo de dato (matriz)',
    'Regla original', 'Hoja del Excel catálogo',
];

function parseMatrix(excelBytes) {
    const wb = XLSX.read(excelBytes, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) throw new Error('El Excel de mapeo está vacío');

    var headerRow = raw[0];
    var warnings = validateHeaders(headerRow);

    var rows = [];
    for (var i = 1; i < raw.length; i++) {
        var r = raw[i];
        var acroActual = String(r[2] || '').trim();
        if (!acroActual) continue;

        var optionsRaw = String(r[18] || '').trim();
        var optionsParsed = null;
        if (optionsRaw) {
            try { optionsParsed = JSON.parse(optionsRaw); } catch (e) {
                warnings.push({ type: 'invalid_options_json', row: i + 1, field: acroActual,
                    reason: 'No se pudo parsear JSON de opciones: ' + e.message });
            }
        }

        rows.push({
            rowNum: i,
            seccionPdf: String(r[1] || '').trim(),
            acroActual: acroActual,
            acroPropuesto: String(r[3] || '').trim(),
            etiqueta: String(r[4] || '').trim(),
            sourceName: String(r[5] || '').trim(),
            nativeType: String(r[6] || '').trim(),
            grupo: String(r[7] || '').trim(),
            pagina: r[8] != null && r[8] !== '' ? Number(r[8]) : null,
            pathPrincipal: String(r[9] || '').trim(),
            pathsSecundarios: String(r[10] || '').trim(),
            preRellenado: normalizeYesNo(r[11]),
            obligatorio: normalizeYesNo(r[12]),
            maxLength: r[13] != null && r[13] !== '' ? Number(r[13]) || null : null,
            patron: String(r[14] || '').trim(),
            formato: String(r[15] || '').trim().toLowerCase(),
            visibilidadCondicional: String(r[16] || '').trim(),
            catalogoNombre: String(r[17] || '').trim(),
            optionsParsed: optionsParsed,
            optionsRaw: optionsRaw,
            tipoDato: String(r[19] || '').trim().toLowerCase(),
            reglaOriginal: String(r[20] || '').trim(),
            hojaExcelCatalogo: String(r[21] || '').trim(),
        });
    }

    return { rows, warnings };
}

function parseCustomMatrix(excelBytes, colActual, colPropuesto, colEtiqueta, colSeccion, colTipo, colGrupo, colPath) {
    var wb = XLSX.read(excelBytes, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (raw.length < 2) throw new Error('El Excel está vacío');

    var rows = [];
    for (var i = 1; i < raw.length; i++) {
        var r = raw[i];
        var acroActual = String(r[colActual] || '').trim();
        if (!acroActual) continue;
        rows.push({
            rowNum: i,
            seccionPdf: colSeccion != null ? String(r[colSeccion] || '').trim() : '',
            acroActual: acroActual,
            acroPropuesto: colPropuesto != null ? String(r[colPropuesto] || '').trim() : '',
            etiqueta: colEtiqueta != null ? String(r[colEtiqueta] || '').trim() : '',
            sourceName: '',
            nativeType: colTipo != null ? String(r[colTipo] || '').trim() : '',
            grupo: colGrupo != null ? String(r[colGrupo] || '').trim() : '',
            pagina: null,
            pathPrincipal: colPath != null ? String(r[colPath] || '').trim() : '',
            pathsSecundarios: '',
            preRellenado: null,
            obligatorio: null,
            maxLength: null,
            patron: '',
            formato: '',
            visibilidadCondicional: '',
            catalogoNombre: '',
            optionsParsed: null,
            optionsRaw: '',
            tipoDato: '',
            reglaOriginal: '',
            hojaExcelCatalogo: '',
        });
    }
    return { rows, warnings: [] };
}

function validateHeaders(headerRow) {
    var warnings = [];
    if (!headerRow || headerRow.length < 20) {
        warnings.push({ type: 'missing_columns',
            reason: 'Se esperaban 22 columnas, se encontraron ' + (headerRow ? headerRow.length : 0) });
        return warnings;
    }
    for (var i = 0; i < EXPECTED_HEADERS.length; i++) {
        var expected = EXPECTED_HEADERS[i];
        var actual = String(headerRow[i] || '').trim();
        if (actual.toLowerCase() !== expected.toLowerCase()) {
            warnings.push({ type: 'header_mismatch', column: i + 1, expected: expected, actual: actual });
        }
    }
    return warnings;
}

function normalizeYesNo(val) {
    var s = String(val || '').trim().toLowerCase();
    if (s === 'sí' || s === 'si' || s === 'yes' || s === 's' || s === 'x') return true;
    if (s === 'no' || s === 'n' || s === '') return false;
    return null;
}

module.exports = { parseMatrix, parseCustomMatrix, EXPECTED_HEADERS };
