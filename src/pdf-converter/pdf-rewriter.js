'use strict';

const { PDFDocument, PDFName, PDFHexString, PDFString, PDFArray } = require('pdf-lib');

const FIELD_TYPE_MAP = {
    PDFTextField: 'Tx',
    PDFCheckBox: 'Btn',
    PDFRadioGroup: 'Btn',
    PDFDropdown: 'Ch',
    PDFOptionList: 'Ch',
    PDFButton: 'Btn',
    PDFSignature: 'Sig',
};

function readStringValue(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val.decodeText === 'function') return val.decodeText();
    if (typeof val.asString === 'function') return val.asString();
    if (val instanceof PDFHexString) return val.decodeText();
    if (val instanceof PDFString) return val.decodeText();
    return String(val);
}

function collectLeavesRaw(fieldsArray, context, parentName, result) {
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
                    collectLeavesRaw(kids, context, fullName, result);
                    continue;
                }
            }
        }

        result.push({ dict, fullName, ref });
    }
}

async function rewritePdf(pdfBytes, renameMap, deleteNames) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const context = pdfDoc.context;
    const warnings = [];

    const nameMap = new Map();
    for (const { oldName, newName } of renameMap) {
        nameMap.set(oldName, newName);
    }

    const deleteSet = new Set(deleteNames || []);

    const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    if (!acroFormRef) {
        warnings.push({ type: 'no_acroform', reason: 'PDF has no AcroForm' });
        return { pdfBytes: await pdfDoc.save(), warnings };
    }

    const acroForm = context.lookup(acroFormRef);
    const fieldsRef = acroForm.get(PDFName.of('Fields'));
    const fieldsArray = fieldsRef ? context.lookup(fieldsRef) : null;

    if (!fieldsArray) {
        warnings.push({ type: 'no_fields', reason: 'AcroForm has no Fields array' });
        return { pdfBytes: await pdfDoc.save(), warnings };
    }

    const leaves = [];
    collectLeavesRaw(fieldsArray, context, '', leaves);

    let renamedCount = 0;
    let deletedCount = 0;
    const renamedFields = [];
    const deletedFields = [];
    const newRootFields = PDFArray.withContext(context);

    for (const leaf of leaves) {
        const fullName = leaf.fullName;

        if (deleteSet.has(fullName)) {
            deletedCount++;
            deletedFields.push(fullName);
            removeWidgetFromPages(leaf.dict, context, pdfDoc);
            continue;
        }

        const newName = nameMap.get(fullName);

        collectInherited(leaf.dict, context);

        if (newName) {
            leaf.dict.set(PDFName.of('T'), PDFHexString.fromText(newName));
            renamedCount++;
            renamedFields.push({ oldName: fullName, newName });
        } else {
            leaf.dict.set(PDFName.of('T'), PDFHexString.fromText(fullName));
        }

        leaf.dict.delete(PDFName.of('Parent'));
        ensureFieldType(leaf.dict, context);

        let ref = context.getObjectRef(leaf.dict);
        if (!ref) ref = context.register(leaf.dict);
        newRootFields.push(ref);
    }

    acroForm.set(PDFName.of('Fields'), newRootFields);

    const newBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return { pdfBytes: newBytes, warnings, renamedCount, renamedFields, deletedCount, deletedFields };
}

function removeWidgetFromPages(fieldDict, context, pdfDoc) {
    const fieldRef = context.getObjectRef(fieldDict);
    if (!fieldRef) return;

    const pages = pdfDoc.getPages();
    for (const page of pages) {
        const annotsRef = page.node.get(PDFName.of('Annots'));
        if (!annotsRef) continue;
        const annots = context.lookup(annotsRef);
        if (!annots || typeof annots.size !== 'function') continue;

        const newAnnots = PDFArray.withContext(context);
        for (let i = 0; i < annots.size(); i++) {
            const ref = annots.get(i);
            if (ref !== fieldRef && String(ref) !== String(fieldRef)) {
                newAnnots.push(ref);
            }
        }
        page.node.set(PDFName.of('Annots'), newAnnots);
    }

    const kidsRef = fieldDict.get(PDFName.of('Kids'));
    if (kidsRef) {
        const kids = context.lookup(kidsRef);
        if (kids && typeof kids.size === 'function') {
            for (let i = 0; i < kids.size(); i++) {
                const kidRef = kids.get(i);
                for (const page of pages) {
                    const annotsRef2 = page.node.get(PDFName.of('Annots'));
                    if (!annotsRef2) continue;
                    const annots2 = context.lookup(annotsRef2);
                    if (!annots2 || typeof annots2.size !== 'function') continue;

                    const newAnnots2 = PDFArray.withContext(context);
                    for (let j = 0; j < annots2.size(); j++) {
                        const ref = annots2.get(j);
                        if (ref !== kidRef && String(ref) !== String(kidRef)) {
                            newAnnots2.push(ref);
                        }
                    }
                    page.node.set(PDFName.of('Annots'), newAnnots2);
                }
            }
        }
    }
}

