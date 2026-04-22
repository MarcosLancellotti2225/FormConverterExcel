'use strict';

const { PDFDocument, PDFName, PDFHexString } = require('pdf-lib');

async function rewritePdf(pdfBytes, renameMap) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const context = pdfDoc.context;
    const warnings = [];

    const acroFormDict = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    const acroFormResolved = acroFormDict ? context.lookup(acroFormDict) : null;
    const rootFieldsArray = acroFormResolved ? acroFormResolved.get(PDFName.of('Fields')) : null;
    const rootFields = rootFieldsArray ? context.lookup(rootFieldsArray) : null;

    for (const { oldName, newName } of renameMap) {
        if (oldName === newName) continue;

        try {
            const field = form.getField(oldName);
            const dict = field.acroField.dict;
            const hasParent = dict.get(PDFName.of('Parent')) !== undefined;

            if (hasParent) {
                flattenField(dict, rootFields, context, newName);
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

function flattenField(dict, rootFields, context, newName) {
    const parentRef = dict.get(PDFName.of('Parent'));
    if (!parentRef) return;

    removeFromParentKids(dict, parentRef, context);

    dict.delete(PDFName.of('Parent'));
    dict.set(PDFName.of('T'), PDFHexString.fromText(newName));

    copyInheritedEntries(dict, parentRef, context);

    if (rootFields && typeof rootFields.push === 'function') {
        const fieldRef = context.getObjectRef(dict);
        if (fieldRef) {
            rootFields.push(fieldRef);
        }
    }
}

function removeFromParentKids(dict, parentRef, context) {
    if (!parentRef) return;
    const parent = context.lookup(parentRef);
    if (!parent) return;

    const kidsRef = parent.get(PDFName.of('Kids'));
    if (!kidsRef) return;
    const kids = (kidsRef === parent) ? kidsRef : context.lookup(kidsRef) || kidsRef;
    if (!kids || typeof kids.size !== 'function') return;

    const fieldRef = context.getObjectRef(dict);
    if (!fieldRef) return;

    const newEntries = [];
    for (let i = 0; i < kids.size(); i++) {
        const kidRef = kids.get(i);
        if (kidRef && kidRef.objectNumber === fieldRef.objectNumber) continue;
        newEntries.push(kidRef);
    }

    const { PDFArray } = require('pdf-lib');
    const newKids = PDFArray.withContext(context);
    for (const entry of newEntries) {
        newKids.push(entry);
    }
    parent.set(PDFName.of('Kids'), newKids);
}

function copyInheritedEntries(dict, parentRef, context) {
    const INHERITABLE = ['FT', 'Ff', 'V', 'DV'];
    let ref = parentRef;

    while (ref) {
        const parent = context.lookup(ref);
        if (!parent || typeof parent.get !== 'function') break;

        for (const key of INHERITABLE) {
            const pdfKey = PDFName.of(key);
            if (dict.get(pdfKey) === undefined && parent.get(pdfKey) !== undefined) {
                dict.set(pdfKey, parent.get(pdfKey));
            }
        }

        ref = parent.get(PDFName.of('Parent')) || null;
    }
}

module.exports = { rewritePdf };
