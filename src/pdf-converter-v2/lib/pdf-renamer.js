/**
 * @file pdf-renamer.js
 * @version 1.0.3
 * @description Renames AcroForm fields in PDF using convention B, cleans dirty defaults,
 *              and verifies the result. Ported from pikepdf Python prototype.
 * @changelog
 *   - v1.0.2: Initial port from pikepdf — recursive tree walk, flatten + rename
 *   - v1.0.3: Dirty defaults cleanup + post-rewrite verification
 */
'use strict';

const { PDFDocument, PDFName, PDFHexString, PDFString, PDFArray } = require('pdf-lib');

const DIRTY_VALUES = new Set([
    'undefined', 'undefine', 'NOTIFICACIONES', 'null', 'NaN',
]);

async function renamePdf(pdfBytes, renameMapping) {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const context = doc.context;
    const warnings = [];

    const nameMap = new Map();
    for (const { oldName, newName } of renameMapping) {
        nameMap.set(oldName, newName);
    }

    const acroFormRef = doc.catalog.get(PDFName.of('AcroForm'));
    if (!acroFormRef) {
        warnings.push({ type: 'no_acroform', reason: 'PDF has no AcroForm' });
        return { pdfBytes: await doc.save(), warnings, renamedCount: 0, summary: {} };
    }

    const acroForm = context.lookup(acroFormRef);
    const fieldsRef = acroForm.get(PDFName.of('Fields'));
    const fieldsArray = fieldsRef ? context.lookup(fieldsRef) : null;

    if (!fieldsArray) {
        warnings.push({ type: 'no_fields', reason: 'AcroForm has no Fields array' });
        return { pdfBytes: await doc.save(), warnings, renamedCount: 0, summary: {} };
    }

    const leaves = [];
    collectLeaves(fieldsArray, context, '', leaves);

    let renamedCount = 0;
    const renamedFields = [];
    const newRootFields = PDFArray.withContext(context);

    for (const leaf of leaves) {
        const fullName = leaf.fullName;
        const newName = nameMap.get(fullName);

        if (newName) {
            leaf.dict.set(PDFName.of('T'), PDFHexString.fromText(newName));
            leaf.dict.delete(PDFName.of('Parent'));
            ensureFieldType(leaf.dict, context);
            cleanDirtyValues(leaf.dict, fullName, context);

            let ref = context.getObjectRef(leaf.dict);
            if (!ref) ref = context.register(leaf.dict);
            newRootFields.push(ref);

            renamedCount++;
            renamedFields.push({ oldName: fullName, newName });
        } else {
            leaf.dict.set(PDFName.of('T'), PDFHexString.fromText(fullName));
            leaf.dict.delete(PDFName.of('Parent'));
            ensureFieldType(leaf.dict, context);
            cleanDirtyValues(leaf.dict, fullName, context);

            let ref = context.getObjectRef(leaf.dict);
            if (!ref) ref = context.register(leaf.dict);
            newRootFields.push(ref);

            if (nameMap.size > 0) {
                warnings.push({
                    type: 'field_not_in_mapping',
                    field: fullName,
                    reason: `AcroForm "${fullName}" no está en el Excel — queda con su nombre original`,
                });
            }
        }
    }

    acroForm.set(PDFName.of('Fields'), newRootFields);

    const leafNames = new Set(leaves.map(l => l.fullName));
    for (const [oldName, newName] of nameMap) {
        if (!leafNames.has(oldName)) {
            warnings.push({
                type: 'rename_failed',
                field: oldName,
                reason: `AcroForm "${oldName}" del Excel no existe en el PDF`,
            });
        }
    }

    const savedBytes = await doc.save({ updateFieldAppearances: false });

    const verifyResult = await verifyRenamedPdf(savedBytes, renamedFields);
    for (const err of verifyResult.errors) {
        warnings.push({
            type: 'verify_missing',
            field: err.newName,
            reason: `Verificación: "${err.newName}" no encontrado en el PDF renombrado`,
        });
    }

    return {
        pdfBytes: savedBytes,
        warnings,
        renamedCount,
        renamedFields,
        summary: {
            totalLeaves: leaves.length,
            renamed: renamedCount,
            unchanged: leaves.length - renamedCount,
            verified: verifyResult.found,
            verifyErrors: verifyResult.errors.length,
        },
    };
}

function collectLeaves(fieldsArray, context, parentName, result) {
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
                    collectLeaves(kids, context, fullName, result);
                    continue;
                }
            }
        }

        collectInherited(dict, context);
        result.push({ dict, fullName, ref });
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

function cleanDirtyValues(dict, oldName, context) {
    const keysToCheck = ['V', 'DV', 'TU', 'TM'];
    for (const key of keysToCheck) {
        const pdfKey = PDFName.of(key);
        const val = dict.get(pdfKey);
        if (!val) continue;

        const strVal = readStringValue(val);
        if (isDirtyValue(strVal, oldName)) {
            dict.delete(pdfKey);
        }
    }
}

function isDirtyValue(strVal, oldName) {
    if (!strVal) return false;
    const trimmed = strVal.trim();
    if (!trimmed) return false;
    if (DIRTY_VALUES.has(trimmed)) return true;
    if (trimmed === oldName) return true;
    if (/^Text\d|^Check\s*Box|^Combo\s*Box|^Radio\s*Button/i.test(trimmed)) return true;
    return false;
}

function readStringValue(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val.decodeText === 'function') return val.decodeText();
    if (typeof val.asString === 'function') return val.asString();
    if (val instanceof PDFHexString) return val.decodeText();
    if (val instanceof PDFString) return val.decodeText();
    return String(val);
}

async function verifyRenamedPdf(pdfBytes, renamedFields) {
    try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const form = doc.getForm();
        const fieldNames = new Set(form.getFields().map(f => f.getName()));

        const found = [];
        const errors = [];
        for (const { oldName, newName } of renamedFields) {
            if (fieldNames.has(newName)) {
                found.push(newName);
            } else {
                errors.push({ oldName, newName });
            }
        }

        return { found, errors };
    } catch (err) {
        return {
            found: [],
            errors: [{ oldName: '*', newName: '*', reason: 'Verification failed: ' + err.message }],
        };
    }
}

module.exports = {
    renamePdf,
    _internal: { collectLeaves, cleanDirtyValues, isDirtyValue, readStringValue, verifyRenamedPdf },
};
