/**
 * @file pdf-reader.js
 * @version 1.0.1
 * @description Reads AcroForm fields from a PDF using raw dict tree walk.
 *              Does NOT use pdf-lib's high-level form.getFields() API which
 *              breaks on hierarchical names like Text3.0.0.
 */
'use strict';

const { PDFDocument, PDFName, PDFHexString, PDFString } = require('pdf-lib');

function readStringValue(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val.decodeText === 'function') return val.decodeText();
    if (typeof val.asString === 'function') return val.asString();
    if (val instanceof PDFHexString) return val.decodeText();
    if (val instanceof PDFString) return val.decodeText();
    return String(val);
}

function resolveFieldType(dict, context) {
    const ft = dict.get(PDFName.of('FT'));
    if (ft) {
        const ftStr = ft.encodedName ? ft.encodedName.replace('/', '') : String(ft);
        if (ftStr === 'Btn') {
            const ff = dict.get(PDFName.of('Ff'));
            const flags = ff ? (typeof ff.numberValue === 'function' ? ff.numberValue() : Number(ff)) : 0;
            // Bit 16 = radio, bit 17 = pushbutton
            if (flags & (1 << 16)) return 'Radio';
            if (flags & (1 << 15)) return 'Pushbutton';
            return 'Checkbox';
        }
        if (ftStr === 'Tx') return 'Text';
        if (ftStr === 'Ch') return 'Choice';
        if (ftStr === 'Sig') return 'Signature';
        return ftStr;
    }
    return 'Unknown';
}

function getInheritedFieldType(dict, context) {
    let type = resolveFieldType(dict, context);
    if (type !== 'Unknown') return type;

    let parentRef = dict.get(PDFName.of('Parent'));
    while (parentRef) {
        const parent = context.lookup(parentRef);
        if (!parent || typeof parent.get !== 'function') break;
        type = resolveFieldType(parent, context);
        if (type !== 'Unknown') return type;
        parentRef = parent.get(PDFName.of('Parent'));
    }
    return 'Text';
}

function getWidgetRect(dict, context) {
    const rectVal = dict.get(PDFName.of('Rect'));
    if (!rectVal) return { x: 0, y: 0, width: 0, height: 0 };

    const rect = context.lookup(rectVal);
    if (!rect || typeof rect.size !== 'function') return { x: 0, y: 0, width: 0, height: 0 };

    const nums = [];
    for (let i = 0; i < rect.size(); i++) {
        const v = rect.get(i);
        const n = context.lookup(v);
        nums.push(typeof n === 'number' ? n :
            (n && typeof n.numberValue === 'function' ? n.numberValue() :
            (n && typeof n.value === 'function' ? n.value() : Number(n))));
    }

    if (nums.length < 4) return { x: 0, y: 0, width: 0, height: 0 };

    const [x1, y1, x2, y2] = nums;
    return {
        x: Math.round(Math.min(x1, x2)),
        y: Math.round(Math.min(y1, y2)),
        width: Math.round(Math.abs(x2 - x1)),
        height: Math.round(Math.abs(y2 - y1)),
    };
}

function getWidgetPage(dict, context, pageRefs) {
    const pRef = dict.get(PDFName.of('P'));
    if (pRef) {
        const resolved = context.lookup(pRef);
        const ref = pRef.objectNumber !== undefined ? pRef : context.getObjectRef(resolved);
        if (ref && ref.objectNumber !== undefined) {
            const idx = pageRefs.findIndex(pr =>
                pr.objectNumber === ref.objectNumber
            );
            if (idx >= 0) return idx + 1;
        }
    }
    return 1;
}

function collectLeaves(fieldsArray, context, parentName, result, pageRefs) {
    if (!fieldsArray || typeof fieldsArray.size !== 'function') return;

    for (let i = 0; i < fieldsArray.size(); i++) {
        const ref = fieldsArray.get(i);
        const dict = context.lookup(ref);
        if (!dict || typeof dict.get !== 'function') continue;

        const tVal = dict.get(PDFName.of('T'));
        const partialName = tVal ? readStringValue(tVal) : '';
        const fullName = parentName ? parentName + '.' + partialName : partialName;

        const kidsRef = dict.get(PDFName.of('Kids'));
        if (kidsRef) {
            const kids = context.lookup(kidsRef);
            if (kids && typeof kids.size === 'function' && kids.size() > 0) {
                const firstKid = context.lookup(kids.get(0));
                const firstKidHasT = firstKid && firstKid.get && firstKid.get(PDFName.of('T'));
                if (firstKidHasT) {
                    collectLeaves(kids, context, fullName, result, pageRefs);
                    continue;
                }

                if (kids.size() > 1) {
                    const type = getInheritedFieldType(dict, context);
                    for (let k = 0; k < kids.size(); k++) {
                        const kidRef = kids.get(k);
                        const kidDict = context.lookup(kidRef);
                        if (!kidDict || typeof kidDict.get !== 'function') continue;
                        const rect = getWidgetRect(kidDict, context);
                        const page = getWidgetPage(kidDict, context, pageRefs);
                        result.push({
                            name: fullName,
                            type,
                            page,
                            x: rect.x, y: rect.y,
                            width: rect.width, height: rect.height,
                            _widgetIndex: k,
                            _widgetCount: kids.size(),
                            _isWidget: true,
                        });
                    }
                    continue;
                }
            }
        }

        const type = getInheritedFieldType(dict, context);
        const rect = getWidgetRect(dict, context);
        const page = getWidgetPage(dict, context, pageRefs);

        result.push({
            name: fullName,
            type,
            page,
            x: rect.x, y: rect.y,
            width: rect.width, height: rect.height,
        });
    }
}

function markDuplicates(fields) {
    const counts = {};
    for (const f of fields) {
        const key = f._isWidget ? f.name + '#w' + f._widgetIndex : f.name;
        counts[f.name] = (counts[f.name] || 0) + 1;
    }

    const seen = {};
    for (const f of fields) {
        if (f._isWidget) continue;
        if (counts[f.name] > 1) {
            const idx = seen[f.name] || 0;
            f._dupIndex = idx;
            f._dupCount = counts[f.name];
            seen[f.name] = idx + 1;
        }
    }
}

async function readPdfFields(pdfBytes) {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const context = doc.context;

    const pages = doc.getPages();
    const pageRefs = pages.map(p => p.ref);

    const acroFormRef = doc.catalog.get(PDFName.of('AcroForm'));
    if (!acroFormRef) return [];

    const acroForm = context.lookup(acroFormRef);
    const fieldsRef = acroForm.get(PDFName.of('Fields'));
    const fieldsArray = fieldsRef ? context.lookup(fieldsRef) : null;
    if (!fieldsArray) return [];

    const leaves = [];
    collectLeaves(fieldsArray, context, '', leaves, pageRefs);
    markDuplicates(leaves);
    return leaves;
}

module.exports = { readPdfFields };
