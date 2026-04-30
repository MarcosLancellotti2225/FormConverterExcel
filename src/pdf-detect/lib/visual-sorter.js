/**
 * @file visual-sorter.js
 * @version 1.0.2
 * @description Sorts PDF fields visually: by page asc, then top-to-bottom
 *              (Y descending with ~5pt tolerance for same-row grouping),
 *              then left-to-right (X ascending) within each row.
 */
'use strict';

const Y_TOLERANCE = 5;

function sortVisually(fields) {
    const sorted = fields.slice();

    sorted.sort(function (a, b) {
        if (a.page !== b.page) return a.page - b.page;

        // Y descending (PDF coords: higher Y = higher on page)
        // Fields within Y_TOLERANCE are considered same row
        if (Math.abs(a.y - b.y) > Y_TOLERANCE) return b.y - a.y;

        // Same row: sort by X ascending (left to right)
        return a.x - b.x;
    });

    // Assign visual row numbers for display
    let row = 1;
    for (let i = 0; i < sorted.length; i++) {
        if (i === 0) {
            sorted[i]._visualRow = row;
            continue;
        }
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.page !== prev.page || Math.abs(cur.y - prev.y) > Y_TOLERANCE) {
            row++;
        }
        cur._visualRow = row;
    }

    return sorted;
}

module.exports = { sortVisually };
