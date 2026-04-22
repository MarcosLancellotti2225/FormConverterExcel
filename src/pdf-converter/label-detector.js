'use strict';

const MAX_LEFT_DIST = 200;
const MAX_ABOVE_DIST = 40;
const Y_TOLERANCE_FACTOR = 1.5;
const X_ALIGN_TOLERANCE = 20;

function detectLabels(fields, textItems) {
    const byPage = groupByPage(textItems);

    return fields.map(field => {
        const pageTexts = byPage.get(field.page) || [];
        const label = findBestLabel(field, pageTexts);
        return { ...field, detectedLabel: label };
    });
}

function findBestLabel(field, pageTexts) {
    const fx = field.rect.x;
    const fy = field.rect.y;
    const fh = field.rect.height;
    const fw = field.rect.width;

    const candidates = [];

    for (const t of pageTexts) {
        const textRight = t.x + t.width;
        const distLeft = fx - textRight;
        const yDiff = Math.abs(t.y - fy);
        const alignedY = yDiff < fh * Y_TOLERANCE_FACTOR;

        if (distLeft > 0 && distLeft < MAX_LEFT_DIST && alignedY) {
            candidates.push({ text: t.str, dist: distLeft, direction: 'left' });
            continue;
        }

        const distAbove = t.y - (fy + fh);
        const alignedX = Math.abs(t.x - fx) < X_ALIGN_TOLERANCE;

        if (distAbove > 0 && distAbove < MAX_ABOVE_DIST && alignedX) {
            candidates.push({ text: t.str, dist: distAbove, direction: 'above' });
        }
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        if (a.direction === 'left' && b.direction === 'above') return -1;
        if (a.direction === 'above' && b.direction === 'left') return 1;
        return a.dist - b.dist;
    });

    let label = candidates[0].text.trim();
    if (label.endsWith(':')) label = label.slice(0, -1).trim();

    return label || null;
}

function groupByPage(items) {
    const map = new Map();
    for (const item of items) {
        if (!map.has(item.page)) map.set(item.page, []);
        map.get(item.page).push(item);
    }
    return map;
}

module.exports = { detectLabels };
