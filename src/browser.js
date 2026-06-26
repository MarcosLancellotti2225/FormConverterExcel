/**
 * Browser entry — exposes the pipeline to the page as `window.InsPipeline`.
 * Bundled with esbuild: see `npm run build:web`.
 */
'use strict';

const { runPipelineAll, runEnrichAll } = require('./pipeline');
const { analyzePdf, generatePdf, convertDirect } = require('./pdf-converter/pipeline-convert-pdf');
const { runEnrichPipeline } = require('./enricher/pipeline-enrich');
const matrixEditor = require('./matrix-editor/pipeline-edit');
const { detectFields } = require('./pdf-detect/index');
const { generateMatrices } = require('./matrix-generator/index');
const { addFieldToPdf } = require('./pdf-converter/pdf-rewriter');

async function fileToUint8Array(file) {
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
}

async function fileToText(file) {
    return await file.text();
}

/**
 * Derive formCode from a PDF filename: strip extension and path.
 * "1009052.pdf" → "1009052", "D0306_v2.pdf" → "D0306_v2"
 */
function formCodeFromFile(file) {
    return file.name.replace(/\.pdf$/i, '');
}

/**
 * Derive formCode from a Lovable JSON file.
 * Tries to extract from _sourcePdf.fileName, falls back to file name.
 */
function formCodeFromLovableJson(jsonText, fileName) {
    try {
        const parsed = JSON.parse(jsonText);
        const sp = parsed?._sourcePdf || parsed?.data?.jsonDefinition?._sourcePdf || parsed?.jsonDefinition?._sourcePdf;
        if (sp?.fileName) {
            return sp.fileName.replace(/\.pdf$/i, '').replace(/_v\d+$/i, '');
        }
    } catch { /* fall through */ }
    return fileName.replace(/\.json$/i, '');
}

/**
 * Run the full pipeline for all uploaded PDFs.
 * When Lovable JSON files are provided, runs enrichment mode instead.
 *
 * @param {Object} inputs
 * @param {File}   inputs.matrixFile           (required)
 * @param {File[]} [inputs.pdfFiles]           array of PDF File objects (any number)
 * @param {File}   [inputs.catalogsFile]       (optional)
 * @param {File}   [inputs.clientJsonFile]     (optional)
 * @param {File[]} [inputs.lovableJsonFiles]   (optional) Lovable JSON files for enrichment
 * @param {Object} [options]
 * @returns {Promise<{ results, formCodes, hasFormCodeColumn }>}
 */
async function runAll(inputs, options = {}) {
    const { matrixFile, pdfFiles = [], catalogsFile, clientJsonFile, lovableJsonFiles = [] } = inputs;
    if (!matrixFile) throw new Error('matrixFile is required');

    const matrixBuffer   = await fileToUint8Array(matrixFile);
    const catalogsBuffer = catalogsFile ? await fileToUint8Array(catalogsFile) : null;
    const clientJsonText = clientJsonFile ? await fileToText(clientJsonFile) : null;

    const pdfMap = {};
    for (const pdfFile of pdfFiles) {
        const code = formCodeFromFile(pdfFile);
        pdfMap[code] = {
            buffer: await fileToUint8Array(pdfFile),
            fileName: pdfFile.name
        };
    }

    if (lovableJsonFiles.length > 0) {
        const lovableJsonMap = {};
        for (const file of lovableJsonFiles) {
            const text = await fileToText(file);
            const code = formCodeFromLovableJson(text, file.name);
            lovableJsonMap[code] = text;
        }

        return runEnrichAll({
            matrixBuffer,
            lovableJsonMap,
            catalogsBuffer,
            pdfMap,
            clientJsonText
        }, options);
    }

    return runPipelineAll({
        matrixBuffer,
        catalogsBuffer,
        pdfMap,
        clientJsonText
    }, options);
}

