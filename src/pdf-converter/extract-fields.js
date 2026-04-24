'use strict';

const { PDFDocument } = require('pdf-lib');

async function extractFields(pdfBytes) {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const pageRefs = pages.map(p => p.ref);

    const results = [];

    let unnamedCounter = 0;
    for (const field of form.getFields()) {
        const rawName = field.getName();
        const name = rawName || `_unnamed_${++unnamedCounter}`;
        const typeName = field.constructor.name;
        const widgets = field.acroField.getWidgets();

        for (let wi = 0; wi < widgets.length; wi++) {
            const widget = widgets[wi];
            const rect = widget.getRectangle();
            const pageRef = widget.P();
            let pageIndex = -1;
            if (pageRef) {
                pageIndex = pageRefs.findIndex(ref =>
                    ref.objectNumber === pageRef.objectNumber &&
                    ref.generationNumber === pageRef.generationNumber
                );
            }
            if (pageIndex === -1 && pages.length === 1) pageIndex = 0;

            results.push({
                name,
                type: mapFieldType(typeName),
                typeName,
                rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                },
                page: pageIndex,
                widgetIndex: wi,
                widgetCount: widgets.length,
            });
        }
    }

    return { fields: results, pageCount: pages.length, pdfDoc };
}

function mapFieldType(constructorName) {
    if (/checkbox/i.test(constructorName)) return 'checkbox';
    if (/radio/i.test(constructorName)) return 'radio';
    if (/dropdown|optionlist/i.test(constructorName)) return 'select';
    if (/button/i.test(constructorName)) return 'button';
    return 'text';
}

module.exports = { extractFields };
