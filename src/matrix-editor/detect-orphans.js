'use strict';

function detectOrphans(excelRows, acroFields, matchResults) {
    const matchedFieldNames = new Set();

    for (const mr of matchResults) {
        if (mr.match && mr.match.field && mr.match.confidence >= 75) {
            matchedFieldNames.add(mr.match.field.name);
        }
    }

    const orphanRows = [];
    for (let i = 0; i < excelRows.length; i++) {
        const mr = matchResults[i];
        if (!mr.match || !mr.match.field || mr.match.confidence < 75) {
            orphanRows.push({ rowIndex: i, row: excelRows[i] });
        }
    }

    const orphanFields = acroFields.filter(f => !matchedFieldNames.has(f.name));

    return { orphanRows, orphanFields };
}

function computeCrossStats(excelRows, acroFields, matchResults) {
    let matchHigh = 0;
    let matchMed = 0;
    let matchLow = 0;
    let noMatch = 0;

    for (const mr of matchResults) {
        if (!mr.match) {
            noMatch++;
        } else if (mr.match.confidence >= 85) {
            matchHigh++;
        } else if (mr.match.confidence >= 70) {
            matchMed++;
        } else {
            matchLow++;
        }
    }

    const matchedFieldNames = new Set();
    for (const mr of matchResults) {
        if (mr.match && mr.match.field && mr.match.confidence >= 75) {
            matchedFieldNames.add(mr.match.field.name);
        }
    }
    const orphanFieldCount = acroFields.filter(f => !matchedFieldNames.has(f.name)).length;

    return {
        totalExcel: excelRows.length,
        totalAcro: acroFields.length,
        matchHigh,
        matchMed,
        matchLow,
        noMatch,
        orphanFields: orphanFieldCount,
    };
}

module.exports = { detectOrphans, computeCrossStats };
