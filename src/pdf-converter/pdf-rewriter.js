'use strict';

const { PDFDocument, PDFName, PDFString, PDFHexString } = require('pdf-lib');

async function rewritePdf(pdfBytes, renameMap) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const warnings = [];

    for (const { oldName, newName } of renameMap) {
        if (oldName === newName) continue;

        try {
            const field = form.getField(oldName);
            const dict = field.acroField.dict;
            dict.set(PDFName.of('T'), PDFHexString.fromText(newName));
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

module.exports = { rewritePdf };
