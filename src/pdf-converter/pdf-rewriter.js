'use strict';

const { PDFDocument, PDFName, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');

async function rewritePdf(pdfBytes, renameMap) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const context = pdfDoc.context;
    const warnings = [];

    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    const rootFieldsArray = acroForm ? acroForm.lookup(PDFName.of('Fields')) : null;

    for (const { oldName, newName } of renameMap) {
        if (oldName === newName) continue;

        try {
            const field = form.getField(oldName);
            const dict = field.acroField.dict;
            const hasParent = dict.has(PDFName.of('Parent'));

            if (hasParent) {
                flattenField(dict, rootFieldsArray, context, newName);
            } else {
                dict.set(PDFName.of('T'), PDFHexString.fromText(newName));
            }
        } catch (err) {
            warnings.push({
                type: 'rename_failed',
                field: oldName,
                reason: `Could not rename "${oldName}" to "${newName}": ${err.message}`
            });
        }
    }

    const newBytes = await pdfDoc.save();
    return { pdfBytes: newBytes, warnings };
}

function flattenField(dict, rootFieldsArray, context, newName) {
    const parentRef = dict.get(PDFName.of('Parent'));

    removeFromParentKids(dict, parentRef, context);

    dict.delete(PDFName.of('Parent'));
    dict.set(PDFName.of('T'), PDFHexString.fromText(newName));

    copyInheritedEntries(dict, parentRef, context);

    if (rootFieldsArray instanceof PDFArray) {
        const fieldRef = context.getObjectRef(dict);
        if (fieldRef) {
            rootFieldsArray.push(fieldRef);
        }
    }
}

function removeFromParentKids(dict, parentRef, context) {
    if (!parentRef) return;
    const parent = context.lookup(parentRef);
    if (!parent) return;

    const kidsObj = parent.get(PDFName.of('Kids'));
    if (!(kidsObj instanceof PDFArray)) return;

    const fieldRef = context.getObjectRef(dict);
    if (!fieldRef) return;

    const newKids = PDFArray.withContext(context);
    for (let i = 0; i < kidsObj.size(); i++) {
        const kidRef = kidsObj.get(i);
        if (kidRef instanceof PDFRef && kidRef.objectNumber === fieldRef.objectNumber) continue;
        newKids.push(kidRef);
    }
    parent.set(PDFName.of('Kids'), newKids);
}

function copyInheritedEntries(dict, parentRef, context) {
    const INHERITABLE = ['FT', 'Ff', 'V', 'DV'];
    let ref = parentRef;

    while (ref) {
        const parent = context.lookup(ref);
        if (!parent) break;

        for (const key of INHERITABLE) {
            const pdfKey = PDFName.of(key);
            if (!dict.has(pdfKey) && parent.has(pdfKey)) {
                dict.set(pdfKey, parent.get(pdfKey));
            }
        }

        ref = parent.get(PDFName.of('Parent')) || null;
    }
}

module.exports = { rewritePdf };