function jsonToBlob(json) {
    return new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runConvertAnalysis(inputs) {
    const { pdfFile, matrixFile, referenceJsonFile } = inputs;
    if (!pdfFile) throw new Error('PDF file is required');
    if (!matrixFile) throw new Error('Excel matrix is required');

    const pdfBytes = await fileToUint8Array(pdfFile);
    const excelBuffer = await fileToUint8Array(matrixFile);
    const referenceJsonText = referenceJsonFile ? await fileToText(referenceJsonFile) : null;

    const result = await analyzePdf({ pdfBytes, excelBuffer, referenceJsonText });
    return { ...result, pdfBytes };
}

async function runConvertGenerate(pdfBytes, finalMatches) {
    const result = await generatePdf(pdfBytes, finalMatches);
    return result;
}

async function parseExcel22Col(excelFile) {
    const { parseExcelFor22Col } = require('./pdf-converter/name-resolver');
    const buffer = await fileToUint8Array(excelFile);
    const parsed = parseExcelFor22Col(buffer);
    if (!parsed) throw new Error('No se encontraron columnas "AcroForm Actual" y "AcroForm Propuesto" en el Excel');
    return parsed.map(r => ({ oldName: r.acroActual, newName: r.acroPropuesto }));
}

async function runConvertDirect(inputs) {
    const { pdfFile, excelFile } = inputs;
    if (!pdfFile) throw new Error('Cargá el PDF original');
    if (!excelFile) throw new Error('Cargá el Excel de mapeo (22 columnas)');
    const pdfBytes = await fileToUint8Array(pdfFile);
    const excelBuffer = await fileToUint8Array(excelFile);
    return convertDirect(pdfBytes, excelBuffer);
}

async function parseExcelHeaders(excelFile) {
    const XLSX = require('xlsx');
    const buffer = await fileToUint8Array(excelFile);
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rawRows.length < 2) throw new Error('El Excel está vacío');
    const headers = rawRows[0].map((h, i) => ({ index: i, name: String(h || 'Columna ' + (i + 1)) }));
    return { headers, rows: rawRows.slice(1), sheetName: wb.SheetNames[0] };
}

async function runConvertCustom(inputs) {
    const { pdfFile, renameMap, deleteNames } = inputs;
    if (!pdfFile) throw new Error('Cargá el PDF original');
    const pdfBytes = await fileToUint8Array(pdfFile);
    const { rewritePdf } = require('./pdf-converter/pdf-rewriter');
    const entries = renameMap.filter(e => e.oldName && e.newName && e.oldName !== e.newName);
    const result = await rewritePdf(pdfBytes, entries, deleteNames);
    return {
        pdfBytes: result.pdfBytes,
        warnings: result.warnings || [],
        renamedCount: result.renamedCount || 0,
        renamedFields: result.renamedFields || [],
        deletedCount: result.deletedCount || 0,
        excelRows: renameMap.length
    };
}

async function runConvertManual(inputs) {
    const { pdfFile, renameMap, deleteNames, moveMap, typeChanges, propChanges } = inputs;
    if (!pdfFile) throw new Error('Cargá el PDF original');
    const pdfBytes = await fileToUint8Array(pdfFile);
    const { rewritePdf } = require('./pdf-converter/pdf-rewriter');
    const entries = renameMap.filter(e => e.oldName && e.newName && e.oldName !== e.newName);
    const result = await rewritePdf(pdfBytes, entries, deleteNames, moveMap || [], typeChanges || [], propChanges || []);
    return {
        pdfBytes: result.pdfBytes,
        warnings: result.warnings || [],
        renamedCount: result.renamedCount || 0,
        renamedFields: result.renamedFields || [],
        deletedCount: result.deletedCount || 0,
        excelRows: entries.length
    };
}

