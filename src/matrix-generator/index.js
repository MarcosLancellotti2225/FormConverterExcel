'use strict';

const XLSX = require('xlsx');
const { detectFields } = require('../pdf-detect/index');

const TWENTY_TWO_HEADERS = [
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

function parseClientMatrix(excelBytes) {
    const wb = XLSX.read(excelBytes, { type: 'array' });
    const sheetName = wb.SheetNames.find(n => /formulario/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rawRows.length < 2) throw new Error('La matriz del cliente está vacía');

    const headers = rawRows[0];
    const colMap = {};
    for (let j = 0; j < headers.length; j++) {
        const h = String(headers[j] || '').toLowerCase().trim();
        if (h.includes('pasos formulario') || h === 'pasos formulario') colMap.pasos = j;
        if (h.includes('sección') || h === 'seccion') colMap.seccion = j;
        if (h === 'nombre en pdf' || h.includes('nombre en pdf')) colMap.nombrePdf = j;
        if (h.includes('nombre del campo en formulario')) colMap.campoFormulario = j;
        if (h.includes('tipo de dato')) colMap.tipoDato = j;
        if (h === 'valor') colMap.valor = j;
        if (h === 'regla') colMap.regla = j;
        if (h === 'obligatorio') colMap.obligatorio = j;
        if (h.includes('formulario a visualizar')) colMap.formulario = j;
        if (h.includes('visualización') || h.includes('visualizacion')) colMap.visualizacion = j;
        if (h.includes('observaciones')) colMap.observaciones = j;
        if (h.includes('nombre del campo en json')) colMap.campoJson = j;
        if (h.includes('nombre del campo en pdf')) colMap.campoPdf = j;
    }

    const rows = [];
    for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        const nombrePdf = clean(r[colMap.nombrePdf]);
        const isJsonOnly = !nombrePdf || nombrePdf === 'no se llena en pdf';

        rows.push({
            rowIdx: i,
            pasos: clean(r[colMap.pasos]),
            seccion: clean(r[colMap.seccion]),
            nombrePdf: clean(r[colMap.nombrePdf]),
            campoFormulario: clean(r[colMap.campoFormulario]),
            tipoDato: clean(r[colMap.tipoDato]),
            valor: clean(r[colMap.valor]),
            regla: clean(r[colMap.regla]),
            obligatorio: clean(r[colMap.obligatorio]),
            formulario: clean(r[colMap.formulario]),
            visualizacion: clean(r[colMap.visualizacion]),
            observaciones: clean(r[colMap.observaciones]),
            campoJson: clean(r[colMap.campoJson]),
            campoPdf: clean(r[colMap.campoPdf]),
            isJsonOnly,
        });
    }

    return { rows, sheetName };
}

function detectFormularioKey(pdfName) {
    const name = pdfName.toLowerCase();
    if (/vida\s*colectiva/i.test(name)) return 'vida colectiva';
    if (/protecci.n\s*credit/i.test(name) || /creditic/i.test(name)) return 'protección crediticia';
    if (/vida\s*universal/i.test(name)) return 'vida universal';
    return null;
}

function filterRowsForPdf(allRows, pdfName) {
    const formularioKey = detectFormularioKey(pdfName);

    return allRows.filter(row => {
        if (row.isJsonOnly) return false;

        const form = row.formulario.toLowerCase();
        if (formularioKey && form && form !== 'todos' && !form.includes(formularioKey)) return false;

        const resolved = resolveNombrePdfForFormulario(row.nombrePdf, pdfName);
        if (!resolved || /no se llena/i.test(resolved)) return false;

        return true;
    });
}

function resolveNombrePdfForFormulario(nombrePdf, pdfName) {
    if (!nombrePdf || !nombrePdf.includes('/')) return nombrePdf;

    const name = pdfName.toLowerCase();
    const parts = nombrePdf.split('/');

    for (const part of parts) {
        const trimmed = part.trim();
        if (/vida\s*colectiva/i.test(name) && /vida\s*colectiva/i.test(trimmed)) {
            return trimmed.replace(/^.*?:\s*/, '').trim();
        }
        if (/protecci.n\s*credit/i.test(name) && /protecci.n\s*credit/i.test(trimmed)) {
            return trimmed.replace(/^.*?:\s*/, '').trim();
        }
        if (/vida\s*universal/i.test(name) && /vida\s*universal/i.test(trimmed)) {
            return trimmed.replace(/^.*?:\s*/, '').trim();
        }
    }

    return nombrePdf;
}

function deriveAcroName(row) {
    const json = row.campoJson;
    if (!json) {
        const campo = row.campoFormulario || row.nombrePdf || '';
        return toSnake(campo);
    }

    const firstPath = json.split('\n')[0].trim();
    const segments = firstPath.split('.');

    if (segments.length >= 3) {
        const last2 = segments.slice(-2);
        return toSnake(last2.join('_'));
    }
    if (segments.length >= 2) {
        return toSnake(segments[segments.length - 1]);
    }
    return toSnake(firstPath);
}

