'use strict';

const { PDFDocument, PDFName } = require('pdf-lib');

async function parsePdfFromBuffer(bytes) {
    if (!bytes) {
        throw new Error('parsePdfFromBuffer: buffer is required');
    }
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();
    const pageRefMap = new Map();
    pages.forEach((p, i) => {
        pageRefMap.set(p.ref.objectNumber, i);
    });

    const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    if (!acroFormRef) {
        return { numPages: pages.length, fields: {} };
    }

    const acroForm = context.lookup(acroFormRef);
    if (!acroForm || typeof acroForm.get !== 'function') {
        return { numPages: pages.length, fields: {} };
    }

    const fieldsRef = acroForm.get(PDFName.of('Fields'));
    if (!fieldsRef) {
        return { numPages: pages.length, fields: {} };
    }

    const rootFields = context.lookup(fieldsRef);
    if (!rootFields || typeof rootFields.size !== 'function') {
        return { numPages: pages.length, fields: {} };
    }

    const fields = {};
    collectFields(rootFields, '', context, pageRefMap, pages, fields);

    return { numPages: pages.length, fields };
}

function collectFields(kids, parentName, context, pageRefMap, pages, out) {
    for (let i = 0; i < kids.size(); i++) {
        const kidRef = kids.get(i);
        const dict = context.lookup(kidRef);
        if (!dict || typeof dict.get !== 'function') continue;

        const tVal = dict.get(PDFName.of('T'));
        let partialName = '';
        if (tVal) {
            partialName = decodeFieldName(tVal);
        }

        const fullName = parentName ? parentName + '.' + partialName : partialName;

        const childKids = dict.get(PDFName.of('Kids'));
        const resolvedKids = childKids ? context.lookup(childKids) : null;
        const ft = getInheritedFT(dict, context);

        if (resolvedKids && typeof resolvedKids.size === 'function') {
            const hasFieldChildren = hasNonWidgetKids(resolvedKids, context);
            if (hasFieldChildren) {
                collectFields(resolvedKids, fullName, context, pageRefMap, pages, out);
                continue;
            }
        }

        const type = ftToType(ft);
        const widgets = getWidgets(dict, resolvedKids, context);
        const rects = [];

        for (const wDict of widgets) {
            const rect = extractRect(wDict);
            const pageNum = resolvePageNum(wDict, context, pageRefMap, pages);
            rects.push({ page: pageNum, rect });
        }

        const entry = {
            name: fullName,
            type: simplifyType(type),
            pdfType: type,
            page: rects[0]?.page ?? 0,
            rect: rects[0]?.rect ?? null,
            widgets: rects
        };

        if (type === 'select') {
            entry.options = extractOptions(dict, context);
        }

        out[fullName] = entry;
    }
}

function hasNonWidgetKids(kids, context) {
    for (let i = 0; i < kids.size(); i++) {
        const ref = kids.get(i);
        const d = context.lookup(ref);
        if (!d || typeof d.get !== 'function') continue;
        if (d.get(PDFName.of('T')) !== undefined) return true;
    }
    return false;
}

function getWidgets(fieldDict, resolvedKids, context) {
    if (resolvedKids && typeof resolvedKids.size === 'function') {
        const widgets = [];
        for (let i = 0; i < resolvedKids.size(); i++) {
            const ref = resolvedKids.get(i);
            const d = context.lookup(ref);
            if (d && typeof d.get === 'function') widgets.push(d);
        }
        if (widgets.length > 0) return widgets;
    }
    return [fieldDict];
}

function getInheritedFT(dict, context) {
    let current = dict;
    while (current && typeof current.get === 'function') {
        const ft = current.get(PDFName.of('FT'));
        if (ft) return decodeValue(ft);
        const parentRef = current.get(PDFName.of('Parent'));
        if (!parentRef) break;
        current = context.lookup(parentRef);
    }
    return 'Tx';
}

function ftToType(ft) {
    switch (ft) {
        case 'Tx': return 'text';
        case 'Btn': return 'button';
        case 'Ch': return 'select';
        case 'Sig': return 'signature';
        default: return 'text';
    }
}

function decodeFieldName(pdfVal) {
    if (typeof pdfVal === 'string') return pdfVal;
    if (typeof pdfVal.decodeText === 'function') return pdfVal.decodeText();
    if (typeof pdfVal.asString === 'function') return pdfVal.asString();
    if (typeof pdfVal.value === 'string') return pdfVal.value;
    return String(pdfVal);
}

function decodeValue(pdfVal) {
    if (typeof pdfVal === 'string') return pdfVal;
    if (typeof pdfVal.decodeText === 'function') return pdfVal.decodeText();
    if (typeof pdfVal.asString === 'function') return pdfVal.asString();
    if (pdfVal.encodedName) return pdfVal.encodedName.replace(/^\//, '');
    if (typeof pdfVal.value === 'string') return pdfVal.value;
    return String(pdfVal);
}

function extractRect(wDict) {
    const rectVal = wDict.get(PDFName.of('Rect'));
    if (!rectVal) return [0, 0, 0, 0];
    const arr = typeof rectVal.size === 'function' ? rectVal : null;
    if (!arr) return [0, 0, 0, 0];
    const nums = [];
    for (let i = 0; i < arr.size(); i++) {
        const v = arr.get(i);
        nums.push(typeof v === 'number' ? v : (v?.value ?? v?.numberValue ?? (parseFloat(String(v)) || 0)));
    }
    if (nums.length < 4) return [0, 0, 0, 0];
    const x = Math.min(nums[0], nums[2]);
    const y = Math.min(nums[1], nums[3]);
    const w = Math.abs(nums[2] - nums[0]);
    const h = Math.abs(nums[3] - nums[1]);
    return [x, y, w, h];
}

function resolvePageNum(wDict, context, pageRefMap, pages) {
    const pRef = wDict.get(PDFName.of('P'));
    if (pRef) {
        const resolved = typeof pRef.objectNumber === 'number' ? pRef : null;
        if (resolved) {
            const idx = pageRefMap.get(resolved.objectNumber);
            if (idx !== undefined) return idx;
        }
    }
    if (pages.length === 1) return 0;
    return 0;
}

function extractOptions(dict, context) {
    const opt = dict.get(PDFName.of('Opt'));
    if (!opt) return [];
    const arr = context.lookup(opt);
    if (!arr || typeof arr.size !== 'function') return [];
    const options = [];
    for (let i = 0; i < arr.size(); i++) {
        const v = arr.get(i);
        const resolved = v && typeof v.objectNumber === 'number' ? context.lookup(v) : v;
        if (resolved) options.push(decodeFieldName(resolved));
    }
    return options;
}

function simplifyType(t) {
    if (/text/.test(t)) return 'text';
    if (/checkbox/.test(t)) return 'checkbox';
    if (/radio/.test(t)) return 'radio';
    if (/dropdown|combobox|select/.test(t)) return 'select';
    if (/optionlist|listbox/.test(t)) return 'select';
    if (/button/.test(t)) return 'button';
    if (/signature/.test(t)) return 'signature';
    return t;
}

function bufferToBase64(buffer) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
        return buffer.toString('base64');
    }
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa !== 'undefined') return btoa(binary);
    return Buffer.from(bytes).toString('base64');
}

module.exports = { parsePdfFromBuffer, bufferToBase64 };
