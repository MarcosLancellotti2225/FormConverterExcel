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
    const collapsed = collapseWidgets(labeledFields);
    const { matches, warnings } = resolveNames(collapsed, excelBuffer, referenceJson, textItems);

    const totalUnique = collapsed.length;
    const noLabel = matches.filter(m => !m.detectedLabel).length;
    const noLabelPct = totalUnique > 0 ? Math.round(noLabel / totalUnique * 100) : 0;
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
            totalFields: totalUnique,
            totalWidgets: fields.length,
            pageCount,
            withLabel: totalUnique - noLabel,
            matched: matches.filter(m => m.source !== 'unchanged').length,
            unchanged: matches.filter(m => m.source === 'unchanged').length,
        }
    };
}

async function generatePdf(pdfBytes, finalMatches) {
    const seen = new Set();
    const renameMap = [];
    for (const m of finalMatches) {
        if (seen.has(m.originalName)) continue;
        seen.add(m.originalName);
        let finalNewName = m.newName;
        if (finalNewName === m.originalName && finalNewName.includes('.')) {
            finalNewName = finalNewName.replace(/\./g, '_');
        }
        renameMap.push({ oldName: m.originalName, newName: finalNewName });
    }

    const { deduped, collisionWarnings } = deduplicateNames(renameMap);
    const { pdfBytes: newPdfBytes, warnings } = await rewritePdf(pdfBytes, deduped);

    return { pdfBytes: newPdfBytes, warnings: [...collisionWarnings, ...warnings], renamedCount: deduped.length };
}

function collapseWidgets(labeledFields) {
    const byName = new Map();
    for (const f of labeledFields) {
        const existing = byName.get(f.name);
        if (!existing) {
            byName.set(f.name, f);
        } else {
            const curLen = (existing.detectedLabel || '').length;
            const newLen = (f.detectedLabel || '').length;
            if (newLen > curLen) {
                byName.set(f.name, f);
            }
        }
    }
    return Array.from(byName.values());
}

function deduplicateNames(renameMap) {
    const groups = new Map();
    for (let i = 0; i < renameMap.length; i++) {
        const name = renameMap[i].newName;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(i);
    }

    const warnings = [];
    for (const [name, indices] of groups) {
        if (indices.length <= 1) continue;
        for (let i = 0; i < indices.length; i++) {
            renameMap[indices[i]].newName = `${name}_${i + 1}`;
        }
        warnings.push({
            type: 'collision-resolved',
            field: name,
            reason: `${indices.length} fields shared "${name}" — suffixed _1.._${indices.length}`,
        });
    }

    return { deduped: renameMap, collisionWarnings: warnings };
}

module.exports = { analyzePdf, generatePdf };
