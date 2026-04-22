/**
 * Browser entry — exposes the pipeline to the page as `window.InsPipeline`.
 * Bundled with esbuild: see `npm run build:web`.
 */
'use strict';

const { runPipelineAll, runEnrichAll } = require('./pipeline');
const { analyzePdf, generatePdf } = require('./pdf-converter/pipeline-convert-pdf');

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
        const scale = Math.min(cw / baseVp.width, 1.5);
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

    const SCALE = 1.5;
    const fieldsByPage = {};
    for (const m of matches) {
        if (!fieldsByPage[m.page]) fieldsByPage[m.page] = [];
        fieldsByPage[m.page].push(m);
    }

    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: SCALE });

        const content = await page.getTextContent();
        const textItems = [];
        for (const item of content.items) {
            if (!item.str || !item.str.trim()) continue;
            const tx = item.transform[4];
            const ty = item.transform[5];
            const fontSize = Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 10;
            const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
            textItems.push({
                str: item.str,
                left: vx,
                top: vy - fontSize * SCALE * 0.85,
                fontSize: Math.round(fontSize * SCALE * 10) / 10,
                width: item.width * SCALE,
                bold: /bold/i.test(item.fontName || ''),
            });
        }

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

        const opContent = await page.getOperatorList();
        const lines = extractLines(opContent, viewport);

        pages.push({ width: Math.floor(viewport.width), height: Math.floor(viewport.height), textItems, fields, lines, pageNum: p });
    }

    pdfWorker.destroy();
    webWorker.terminate();

    return buildFormHtmlString(pages);
}

function extractLines(opList, viewport) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const OPS = pdfjsLib.OPS;
    const lines = [];
    let curX = 0, curY = 0;
    let lineWidth = 1;
    const COLOR = '#333';

    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];

        if (fn === OPS.setLineWidth) {
            lineWidth = args[0] || 1;
        } else if (fn === OPS.moveTo) {
            curX = args[0]; curY = args[1];
        } else if (fn === OPS.lineTo) {
            const [vx1, vy1] = viewport.convertToViewportPoint(curX, curY);
            const [vx2, vy2] = viewport.convertToViewportPoint(args[0], args[1]);
            const lw = Math.max(lineWidth * viewport.scale, 0.5);
            if (Math.abs(vy1 - vy2) < 2 || Math.abs(vx1 - vx2) < 2) {
                lines.push({ x1: r(vx1), y1: r(vy1), x2: r(vx2), y2: r(vy2), width: Math.min(r(lw), 2), color: COLOR });
            }
            curX = args[0]; curY = args[1];
        } else if (fn === OPS.rectangle) {
            const [rx, ry, rw, rh] = args;
            const [vx1, vy1] = viewport.convertToViewportPoint(rx, ry + rh);
            const [vx2, vy2] = viewport.convertToViewportPoint(rx + rw, ry);
            const left = Math.min(vx1, vx2);
            const top = Math.min(vy1, vy2);
            const w = Math.abs(vx2 - vx1);
            const h = Math.abs(vy2 - vy1);
            if (w > 3 && h > 3) {
                const lw = Math.max(lineWidth * viewport.scale, 0.5);
                lines.push({ rect: true, x: r(left), y: r(top), w: r(w), h: r(h), width: Math.min(r(lw), 2), color: COLOR });
            }
        }
    }
    return lines;
}

function buildFormHtmlString(pages) {
    let pagesHtml = '';
    for (const pg of pages) {
        let textHtml = '';
        for (const t of pg.textItems) {
            const weight = t.bold ? 'font-weight:700;' : '';
            textHtml += `      <span class="txt" style="left:${r(t.left)}px;top:${r(t.top)}px;font-size:${t.fontSize}px;${weight}">${esc(t.str)}</span>\n`;
        }

        let linesHtml = '';
        for (const l of pg.lines) {
            if (l.rect) {
                linesHtml += `      <div class="ln" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;border:${l.width}px solid ${l.color}"></div>\n`;
            } else {
                if (Math.abs(l.y1 - l.y2) < 2) {
                    const left = Math.min(l.x1, l.x2);
                    const w = Math.abs(l.x2 - l.x1);
                    linesHtml += `      <div class="ln" style="left:${left}px;top:${l.y1}px;width:${w}px;height:0;border-top:${l.width}px solid ${l.color}"></div>\n`;
                } else {
                    const top = Math.min(l.y1, l.y2);
                    const h = Math.abs(l.y2 - l.y1);
                    linesHtml += `      <div class="ln" style="left:${l.x1}px;top:${top}px;width:0;height:${h}px;border-left:${l.width}px solid ${l.color}"></div>\n`;
                }
            }
        }

        let fieldsHtml = '';
        for (const f of pg.fields) {
            const inputHtml = buildFieldInput(f);
            fieldsHtml += `      <div class="field" style="left:${r(f.left)}px;top:${r(f.top)}px;width:${r(f.width)}px;height:${r(f.height)}px" title="${esc(f.originalName)}">\n        ${inputHtml}\n      </div>\n`;
        }

        pagesHtml += `    <div class="page" style="width:${pg.width}px;height:${pg.height}px">\n      <div class="page-label">Pag ${pg.pageNum}</div>\n${linesHtml}${textHtml}${fieldsHtml}    </div>\n`;
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
.page { position: relative; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.15); overflow: hidden; }
.page-label { position: absolute; top: 4px; right: 6px; color: #999; font-size: 10px; z-index: 50; }
.txt { position: absolute; white-space: nowrap; color: #000; line-height: 1.15; pointer-events: none; }
.ln { position: absolute; }
.field { position: absolute; z-index: 2; }
.field input[type="text"], .field select, .field textarea {
  width: 100%; height: 100%; border: 1px solid #999; background: rgba(255,255,200,0.3);
  font-size: 11px; padding: 0 3px; outline: none; color: #222; font-family: Arial, Helvetica, sans-serif;
}
.field input[type="text"]:focus, .field select:focus, .field textarea:focus {
  border-color: #0066cc; background: #ffffee; box-shadow: 0 0 0 1px rgba(0,102,204,0.3);
}
.field input[type="checkbox"], .field input[type="radio"] { width: 100%; height: 100%; margin: 0; cursor: pointer; }
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
    return `<input type="text" name="${esc(f.name)}" placeholder="${esc(f.name)}">`;
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function r(n) {
    return Math.round(n * 10) / 10;
}

if (typeof window !== 'undefined') {
    window.InsPipeline = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate, renderPreview, generateHtml };
}

module.exports = { runAll, jsonToBlob, downloadBlob, runConvertAnalysis, runConvertGenerate, renderPreview, generateHtml };
