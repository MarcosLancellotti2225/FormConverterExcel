'use strict';

const MAX_LEFT_DIST = 200;
const MAX_ABOVE_DIST = 80;
const LEFT_Y_TOLERANCE = 4;
const ABOVE_X_TOLERANCE = 30;
const MERGE_Y_TOLERANCE = 3;
const MERGE_X_GAP = 12;

function detectLabels(fields, textItems) {
    const byPage = groupByPage(textItems);

    const mergedByPage = new Map();
    for (const [page, items] of byPage) {
        mergedByPage.set(page, mergeAdjacentText(items));
    }

    const labeled = fields.map(field => {
        const pageTexts = mergedByPage.get(field.page) || [];
        const label = findBestLabel(field, pageTexts, fields);
        return { ...field, detectedLabel: label };
    });

    propagateRowLabels(labeled);

    return labeled;
}

function mergeAdjacentText(items) {
    const sorted = [...items].sort((a, b) => {
        if (Math.abs(a.y - b.y) > MERGE_Y_TOLERANCE) return b.y - a.y;
        return a.x - b.x;
    });

    const merged = [];
    let cur = null;

    for (const item of sorted) {
        if (cur &&
            Math.abs(item.y - cur.y) <= MERGE_Y_TOLERANCE &&
            (item.x - (cur.x + cur.width)) <= MERGE_X_GAP &&
            (item.x - (cur.x + cur.width)) >= -2) {
            cur.str = (cur.str + ' ' + item.str).trim();
            cur.width = (item.x + item.width) - cur.x;
            cur.height = Math.max(cur.height, item.height);
        } else {
            if (cur) merged.push(cur);
            cur = { ...item };
        }
    }
    if (cur) merged.push(cur);

    return merged;
}

function findBestLabel(field, pageTexts, allFields) {
    const fx = field.rect.x;
    const fy = field.rect.y;
    const fh = field.rect.height;

    const candidates = [];

    for (const t of pageTexts) {
        if (isSectionHeader(t)) continue;

        const textRight = t.x + t.width;
        const distLeft = fx - textRight;
        const yDiff = Math.abs(t.y - fy);

        if (distLeft > 0 && distLeft < MAX_LEFT_DIST && yDiff < LEFT_Y_TOLERANCE + fh * 0.5) {
            if (!isOccluded(t, field, allFields)) {
                candidates.push({
                    text: t.str, dist: distLeft, direction: 'left',
                    score: scoreCandidate(t, distLeft, 'left'),
                });
            }
            continue;
        }

        const fieldTop = fy + fh;
        const distAbove = t.y - fieldTop;
        const xOverlap = Math.min(t.x + t.width, fx + field.rect.width) - Math.max(t.x, fx);
        const xAligned = Math.abs(t.x - fx) < ABOVE_X_TOLERANCE || xOverlap > 0;

        if (distAbove > -2 && distAbove < MAX_ABOVE_DIST && xAligned) {
            if (!hasFieldBetweenVertical(t, field, allFields)) {
                candidates.push({
                    text: t.str, dist: distAbove, direction: 'above',
                    score: scoreCandidate(t, Math.max(0, distAbove), 'above'),
                });
            }
        }
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.score - a.score);

    let label = candidates[0].text.trim();
    if (label.endsWith(':')) label = label.slice(0, -1).trim();

    return label || null;
}

function scoreCandidate(t, dist, direction) {
    let score = 100;

    score -= dist * (direction === 'left' ? 0.4 : 0.6);

    if (direction === 'left') score += 10;

    if (t.str.trim().endsWith(':')) score += 15;

    const text = t.str.trim();
    if (text.length <= 2) score -= 20;
    if (text.length >= 3 && text.length <= 40) score += 5;

    return score;
}

function isSectionHeader(t) {
    const text = t.str.trim();
    if (text.length < 10) return false;
    const upper = text.replace(/[^A-ZÁÉÍÓÚÑÜ\s]/gi, '');
    if (upper.length < 10) return false;
    return upper === upper.toUpperCase() && upper.length > text.length * 0.6;
}

function isOccluded(text, field, allFields) {
    const textRight = text.x + text.width;
    const fy = field.rect.y;
    const fh = field.rect.height;

    for (const other of allFields) {
        if (other === field || other.page !== field.page) continue;
        if (Math.abs(other.rect.y - fy) > fh + LEFT_Y_TOLERANCE) continue;
        if (other.rect.x >= textRight && (other.rect.x + other.rect.width) <= field.rect.x) {
            return true;
        }
    }
    return false;
}

function hasFieldBetweenVertical(text, field, allFields) {
    const fy = field.rect.y;
    const fh = field.rect.height;
    const fieldTop = fy + fh;
    const textBottom = text.y;

    for (const other of allFields) {
        if (other === field || other.page !== field.page) continue;
        const otherBot = other.rect.y;
        const otherTop = other.rect.y + other.rect.height;
        if (otherBot > fieldTop && otherTop < textBottom) {
            if (Math.abs(other.rect.x - field.rect.x) < ABOVE_X_TOLERANCE) {
                return true;
            }
        }
    }
    return false;
}

function propagateRowLabels(labeledFields) {
    const groups = new Map();
    for (const field of labeledFields) {
        const m = field.name.match(/^(.+?)Row\s*(\d+)$/i);
        if (!m) continue;
        const baseName = m[1].toLowerCase();
        if (!groups.has(baseName)) groups.set(baseName, []);
        groups.get(baseName).push({ field, rowNum: parseInt(m[2], 10) });
    }

    for (const [, entries] of groups) {
        if (entries.length < 2) continue;
        entries.sort((a, b) => a.rowNum - b.rowNum);

        const donor = entries.find(e => e.field.detectedLabel && !isBadLabel(e.field.detectedLabel));
        if (!donor) continue;

        for (const entry of entries) {
            if (!entry.field.detectedLabel || isBadLabel(entry.field.detectedLabel)) {
                entry.field.detectedLabel = donor.field.detectedLabel;
            }
        }
    }
}

function isBadLabel(label) {
    if (!label) return true;
    const clean = label.trim();
    if (clean.length <= 1) return true;
    if (/^[A-ZÁÉÍÓÚÑÜ\s]{15,}$/.test(clean)) return true;
    return false;
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
