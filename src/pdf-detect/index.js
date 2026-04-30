/**
 * @file index.js
 * @version 1.0.0
 * @description Entry point for PDF field detector. Reads AcroForm fields
 *              and returns them visually sorted.
 */
'use strict';

const { readPdfFields } = require('./lib/pdf-reader');
const { sortVisually } = require('./lib/visual-sorter');

async function detectFields(pdfBytes) {
    const rawFields = await readPdfFields(pdfBytes);
    const sorted = sortVisually(rawFields);
    return {
        fields: sorted,
        stats: {
            total: sorted.length,
            pages: new Set(sorted.map(f => f.page)).size,
        },
    };
}

module.exports = { detectFields };