async function renderPreview(pdfBytes, matches, container) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const webWorker = new Worker('pdf.worker.min.mjs', { type: 'module' });
    const pdfWorker = new pdfjsLib.PDFWorker({ port: webWorker });
    const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(), worker: pdfWorker }).promise;

    const fieldsByPage = {};
    for (const m of matches) {
        if (!fieldsByPage[m.page]) fieldsByPage[m.page] = [];
        fieldsByPage[m.page].push(m);
    }

    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const baseVp = page.getViewport({ scale: 1 });
        const cw = container.clientWidth - 24;
        const scale = Math.max(cw / baseVp.width, 1);
        const viewport = page.getViewport({ scale });

        const pageDiv = document.createElement('div');
        pageDiv.className = 'preview-page';
        pageDiv.style.width = Math.floor(viewport.width) + 'px';
        pageDiv.style.height = Math.floor(viewport.height) + 'px';

        const pageLabel = document.createElement('div');
        pageLabel.className = 'preview-page-label';
        pageLabel.textContent = 'Pag ' + p;
        pageDiv.appendChild(pageLabel);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pageDiv.appendChild(canvas);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const pageFields = fieldsByPage[p - 1] || [];
        for (const m of pageFields) {
            const r = m.rect;
            const [x1, y1] = viewport.convertToViewportPoint(r.x, r.y + r.height);
            const [x2, y2] = viewport.convertToViewportPoint(r.x + r.width, r.y);
            const left = Math.min(x1, x2);
            const top = Math.min(y1, y2);
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);

            const fd = document.createElement('div');
            fd.className = 'preview-field' + (m.source === 'unchanged' ? ' unmatched' : '');
            fd.dataset.fieldName = m.originalName;
            fd.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px';

            const tip = document.createElement('span');
            tip.className = 'preview-tooltip';
            tip.textContent = m.newName || m.originalName;
            fd.appendChild(tip);
            pageDiv.appendChild(fd);
        }

        container.appendChild(pageDiv);
    }

    return {
        highlightField(originalName) {
            container.querySelectorAll('.preview-field.highlighted').forEach(el => el.classList.remove('highlighted'));
            const sel = '.preview-field[data-field-name="' + CSS.escape(originalName) + '"]';
            const target = container.querySelector(sel);
            if (target) {
                target.classList.add('highlighted');
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },
        clearHighlights() {
            container.querySelectorAll('.preview-field.highlighted').forEach(el => el.classList.remove('highlighted'));
        },
        markMatched(originalName) {
            const sel = '.preview-field[data-field-name="' + CSS.escape(originalName) + '"]';
            container.querySelectorAll(sel).forEach(el => el.classList.remove('unmatched'));
        },
        updateTooltip(originalName, newText) {
            const sel = '.preview-field[data-field-name="' + CSS.escape(originalName) + '"]';
            container.querySelectorAll(sel).forEach(el => {
                const tip = el.querySelector('.preview-tooltip');
                if (tip) tip.textContent = newText;
            });
        },
        onFieldClick(callback) {
            container.addEventListener('click', e => {
                const fd = e.target.closest('.preview-field');
                if (fd) callback(fd.dataset.fieldName);
            });
        },
        destroy() {
            pdfWorker.destroy();
            webWorker.terminate();
            container.innerHTML = '';
        }
    };
}

async function generateHtml(pdfBytes, matches) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const webWorker = new Worker('pdf.worker.min.mjs', { type: 'module' });
    const pdfWorker = new pdfjsLib.PDFWorker({ port: webWorker });
    const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(), worker: pdfWorker }).promise;

    const SCALE = 2;
    const fieldsByPage = {};
    for (const m of matches) {
        if (!fieldsByPage[m.page]) fieldsByPage[m.page] = [];
        fieldsByPage[m.page].push(m);
    }

    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const bgDataUrl = canvas.toDataURL('image/png');

        const fields = [];
        for (const m of (fieldsByPage[p - 1] || [])) {
            const rc = m.rect;
            const [x1, y1] = viewport.convertToViewportPoint(rc.x, rc.y + rc.height);
            const [x2, y2] = viewport.convertToViewportPoint(rc.x + rc.width, rc.y);
            fields.push({
                name: m.newName || m.originalName,
                originalName: m.originalName,
                type: m.type,
                left: Math.min(x1, x2),
                top: Math.min(y1, y2),
                width: Math.abs(x2 - x1),
                height: Math.abs(y2 - y1),
            });
        }

        pages.push({ bgDataUrl, width: canvas.width, height: canvas.height, fields, pageNum: p });
    }

    pdfWorker.destroy();
    webWorker.terminate();

    return buildHtmlString(pages);
}