function toSnake(str) {
    if (!str) return '';
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase()
        .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
        .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ñ/g, 'n');
}

function mapTipoToAcro(tipoDato) {
    const t = (tipoDato || '').toLowerCase();
    if (/text|alfa/i.test(t)) return 'Tx';
    if (/numer/i.test(t)) return 'Tx';
    if (/fecha/i.test(t)) return 'Tx';
    if (/combo|select|lista/i.test(t)) return 'Ch';
    if (/radio/i.test(t)) return 'Btn';
    if (/check/i.test(t)) return 'Btn';
    if (/boton|button/i.test(t)) return 'Btn';
    return 'Tx';
}

function extractMaxLength(regla) {
    if (!regla) return '';
    const m = regla.match(/(\d+)\s*car[aá]cteres/i) || regla.match(/(\d+)\s*d[ií]gitos/i);
    return m ? m[1] : '';
}

function extractFormato(tipoDato, regla) {
    const t = (tipoDato || '').toLowerCase();
    if (/numer/i.test(t)) return 'numérico';
    if (/alfa/i.test(t)) return 'alfanumérico';
    if (/fecha/i.test(t)) return 'fecha';
    if (/texto/i.test(t)) return 'texto';
    if (/correo/i.test(t)) return 'email';
    return t || '';
}

function splitJsonPaths(campoJson) {
    if (!campoJson) return { primary: '', secondary: '' };
    const lines = campoJson.split('\n').map(l => l.trim()).filter(Boolean);
    return {
        primary: lines[0] || '',
        secondary: lines.slice(1).join('; ') || '',
    };
}

async function generateMatrices(clientExcelBytes, pdfEntries) {
    const { rows: allRows } = parseClientMatrix(clientExcelBytes);
    const results = [];

    for (const entry of pdfEntries) {
        const pdfName = entry.name;
        const fields = await detectFields(entry.bytes);
        const sorted = fields.fields;
        const matrixRows = filterRowsForPdf(allRows, pdfName);

        const outputRows = [];
        const usedFieldIndices = new Set();

        for (let i = 0; i < matrixRows.length; i++) {
            const mRow = matrixRows[i];
            const resolvedNombre = resolveNombrePdfForFormulario(mRow.nombrePdf, pdfName);

            if (resolvedNombre && /no se llena/i.test(resolvedNombre)) continue;

            const acroActual = i < sorted.length ? sorted[i].name : '';
            const acroPage = i < sorted.length ? sorted[i].page : '';
            const acroType = i < sorted.length ? sorted[i].type : '';
            if (i < sorted.length) usedFieldIndices.add(i);

            const suggested = deriveAcroName(mRow);
            const { primary, secondary } = splitJsonPaths(mRow.campoJson);

            outputRows.push([
                i + 1,
                mRow.seccion || mRow.pasos,
                acroActual,
                suggested,
                mRow.campoFormulario,
                suggested,
                acroType || mapTipoToAcro(mRow.tipoDato),
                '',
                acroPage,
                primary,
                secondary,
                '',
                mRow.obligatorio,
                extractMaxLength(mRow.regla),
                '',
                extractFormato(mRow.tipoDato, mRow.regla),
                '',
                '',
                '',
                mRow.tipoDato,
                mRow.regla,
                '',
            ]);
        }

        for (let j = 0; j < sorted.length; j++) {
            if (usedFieldIndices.has(j)) continue;
            const f = sorted[j];
            outputRows.push([
                outputRows.length + 1,
                '(sin match en matriz)',
                f.name,
                '',
                '',
                '',
                f.type,
                '',
                f.page,
                '', '', '', '', '', '', '', '', '', '', '', '', '',
            ]);
        }

        const wb = XLSX.utils.book_new();
        const data = [TWENTY_TWO_HEADERS, ...outputRows];
        const ws = XLSX.utils.aoa_to_sheet(data);

        ws['!cols'] = [
            { wch: 4 }, { wch: 25 }, { wch: 22 }, { wch: 30 },
            { wch: 30 }, { wch: 30 }, { wch: 6 }, { wch: 15 },
            { wch: 6 }, { wch: 45 }, { wch: 30 }, { wch: 12 },
            { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 12 },
            { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 15 },
            { wch: 30 }, { wch: 15 },
        ];

        const code = pdfName.replace(/\.pdf$/i, '');
        XLSX.utils.book_append_sheet(wb, ws, 'Mapeo ' + code.substring(0, 25));
        const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

        results.push({
            code,
            fileName: code + '_22col.xlsx',
            buffer: new Uint8Array(buf),
            stats: {
                matrixRows: matrixRows.length,
                pdfFields: sorted.length,
                matched: Math.min(matrixRows.length, sorted.length),
                unmatched: Math.max(0, sorted.length - matrixRows.length),
            },
        });
    }

    return results;
}

function clean(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

module.exports = { generateMatrices };
