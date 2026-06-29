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

// Header patterns for the descriptive "Vida Colectiva / Secciones" matrix layout
// (the same flexible format that combine_form.py handles).
var FLEX_HEADER_PATTERNS = [
    ['pasos', /pasos/i],
    ['seccion', /^secci[oó]n$/i],
    ['nombrePdf', /nombre\s+en\s+pdf/i],
    ['etiqueta', /nombre\s+del\s+campo\s+en\s+formulario/i],
    ['tipoDato', /tipo\s+de\s+dato/i],
    ['valor', /^valor$/i],
    ['regla', /^regla$/i],
    ['obligatorio', /obligatori/i],
    ['formularioVisualizar', /formulario\s+a\s+visual/i],
    ['visualizacion', /visualizaci[oó]n/i],
    ['observaciones', /observacion/i],
    ['pathJson', /nombre.*campo.*json|nombre.*json/i],
    ['nombreCampoPdf', /nombre.*campo.*pdf$/i],
];

/**
 * Detect whether an Excel uses the descriptive flexible layout (vs the 22-col one).
 * Returns the detected column map (prop -> index), or null if it doesn't look flexible.
 */
function detectFlexHeaders(headerRow) {
    var col = {};
    for (var c = 0; c < headerRow.length; c++) {
        var h = String(headerRow[c] || '').trim();
        if (!h) continue;
        for (var p = 0; p < FLEX_HEADER_PATTERNS.length; p++) {
            var prop = FLEX_HEADER_PATTERNS[p][0];
            var rx = FLEX_HEADER_PATTERNS[p][1];
            if (col[prop] === undefined && rx.test(h)) { col[prop] = c; break; }
        }
    }
    return col;
}

/**
 * Parse the descriptive flexible matrix layout into the canonical row shape used
 * downstream (enrichField / buildField / organizeSections).
 */
function parseFlexibleMatrix(excelBytes) {
    var wb = XLSX.read(excelBytes, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) throw new Error('El Excel de mapeo está vacío');

    var col = detectFlexHeaders(raw[0]);
    var get = function (r, prop) { return col[prop] !== undefined ? r[col[prop]] : ''; };

    var rows = [];
    for (var i = 1; i < raw.length; i++) {
        var r = raw[i];
        var etiqueta = String(get(r, 'etiqueta') || '').trim();
        var nombrePdf = String(get(r, 'nombrePdf') || '').trim();
        if (!etiqueta && !nombrePdf) continue;

        var pathRaw = String(get(r, 'pathJson') || '').trim();
        var paths = pathRaw.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        var acro = String(get(r, 'nombreCampoPdf') || '').trim();

        rows.push({
            rowNum: i,
            pasos: String(get(r, 'pasos') || '').trim(),
            seccionPdf: String(get(r, 'seccion') || '').trim(),
            nombrePdf: nombrePdf,
            etiqueta: etiqueta,
            acroActual: acro,
            acroPropuesto: '',
            sourceName: acro,
            nativeType: '',
            grupo: '',
            pagina: null,
            tipoDato: String(get(r, 'tipoDato') || '').trim().toLowerCase(),
            valor: String(get(r, 'valor') || '').trim(),
            pathPrincipal: paths[0] || '',
            pathsSecundarios: paths.slice(1).join('|'),
            preRellenado: null,
            obligatorio: normalizeYesNo(get(r, 'obligatorio')),
            maxLength: null,
            patron: '',
            formato: '',
            visibilidadCondicional: String(get(r, 'visualizacion') || '').trim(),
            catalogoNombre: '',
            optionsParsed: null,
            optionsRaw: '',
            tipoDato2: '',
            reglaOriginal: String(get(r, 'regla') || '').trim(),
            hojaExcelCatalogo: '',
        });
    }
    return { rows: rows, warnings: [], colMap: col };
}

/**
 * Parse a matrix auto-detecting the layout: flexible descriptive vs 22-column.
 */
function parseMatrixAuto(excelBytes) {
    var wb = XLSX.read(excelBytes, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) throw new Error('El Excel de mapeo está vacío');
    var flex = detectFlexHeaders(raw[0]);
    // Need at least the descriptive label column to treat it as flexible.
    if (flex.etiqueta !== undefined && flex.seccion !== undefined) {
        return parseFlexibleMatrix(excelBytes);
    }
    return parseMatrix(excelBytes);
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

module.exports = { parseMatrix, parseCustomMatrix, parseFlexibleMatrix, parseMatrixAuto, EXPECTED_HEADERS };
