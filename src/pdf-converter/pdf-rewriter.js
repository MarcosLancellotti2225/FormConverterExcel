'use strict';

const { PDFDocument, PDFName, PDFHexString, PDFArray } = require('pdf-lib');

const FIELD_TYPE_MAP = {
    PDFTextField: 'Tx',
    PDFCheckBox: 'Btn',
    PDFRadioGroup: 'Btn',
    PDFDropdown: 'Ch',
    PDFOptionList: 'Ch',
    PDFButton: 'Btn',
    PDFSignature: 'Sig',
};

async function rewritePdf(pdfBytes, renameMap) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const context = pdfDoc.context;
    const warnings = [];

    const fieldCache = new Map();
    for (const { oldName } of renameMap) {
        if (fieldCache.has(oldName)) continue;
        try {
            const field = form.getField(oldName);
            fieldCache.set(oldName, {
                field,
                dict: field.acroField.dict,
                parentRef: field.acroField.dict.get(PDFName.of('Parent')),
                ftName: FIELD_TYPE_MAP[field.constructor.name] || 'Tx',
            });
        } catch (err) {
            warnings.push({
                type: 'rename_failed',
                field: oldName,
                reason: `Field "${oldName}" not found: ${err.message}`
            });
        }
    }

    const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    let rootFields = null;
    if (acroFormRef) {
        const acroForm = context.lookup(acroFormRef);
        if (acroForm && typeof acroForm.get === 'function') {
            const fieldsRef = acroForm.get(PDFName.of('Fields'));
            if (fieldsRef) {
                const resolved = context.lookup(fieldsRef);
                rootFields = (resolved && typeof resolved.push === 'function') ? resolved : fieldsRef;
            }
        }
    }

    for (const { oldName, newName } of renameMap) {
        const cached = fieldCache.get(oldName);
        if (!cached) continue;

        try {
            const { dict, parentRef, ftName } = cached;

            if (parentRef !== undefined) {
                flattenField(dict, parentRef, rootFields, context, newName, ftName);
            } else if (oldName !== newName) {
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

    const newBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return { pdfBytes: newBytes, warnings };
}

function flattenField(dict, parentRef, rootFields, context, newName, ftName) {
    collectInherited(dict, parentRef, context, ftName);

    removeFromParentKids(dict, parentRef, context);

    dict.delete(PDFName.of('Parent'));
    dict.set(PDFName.of('T'), PDFHexString.fromText(newName));

    if (rootFields && typeof rootFields.push === 'function') {
        let fieldRef = context.getObjectRef(dict);
        if (!fieldRef) {
            fieldRef = context.register(dict);
        }
        rootFields.push(fieldRef);
    }
}

function collectInherited(dict, parentRef, context, ftName) {
    if (dict.get(PDFName.of('FT')) === undefined) {
        dict.set(PDFName.of('FT'), PDFName.of(ftName));
    }

    const INHERITABLE = ['Ff', 'V', 'DV', 'DA', 'DR', 'Q'];
    let ref = parentRef;
    while (ref) {
        const parent = context.lookup(ref);
        if (!parent || typeof parent.get !== 'function') break;

        for (const key of INHERITABLE) {
            const pdfKey = PDFName.of(key);
            if (dict.get(pdfKey) === undefined) {
                const val = parent.get(pdfKey);
                if (val !== undefined) {
                    dict.set(pdfKey, val);
                }
            }
        }

        ref = parent.get(PDFName.of('Parent'));
        if (ref === undefined) break;
    }
}

function removeFromParentKids(dict, parentRef, context) {
    const parent = context.lookup(parentRef);
    if (!parent || typeof parent.get !== 'function') return;

    const kidsVal = parent.get(PDFName.of('Kids'));
    if (!kidsVal) return;
    const kids = context.lookup(kidsVal);
    if (!kids || typeof kids.size !== 'function') return;

    const fieldRef = context.getObjectRef(dict);

    const newKids = PDFArray.withContext(context);
    for (let i = 0; i < kids.size(); i++) {
        const kidRef = kids.get(i);
        if (fieldRef && kidRef && kidRef.objectNumber === fieldRef.objectNumber) continue;
        if (!fieldRef && kidRef) {
            const resolved = context.lookup(kidRef);
            if (resolved === dict) continue;
        }
        newKids.push(kidRef);
    }
    parent.set(PDFName.of('Kids'), newKids);
}

module.exports = { rewritePdf };
