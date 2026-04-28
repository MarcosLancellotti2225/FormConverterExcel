'use strict';

/**
 * Process Formulario
 *
 * Top-level orchestrator for the unified "Procesar Formulario INS" flow.
 * For each PDF entry it:
 *   1. Builds the 22-column rows + rename mapping with build-pdf-rows
 *   2. Renders the Matriz_<CODE>_<Name>.xlsx workbook
 *   3. Renames the PDF AcroForms via pdf-rewriter
 *   4. Verifies that every newName landed in the renamed PDF
 *   5. Aggregates a summary with diagnostic counters
 *
 * Output zip layout:
 *   - 1 PDF  → <CODE>_<Name>.zip with both files at the root
 *   - 2-3 PDFs → INS_YYYYMMDD.zip with one folder per formulario
 */

const XLSX = require('xlsx');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');

const { buildPdfRows } = require('./build-pdf-rows');
const { buildWorkbook, identifyPdfCode, FORMULARIOS, filenameFor } = require('./export-by-formulario');
const { rewritePdf } = require('../pdf-converter/pdf-rewriter');

async function processSinglePdf(pdfEntry, matrixRows, catalogos) {
    const code = identifyPdfCode(pdfEntry.name);
    const form = FORMULARIOS.find(f => f.code === code);

    const { rows, summary, renameMapping } = await buildPdfRows(
        pdfEntry.bytes, matrixRows, code, catalogos
    );

    const wb = buildWorkbook(rows, code, catalogos);
    const matrizBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const matrizFilename = filenameFor(code, pdfEntry.name);

    const pdfRewriteMap = renameMapping
        .filter(m => m.originalName && m.newName && m.originalName !== m.newName)
        .map(m => ({ oldName: m.originalName, newName: m.newName }));

    let renamedPdfBytes = pdfEntry.bytes;
    let rewriteWarnings = [];
    let renameErrors = [];

    if (pdfRewriteMap.length > 0) {
        const rw = await rewritePdf(pdfEntry.bytes, pdfRewriteMap);
        renamedPdfBytes = rw.pdfBytes;
        rewriteWarnings = rw.warnings || [];
        renameErrors = await verifyRenamedPdf(renamedPdfBytes, pdfRewriteMap);
    }

    const pdfFilename = (form ? form.code + '_' + form.filenameTag : sanitize(pdfEntry.name)) + '_renamed.pdf';
    const folderName = form ? (form.code + '_' + form.filenameTag) : sanitize(pdfEntry.name);

    return {
        code: code || pdfEntry.name,
        name: form ? form.name : pdfEntry.name,
        folderName,
        matrizBytes,
        matrizFilename,
        renamedPdfBytes,
        pdfFilename,
        summary: {
            ...summary,
            renameAttempted: pdfRewriteMap.length,
            renameErrors,
            rewriteWarnings,
        }
    };
}

async function verifyRenamedPdf(renamedBytes, mapping) {
    try {
        const doc = await PDFDocument.load(renamedBytes, { ignoreEncryption: true });
        const fieldNames = new Set(doc.getForm().getFields().map(f => f.getName()));
        return mapping.filter(m => !fieldNames.has(m.newName));
    } catch (err) {
        return [{ oldName: '*', newName: '*', reason: 'Verification failed: ' + err.message }];
    }
}

function sanitize(name) {
    return String(name || '')
        .replace(/\.pdf$/i, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_');
}

function todayYYYYMMDD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return '' + y + m + day;
}

async function runProcessFormulario(matrixRows, pdfEntries, catalogos) {
    if (!pdfEntries || pdfEntries.length === 0) {
        throw new Error('Cargá al menos un PDF');
    }
    if (!matrixRows || matrixRows.length === 0) {
        throw new Error('Cargá la matriz del cliente');
    }

    const builds = [];
    for (const entry of pdfEntries) {
        const built = await processSinglePdf(entry, matrixRows, catalogos);
        builds.push(built);
    }

    const zip = new JSZip();
    let zipFilename;

    if (builds.length === 1) {
        const b = builds[0];
        zipFilename = b.folderName + '.zip';
        zip.file(b.matrizFilename, b.matrizBytes);
        zip.file(b.pdfFilename, b.renamedPdfBytes);
    } else {
        zipFilename = 'INS_' + todayYYYYMMDD() + '.zip';
        for (const b of builds) {
            zip.file(b.folderName + '/' + b.matrizFilename, b.matrizBytes);
            zip.file(b.folderName + '/' + b.pdfFilename, b.renamedPdfBytes);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    return {
        zipBlob,
        zipFilename,
        formularios: builds.map(b => ({
            code: b.code,
            name: b.name,
            matrizFile: b.matrizFilename,
            pdfFile: b.pdfFilename,
            stats: b.summary,
        })),
        warnings: collectWarnings(catalogos, builds),
    };
}

function collectWarnings(catalogos, builds) {
    const out = [];
    if (!catalogos || Object.keys(catalogos).length === 0) {
        out.push({ type: 'no_catalogos', message: 'Sin catálogos cargados — columnas de opciones quedarán vacías' });
    }
    for (const b of builds) {
        if (b.summary.renameErrors && b.summary.renameErrors.length > 0) {
            out.push({
                type: 'rename_errors',
                code: b.code,
                count: b.summary.renameErrors.length,
                message: b.code + ': ' + b.summary.renameErrors.length + ' AcroForm(s) no se renombraron correctamente',
            });
        }
        if (b.summary.pathsSinIndice > 0) {
            out.push({
                type: 'paths_sin_indice',
                code: b.code,
                count: b.summary.pathsSinIndice,
                message: b.code + ': ' + b.summary.pathsSinIndice + ' path(s) sin índice — revisar PERSONAS_INDEX',
            });
        }
    }
    return out;
}

module.exports = {
    runProcessFormulario,
    processSinglePdf,
    verifyRenamedPdf,
    todayYYYYMMDD,
    sanitize,
};
