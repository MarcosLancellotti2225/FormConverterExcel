'use strict';

const { extractFields } = require('./extract-fields');
const { extractText } = require('./extract-text');
const { detectLabels } = require('./label-detector');
const { resolveNames } = require('./name-resolver');
const { rewritePdf } = require('./pdf-rewriter');

async function analyzePdf(inputs) {
    const { pdfBytes, excelBuffer, referenceJsonText } = inputs;

    if (!pdfBytes) throw new Error('PDF file is required');
    if (!excelBuffer) throw new Error('Excel matrix is required');

    const referenceJson = referenceJsonText ? JSON.parse(referenceJsonText) : null;

    const { fields, pageCount } = await extractFields(pdfBytes);
    const textItems = await extractText(pdfBytes);
    const labeledFields = detectLabels(fields, textItems);
    const { matches, warnings } = resolveNames(labeledFields, excelBuffer, referenceJson);

    const noLabel = matches.filter(m => !m.detectedLabel).length;
    const noLabelPct = fields.length > 0 ? Math.round(noLabel / fields.length * 100) : 0;
    if (noLabelPct > 40) {
        warnings.push({
            type: 'low_label_coverage',
            reason: `Only ${100 - noLabelPct}% of fields have a detected label. Manual editing recommended.`
        });
    }

    return {
        matches,
        warnings,
        stats: {
            totalFields: fields.length,
            pageCount,
            withLabel: fields.length - noLabel,
            matched: matches.filter(m => m.source !== 'unchanged').length,
            unchanged: matches.filter(m => m.source === 'unchanged').length,
        }
    };
}

async function generatePdf(pdfBytes, finalMatches) {
    const renameMap = finalMatches
        .filter(m => m.newName !== m.originalName)
        .map(m => ({ oldName: m.originalName, newName: m.newName }));

    const deduped = deduplicateNames(renameMap);
    const { pdfBytes: newPdfBytes, warnings } = await rewritePdf(pdfBytes, deduped);

    return { pdfBytes: newPdfBytes, warnings, renamedCount: deduped.length };
}

function deduplicateNames(renameMap) {
    const seen = new Set();
    const result = [];

    for (const entry of renameMap) {
        let name = entry.newName;
        if (seen.has(name)) {
            let suffix = 2;
            while (seen.has(name + '_' + suffix)) suffix++;
            name = name + '_' + suffix;
        }
        seen.add(name);
        result.push({ oldName: entry.oldName, newName: name });
    }

    return result;
}

module.exports = { analyzePdf, generatePdf };