function collectInherited(dict, context) {
    const INHERITABLE = ['FT', 'Ff', 'V', 'DV', 'DA', 'DR', 'Q'];
    let parentRef = dict.get(PDFName.of('Parent'));
    while (parentRef) {
        const parent = context.lookup(parentRef);
        if (!parent || typeof parent.get !== 'function') break;

        for (const key of INHERITABLE) {
            const pdfKey = PDFName.of(key);
            if (dict.get(pdfKey) === undefined) {
                const val = parent.get(pdfKey);
                if (val !== undefined) dict.set(pdfKey, val);
            }
        }

        parentRef = parent.get(PDFName.of('Parent'));
    }
}

function ensureFieldType(dict, context) {
    if (dict.get(PDFName.of('FT'))) return;

    const kidsRef = dict.get(PDFName.of('Kids'));
    if (kidsRef) {
        const kids = context.lookup(kidsRef);
        if (kids && typeof kids.size === 'function') {
            for (let i = 0; i < kids.size(); i++) {
                const kid = context.lookup(kids.get(i));
                if (kid && kid.get) {
                    const asVal = kid.get(PDFName.of('AS'));
                    if (asVal) {
                        dict.set(PDFName.of('FT'), PDFName.of('Btn'));
                        return;
                    }
                }
            }
        }
    }

    dict.set(PDFName.of('FT'), PDFName.of('Tx'));
}

async function addFieldToPdf(pdfBytes, newFields) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    let acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    let acroForm;
    if (acroFormRef) {
        acroForm = context.lookup(acroFormRef);
    } else {
        acroForm = context.obj({});
        pdfDoc.catalog.set(PDFName.of('AcroForm'), acroForm);
    }

    let fieldsRef = acroForm.get(PDFName.of('Fields'));
    let fieldsArray = fieldsRef ? context.lookup(fieldsRef) : null;
    if (!fieldsArray) {
        fieldsArray = PDFArray.withContext(context);
        acroForm.set(PDFName.of('Fields'), fieldsArray);
    }

    for (const f of newFields) {
        const pageIdx = (f.page || 1) - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) continue;
        const page = pages[pageIdx];
        const pageRef = pdfDoc.getPage(pageIdx).ref;

        const { PDFDict, PDFNumber } = require('pdf-lib');
        const rect = PDFArray.withContext(context);
        rect.push(PDFNumber.of(f.x));
        rect.push(PDFNumber.of(f.y));
        rect.push(PDFNumber.of(f.x + f.width));
        rect.push(PDFNumber.of(f.y + f.height));

        const fieldDict = context.obj({});
        fieldDict.set(PDFName.of('Type'), PDFName.of('Annot'));
        fieldDict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
        fieldDict.set(PDFName.of('FT'), PDFName.of('Tx'));
        fieldDict.set(PDFName.of('T'), PDFHexString.fromText(f.name));
        fieldDict.set(PDFName.of('Rect'), rect);
        fieldDict.set(PDFName.of('P'), pageRef);
        fieldDict.set(PDFName.of('F'), PDFNumber.of(4));

        const da = '/Helv 10 Tf 0 g';
        fieldDict.set(PDFName.of('DA'), PDFString.of(da));

        const fieldRef = context.register(fieldDict);
        fieldsArray.push(fieldRef);

        let annotsRef = page.node.get(PDFName.of('Annots'));
        let annots;
        if (annotsRef) {
            annots = context.lookup(annotsRef);
            if (!annots || typeof annots.push !== 'function') {
                annots = PDFArray.withContext(context);
                page.node.set(PDFName.of('Annots'), annots);
            }
        } else {
            annots = PDFArray.withContext(context);
            page.node.set(PDFName.of('Annots'), annots);
        }
        annots.push(fieldRef);
    }

    const savedBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return { pdfBytes: savedBytes };
}

module.exports = { rewritePdf, addFieldToPdf };