function buildHtmlString(pages) {
    let pagesHtml = '';
    for (const pg of pages) {
        let fieldsHtml = '';
        for (const f of pg.fields) {
            const inputHtml = buildFieldInput(f);
            fieldsHtml += `      <div class="field" style="left:${r(f.left)}px;top:${r(f.top)}px;width:${r(f.width)}px;height:${r(f.height)}px" title="${esc(f.originalName)}">\n        ${inputHtml}\n      </div>\n`;
        }
        pagesHtml += `    <div class="page" style="width:${pg.width}px;height:${pg.height}px;background-image:url('${pg.bgDataUrl}')">\n      <div class="page-label">Pag ${pg.pageNum}</div>\n${fieldsHtml}    </div>\n`;
    }

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Formulario HTML</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #f0f0f0; font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; gap: 20px; }
.page { position: relative; background-size: 100% 100%; background-repeat: no-repeat; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
.page-label { position: absolute; top: 4px; right: 6px; background: rgba(0,0,0,0.5); color: #fff; font-size: 10px; padding: 2px 8px; border-radius: 3px; z-index: 50; pointer-events: none; }
.field { position: absolute; z-index: 2; }
.field input[type="text"], .field select, .field textarea {
  width: 100%; height: 100%; border: 1px solid transparent; background: transparent;
  font-size: 11px; padding: 0 3px; outline: none; color: #000; font-family: Arial, Helvetica, sans-serif;
}
.field input[type="text"]:hover, .field select:hover { background: rgba(255,255,200,0.4); border-color: rgba(0,100,200,0.3); }
.field input[type="text"]:focus, .field select:focus, .field textarea:focus {
  border-color: #0066cc; background: rgba(255,255,255,0.9); box-shadow: 0 0 0 1px rgba(0,102,204,0.3);
}
.field input[type="checkbox"], .field input[type="radio"] { width: 100%; height: 100%; margin: 0; cursor: pointer; opacity: 0.01; }
.field input[type="checkbox"]:checked, .field input[type="radio"]:checked { opacity: 1; }
.field:hover { z-index: 10; }
.field:hover::after {
  content: attr(title); position: absolute; bottom: calc(100% + 2px); left: 0;
  background: #333; color: #fff; padding: 2px 6px; border-radius: 3px;
  font-size: 9px; white-space: nowrap; z-index: 20; font-family: monospace;
}
@media print {
  body { background: #fff; padding: 0; gap: 0; }
  .page { box-shadow: none; page-break-after: always; }
  .page-label { display: none; }
  .field:hover::after { display: none; }
  .field input[type="text"], .field select { border-color: transparent; background: transparent; }
}
</style>
</head>
<body>
${pagesHtml}</body>
</html>`;
}

function buildFieldInput(f) {
    if (f.type === 'checkbox') {
        return `<input type="checkbox" name="${esc(f.name)}">`;
    }
    if (f.type === 'radio') {
        return `<input type="radio" name="${esc(f.name)}">`;
    }
    if (f.type === 'select') {
        return `<select name="${esc(f.name)}"><option value=""></option></select>`;
    }
    return `<input type="text" name="${esc(f.name)}">`;
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function r(n) {
    return Math.round(n * 10) / 10;
}

async function runEnrichJson(inputs) {
    const { lovableJsonFile, matrixFile, catalogsFile, clientJsonFile } = inputs;
    if (!lovableJsonFile) throw new Error('Lovable JSON file is required');
    if (!matrixFile) throw new Error('Excel matrix is required');

    const lovableJsonText = await fileToText(lovableJsonFile);
    const matrixBuffer = await fileToUint8Array(matrixFile);
    const catalogsBuffer = catalogsFile ? await fileToUint8Array(catalogsFile) : null;
    const clientJsonText = clientJsonFile ? await fileToText(clientJsonFile) : null;

    return runEnrichPipeline({
        lovableJsonText,
        matrixBuffer,
        catalogsBuffer,
        clientJsonText,
    });
}

async function runMatrixAnalysis(inputs) {
    const { matrixFile } = inputs;
    if (!matrixFile) throw new Error('Excel matrix is required');
    const buffer = await fileToUint8Array(matrixFile);
    const rows = matrixEditor.loadMatrix(buffer);
    const { analyzed, stats } = matrixEditor.analyzeMatrix(rows);
    return { rows, analyzed, stats };
}

function matrixSplitAll(rows) { return matrixEditor.applySplitAll(rows); }
function matrixDerivePdfNames(rows) { return matrixEditor.applyDerivePdfNames(rows); }
function matrixNormalizeObligatorio(rows) { return matrixEditor.applyNormalizeObligatorio(rows); }
function matrixDeriveFormulario(rows) { matrixEditor.applyDeriveFormulario(rows); }
function matrixExport(rows) { return matrixEditor.exportToXlsx(rows); }
async function matrixExportPerFormularioZip(rows, pdfFiles, catalogos) {
    const pdfEntries = [];
    for (const f of (pdfFiles || [])) {
        pdfEntries.push({ name: f.name, bytes: await fileToUint8Array(f) });
    }
    return matrixEditor.exportPerFormularioZip(rows, pdfEntries, catalogos);
}

async function matrixParseCatalogos(file) {
    const buffer = await fileToUint8Array(file);
    return matrixEditor.parseCatalogos(buffer);
}

async function runProcessFormulario(inputs) {
    const { matrixFile, pdfFiles = [], catalogsFile } = inputs || {};
    if (!matrixFile) throw new Error('Cargá la matriz del cliente');
    if (!pdfFiles || pdfFiles.length === 0) throw new Error('Cargá al menos un PDF');

    const matrixBuffer = await fileToUint8Array(matrixFile);
    const matrixRows = matrixEditor.loadMatrix(matrixBuffer);
    matrixEditor.applyDeriveFormulario(matrixRows);

    const catalogos = catalogsFile
        ? matrixEditor.parseCatalogos(await fileToUint8Array(catalogsFile))
        : null;

    const pdfEntries = [];
    for (const f of pdfFiles) {
        pdfEntries.push({ name: f.name, bytes: await fileToUint8Array(f) });
    }

    const { runProcessFormulario: runProc } = require('./matrix-editor/process-formulario');
    return runProc(matrixRows, pdfEntries, catalogos);
}

async function matrixCrossWithPdfs(rows, pdfFiles) {
    const pdfEntries = [];
    for (const f of pdfFiles) {
        pdfEntries.push({ name: f.name.replace(/\.pdf$/i, ''), bytes: await fileToUint8Array(f) });
    }
    return matrixEditor.crossMatrixWithPdfs(rows, pdfEntries);
}

async function runConvertPdfV2(inputs) {
    const { pdfFile, excelFile, formularioCode } = inputs;
    if (!pdfFile) throw new Error('Cargá el PDF original');
    if (!excelFile) throw new Error('Cargá el Excel de mapeo (22 columnas)');

    const pdfBytes = await fileToUint8Array(pdfFile);
    const excelBytes = await fileToUint8Array(excelFile);

    const { convertPdf } = require('./pdf-converter-v2/index');
    return convertPdf(pdfBytes, excelBytes, { formularioCode });
}

function renderPdfPreviewV2(pdfBytes, container) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const { renderPdfPreview } = require('./pdf-converter-v2/ui/pdf-preview');
    return renderPdfPreview(pdfBytes, container, pdfjsLib);
}

async function runDetectFields(inputs) {
    const { pdfFile, pdfBytes: rawBytes } = inputs;
    let pdfBytes;
    if (rawBytes) {
        pdfBytes = rawBytes;
    } else if (pdfFile) {
        pdfBytes = await fileToUint8Array(pdfFile);
    } else {
        throw new Error('Cargá un PDF');
    }
    return detectFields(pdfBytes);
}

async function renderDetectPreview(pdfBytes, container, fields) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    container.innerHTML = '';

    const webWorker = new Worker('pdf.worker.min.mjs', { type: 'module' });
    const pdfWorker = new pdfjsLib.PDFWorker({ port: webWorker });

    let doc;
    try {
        doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(), worker: pdfWorker }).promise;
    } catch (err) {
        container.innerHTML = '<div style="padding:2rem;color:#868e96;">Error al cargar PDF: ' + err.message + '</div>';
        webWorker.terminate();
        return { destroy() {} };
    }

    const numPages = doc.numPages;
    const fieldsByPage = {};
    for (let fi = 0; fi < fields.length; fi++) {
        const f = fields[fi];
        if (!fieldsByPage[f.page]) fieldsByPage[f.page] = [];
        fieldsByPage[f.page].push({ field: f, globalIdx: fi });
    }

    for (let p = 1; p <= numPages; p++) {
        const page = await doc.getPage(p);
        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = container.clientWidth - 32;
        const scale = Math.max(containerWidth / baseViewport.width, 1);
        const viewport = page.getViewport({ scale });

        const pageDiv = document.createElement('div');
        pageDiv.className = 'detect-page';
        pageDiv.style.width = Math.floor(viewport.width) + 'px';
        pageDiv.style.position = 'relative';
        pageDiv.dataset.pdfScale = scale;
        pageDiv.dataset.pdfPageHeight = baseViewport.height;

        const label = document.createElement('div');
        label.className = 'detect-page-label';
        label.textContent = 'Página ' + p + ' de ' + numPages;
        pageDiv.appendChild(label);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pageDiv.appendChild(canvas);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const pageHeight = baseViewport.height;
        const pageFields = fieldsByPage[p] || [];
        for (const { field: f, globalIdx } of pageFields) {
            const overlay = document.createElement('div');
            overlay.className = 'detect-field-overlay';
            overlay.dataset.fieldIdx = globalIdx;
            const left = f.x * scale;
            const top = (pageHeight - f.y - f.height) * scale;
            const w = f.width * scale;
            const h = f.height * scale;
            overlay.style.left = left + 'px';
            overlay.style.top = top + 'px';
            overlay.style.width = w + 'px';
            overlay.style.height = h + 'px';

            const nameTag = document.createElement('div');
            nameTag.className = 'detect-field-name';
            nameTag.textContent = f.name;
            overlay.appendChild(nameTag);

            pageDiv.appendChild(overlay);
        }

        container.appendChild(pageDiv);
    }

    return {
        numPages,
        destroy() {
            pdfWorker.destroy();
            webWorker.terminate();
            container.innerHTML = '';
        },
    };
}

function detectFieldsToXlsx(fields) {
    const XLSX = require('xlsx');
    const rows = [['AcroForm Actual']];
    for (const f of fields) {
        rows.push([f.name]);
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'AcroForm');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Uint8Array(buf);
}

function renameMapToXlsx(entries) {
    const XLSX = require('xlsx');
    const rows = [['AcroForm Actual', 'AcroForm Propuesto', 'Tipo', 'Página', 'Estado']];
    for (const e of entries) {
        const changed = e.newName && e.newName !== e.oldName;
        rows.push([e.oldName, e.newName, e.type, e.page, changed ? 'Renombrado' : 'Sin cambios']);
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 35 }, { wch: 35 }, { wch: 10 }, { wch: 8 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Mapeo');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Uint8Array(buf);
}

async function runGenerateMatrices(inputs) {
    const { matrixFile, pdfFiles } = inputs;
    if (!matrixFile) throw new Error('Cargá la matriz del cliente');
    if (!pdfFiles || !pdfFiles.length) throw new Error('Cargá al menos un PDF');
    const excelBytes = await fileToUint8Array(matrixFile);
    const pdfEntries = [];
    for (const f of pdfFiles) {
        pdfEntries.push({ name: f.name, bytes: await fileToUint8Array(f) });
    }
    return generateMatrices(excelBytes, pdfEntries);
}

async function runAddFields(pdfBytes, newFields) {
    return addFieldToPdf(pdfBytes, newFields);
}

async function mergePdfs(pdfFiles) {
    const { PDFDocument } = require('pdf-lib');
    const merged = await PDFDocument.create();
    const stats = [];

    for (const file of pdfFiles) {
        const bytes = await fileToUint8Array(file);
        const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pageCount = donor.getPageCount();
        const copiedPages = await merged.copyPages(donor, Array.from({ length: pageCount }, (_, i) => i));
        for (const page of copiedPages) merged.addPage(page);
        stats.push({ name: file.name, pages: pageCount });
    }

    const savedBytes = await merged.save();
    return { pdfBytes: new Uint8Array(savedBytes), stats, totalPages: merged.getPageCount() };
}

async function generateLabeledPdf(pdfBytes) {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const { detectFields: detect } = require('./pdf-detect/index');

    const detected = await detect(pdfBytes);
    const fields = detected.fields;

    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    const fieldsByPage = {};
    for (const f of fields) {
        if (!fieldsByPage[f.page]) fieldsByPage[f.page] = [];
        fieldsByPage[f.page].push(f);
    }

    for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        const pageFields = fieldsByPage[pi + 1] || [];
        const pageHeight = page.getHeight();

        for (const f of pageFields) {
            const x = f.x;
            const y = f.y;
            const w = f.width;
            const h = f.height;

            page.drawRectangle({
                x: x, y: y, width: w, height: h,
                borderColor: rgb(0.64, 0.44, 0.97),
                borderWidth: 1,
                opacity: 0,
            });

            const fontSize = Math.max(5, Math.min(8, h * 0.6));
            const labelY = y + h + 2;
            const textWidth = font.widthOfTextAtSize(f.name, fontSize);

            page.drawRectangle({
                x: x, y: labelY - 1, width: textWidth + 4, height: fontSize + 3,
                color: rgb(0.64, 0.44, 0.97),
                opacity: 0.85,
            });

            page.drawText(f.name, {
                x: x + 2, y: labelY + 1,
                size: fontSize,
                font: font,
                color: rgb(1, 1, 1),
            });
        }
    }

    const savedBytes = await pdfDoc.save();
    return new Uint8Array(savedBytes);
}

if (typeof window !== 'undefined') {
    window.InsPipeline = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate, runConvertDirect, runConvertCustom, runConvertManual, parseExcelHeaders, parseExcel22Col, renderPreview, generateHtml, runEnrichJson, runMatrixAnalysis, matrixSplitAll, matrixDerivePdfNames, matrixNormalizeObligatorio, matrixDeriveFormulario, matrixExport, matrixExportPerFormularioZip, matrixParseCatalogos, matrixCrossWithPdfs, runProcessFormulario, runConvertPdfV2, renderPdfPreviewV2, runDetectFields, detectFieldsToXlsx, renameMapToXlsx, renderDetectPreview, runGenerateMatrices, runAddFields, generateLabeledPdf, mergePdfs };
}

module.exports = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate, runConvertDirect, runConvertCustom, runConvertManual, parseExcelHeaders, parseExcel22Col, renderPreview, generateHtml, runEnrichJson, runMatrixAnalysis, matrixSplitAll, matrixDerivePdfNames, matrixNormalizeObligatorio, matrixDeriveFormulario, matrixExport, matrixExportPerFormularioZip, matrixParseCatalogos, matrixCrossWithPdfs, runProcessFormulario, runConvertPdfV2, renderPdfPreviewV2, runDetectFields, detectFieldsToXlsx, renameMapToXlsx, renderDetectPreview, runGenerateMatrices, runAddFields, generateLabeledPdf, mergePdfs };
