'use strict';

/**
 * Export by Formulario
 *
 * Generates an Excel (or zip of Excels) for the matrix-editor "Descargar
 * por Formulario" action. The output is a 20-column normalized mapping
 * sheet — 1 row per PDF AcroForm — produced by build-pdf-rows.
 *
 * Inputs:
 *   - matrixRows  : the cleaned client matrix
 *   - pdfEntries  : [{ name, bytes }]
 *   - catalogos   : optional, parsed catalog map
 *
 * Output:
 *   - 1 PDF  → { xlsxBlob, filename, summary }
 *   - 2-3 PDFs → { zipBlob, filename: 'Mapeos_por_Formulario.zip', summary }
 *   - 0 PDFs → throws 'Cargá al menos un PDF'
 */

const XLSX = require('xlsx');
const JSZip = require('jszip');
const { buildPdfRows, HEADERS, COL_WIDTHS } = require('./build-pdf-rows');

const FORMULARIOS = [
    { code: '1009052', name: 'Vida Colectiva',         filenameTag: 'Vida_Colectiva' },
    { code: 'D0306',   name: 'Vida Universal Plus',    filenameTag: 'Vida_Universal_Plus' },
    { code: 'D0309',   name: 'Protección Crediticia',  filenameTag: 'Proteccion_Crediticia' },
];

function identifyPdfCode(pdfFileName) {
    const name = String(pdfFileName || '').toLowerCase();
    for (const form of FORMULARIOS) {
        if (name.includes(form.code.toLowerCase())) return form.code;
    }
    return null;
}

function filenameFor(code, fallbackName) {
    const form = FORMULARIOS.find(f => f.code === code);
    if (form) return 'Mapeo_' + form.code + '_' + form.filenameTag + '.xlsx';
    const safe = String(fallbackName || 'desconocido')
        .replace(/\.pdf$/i, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_');
    return 'Mapeo_' + safe + '.xlsx';
}

function buildWorkbook(rows, code, catalogos) {
    const wb = XLSX.utils.book_new();

    const sheetData = [HEADERS, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }));
    ws['!freeze'] = { xSplit: 2, ySplit: 1 };
    ws['!views'] = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }];

    XLSX.utils.book_append_sheet(wb, ws, 'Mapeo de campos');

    if (catalogos && Object.keys(catalogos).length > 0) {
        const catData = [['Catálogo', 'Código', 'Label']];
        for (const [catName, options] of Object.entries(catalogos)) {
            for (const opt of options) {
                catData.push([catName, opt.code, opt.label]);
            }
        }
        const wsCat = XLSX.utils.aoa_to_sheet(catData);
        wsCat['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 40 }];
        XLSX.utils.book_append_sheet(wb, wsCat, 'Catálogos de opciones');
    }

    return wb;
}

async function exportPerFormularioZip(matrixRows, pdfEntries, catalogos) {
    if (!pdfEntries || pdfEntries.length === 0) {
        throw new Error('Cargá al menos un PDF');
    }

    const builds = [];
    for (const entry of pdfEntries) {
        const code = identifyPdfCode(entry.name);
        const { rows, summary } = await buildPdfRows(entry.bytes, matrixRows, code, catalogos);
        const wb = buildWorkbook(rows, code, catalogos);
        const filename = filenameFor(code, entry.name);
        const wbBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

        builds.push({
            code: code || entry.name,
            name: (FORMULARIOS.find(f => f.code === code) || {}).name || entry.name,
            filename,
            wbBytes,
            rowCount: rows.length,
            summary,
        });
    }

    if (builds.length === 1) {
        const b = builds[0];
        const xlsxBlob = new Blob([b.wbBytes], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        return {
            xlsxBlob,
            filename: b.filename,
            summary: [{ code: b.code, name: b.name, rowCount: b.rowCount, filename: b.filename }],
        };
    }

    const zip = new JSZip();
    for (const b of builds) {
        zip.file(b.filename, b.wbBytes);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    return {
        zipBlob,
        filename: 'Mapeos_por_Formulario.zip',
        summary: builds.map(b => ({ code: b.code, name: b.name, rowCount: b.rowCount, filename: b.filename })),
    };
}

module.exports = {
    exportPerFormularioZip,
    buildWorkbook,
    identifyPdfCode,
    filenameFor,
    FORMULARIOS,
};
