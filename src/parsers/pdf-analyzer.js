/**
 * PDF Analyzer
 * Extracts AcroForm field metadata and coordinates from a PDF using pdf-lib.
 *
 * Output: Map<pdfFieldName, { page, rect:[x,y,w,h], type, options? }>
 *
 * We only care about AcroForm fields for coordinate resolution —
 * freeform text layout is no longer needed since the Lovable dev renders the UI.
 */
'use strict';

const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

/**
 * Parse a PDF file and return its AcroForm field map.
 * @param {string} pdfPath
 * @returns {Promise<{ numPages:number, fields:Object<string, PdfFieldInfo> }>}
 */
async function parsePdfCoordinates(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
        throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const bytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const pageIndex = new Map();
    pages.forEach((p, i) => pageIndex.set(p.ref.tag + '/' + p.ref.generation, i));

    const fields = {};

    for (const field of form.getFields()) {
        const name = field.getName();
        const type = field.constructor.name.replace(/^PDF/, '').toLowerCase(); // textfield, checkbox, ...
        const widgets = field.acroField.getWidgets();

        const rects = widgets.map(w => {
            const rect = w.getRectangle();
            const pageRef = w.P();
            let pageNum = 0;
            if (pageRef) {
                const key = pageRef.tag + '/' + pageRef.generation;
                pageNum = pageIndex.get(key);
                if (pageNum === undefined) {
                    pageNum = findPageByRef(pages, pageRef);
                }
            }
            return {
                page: pageNum || 0,
                rect: [rect.x, rect.y, rect.width, rect.height]
            };
        });

        const entry = {
            name,
            type: simplifyType(type),
            pdfType: type,
            page: rects[0]?.page ?? 0,
            rect: rects[0]?.rect ?? null,
            widgets: rects
        };

        // Options for choice fields
        if (typeof field.getOptions === 'function') {
            try { entry.options = field.getOptions(); } catch (_) { /* ignore */ }
        }

        fields[name] = entry;
    }

    return { numPages: pages.length, fields };
}

function simplifyType(t) {
    if (/text/.test(t)) return 'text';
    if (/checkbox/.test(t)) return 'checkbox';
    if (/radio/.test(t)) return 'radio';
    if (/dropdown|combobox/.test(t)) return 'select';
    if (/optionlist|listbox/.test(t)) return 'select';
    if (/button/.test(t)) return 'button';
    if (/signature/.test(t)) return 'signature';
    return t;
}

function findPageByRef(pages, ref) {
    for (let i = 0; i < pages.length; i++) {
        if (pages[i].ref === ref) return i;
    }
    return 0;
}

/**
 * Read a PDF file as base64 (for `_sourcePdf.b64` in the output JSON).
 */
function readPdfAsBase64(pdfPath) {
    const bytes = fs.readFileSync(pdfPath);
    return Buffer.from(bytes).toString('base64');
}

module.exports = { parsePdfCoordinates, readPdfAsBase64 };
