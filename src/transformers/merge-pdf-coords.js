/**
 * Merge PDF Coordinates
 * Attaches sourceMeta + rect info to each Field based on the PDF AcroForm map.
 *
 * Resolution order:
 *   1. Exact match on Field.pdfFieldName (from the Excel column)
 *   2. Normalized match (underscores, accents stripped)
 *   3. Fuzzy match on pdfLabel ↔ field display name
 */
'use strict';

function mergePdfCoords(fields, pdfData) {
    const pdfFields = (pdfData && pdfData.fields) || {};
    const normalizedIndex = {};
    for (const name of Object.keys(pdfFields)) {
        normalizedIndex[normalizeKey(name)] = { name, data: pdfFields[name] };
    }

    const warnings = [];

    for (const field of fields) {
        let match = null;

        if (field.pdfFieldName && pdfFields[field.pdfFieldName]) {
            match = { name: field.pdfFieldName, data: pdfFields[field.pdfFieldName] };
        } else if (field.pdfFieldName) {
            const norm = normalizeKey(field.pdfFieldName);
            if (normalizedIndex[norm]) match = normalizedIndex[norm];
        }

        if (!match && field.pdfLabel) {
            const norm = normalizeKey(field.pdfLabel);
            if (normalizedIndex[norm]) match = normalizedIndex[norm];
        }

        if (match) {
            field.sourceMeta = {
                sourceName: match.name,
                pdfType: match.data.pdfType,
                type: match.data.type
            };
            field.pdfCoords = {
                page: match.data.page,
                rect: match.data.rect
            };
        } else if (field.pdfFieldName) {
            warnings.push({
                type: 'pdf_field_not_found',
                field: field.label,
                expectedName: field.pdfFieldName
            });
        }
    }

    return { fields, warnings };
}

function normalizeKey(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\[\d+\]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

module.exports = { mergePdfCoords };
