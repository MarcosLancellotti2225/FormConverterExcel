'use strict';

var matrixParser = require('./matrix-parser');
var fieldBuilder = require('./field-builder');
var sectionBuilder = require('./section-builder');
var validator = require('./validator');
var detectModule = require('../pdf-detect/index');

async function generateSignframeJson(opts) {
    var matrixBytes = opts.matrixBytes;
    var pdfBytes = opts.pdfBytes;
    var targetJsonText = opts.targetJsonText || null;
    var warnings = [];

    // 1. Parse matrix
    var matrix = matrixParser.parseMatrix(matrixBytes);
    var matrixRows = matrix.rows;
    if (matrix.warnings.length) {
        for (var w = 0; w < matrix.warnings.length; w++) {
            warnings.push({ stage: 'matrix', detail: matrix.warnings[w] });
        }
    }

    // 2. Detect PDF fields
    var detected = await detectModule.detectFields(pdfBytes);
    var pdfFields = detected.fields;

    // 3. Build PDF field lookup by name (handle duplicates)
    var pdfFieldsMap = {};
    var pdfDupCount = {};
    for (var pi = 0; pi < pdfFields.length; pi++) {
        var pf = pdfFields[pi];
        if (!pdfFieldsMap[pf.name]) {
            pdfFieldsMap[pf.name] = pf;
            pdfDupCount[pf.name] = 1;
        } else {
            pdfDupCount[pf.name]++;
        }
    }

    // 4. Cross-reference matrix rows with PDF fields
    var crossRef = crossReference(matrixRows, pdfFieldsMap);
    if (crossRef.unmatched.length) {
        warnings.push({
            stage: 'cross-reference',
            detail: crossRef.unmatched.length + ' filas de la matriz sin campo PDF correspondiente',
            items: crossRef.unmatched.map(function (u) { return u.acroActual; }),
        });
    }
    if (crossRef.orphanedPdf.length) {
        warnings.push({
            stage: 'cross-reference',
            detail: crossRef.orphanedPdf.length + ' campos del PDF sin fila en la matriz',
            items: crossRef.orphanedPdf,
        });
    }

    // 5. Detect radio groups
    var radioGroups = {};
    for (var ri = 0; ri < matrixRows.length; ri++) {
        var row = matrixRows[ri];
        if (row.grupo) {
            if (!radioGroups[row.grupo]) radioGroups[row.grupo] = [];
            radioGroups[row.grupo].push(ri);
        }
    }

    // 6. Build fields
    var allFields = [];
    var processedRows = new Set();

    for (var grupo in radioGroups) {
        var indices = radioGroups[grupo];
        var groupRows = indices.map(function (idx) { return matrixRows[idx]; });
        var radioFields = fieldBuilder.buildRadioGroup(grupo, groupRows, pdfFieldsMap);
        for (var rf = 0; rf < radioFields.length; rf++) {
            allFields.push({ field: radioFields[rf], matrixRow: groupRows[rf] });
        }
        for (var gi = 0; gi < indices.length; gi++) processedRows.add(indices[gi]);
    }

    for (var mi = 0; mi < matrixRows.length; mi++) {
        if (processedRows.has(mi)) continue;
        var mrow = matrixRows[mi];
        var pdfMatch = crossRef.matches[mrow.acroActual] || null;
        var field = fieldBuilder.buildField(mrow, pdfMatch);
        allFields.push({ field: field, matrixRow: mrow });
    }

    // 7. Add orphaned PDF fields (in PDF but not in matrix) as hidden fields
    for (var oi = 0; oi < crossRef.orphanedPdf.length; oi++) {
        var orphanName = crossRef.orphanedPdf[oi];
        var orphanPf = pdfFieldsMap[orphanName];
        var orphanField = {
            id: fieldBuilder.buildFieldId(orphanName),
            type: orphanPf.type === 'Button' ? 'checkbox' : 'text',
            label: orphanName,
            required: false,
            readOnly: false,
            hidden: true,
            width: 'full',
            sourceMeta: {
                sourceName: orphanPf.name,
                page: orphanPf.page,
                nativeType: orphanPf.type || 'Text',
                rect: { X: orphanPf.x, Y: orphanPf.y, Width: orphanPf.width, Height: orphanPf.height },
            },
            prefillMode: null,
            prefillKey: null,
            salidaJSON: null,
            jsonOutputPath: null,
            excludeFromJson: true,
            conditionalVisibility: null,
            conditionalRequired: null,
            autoFillConcat: null,
            order: 9999,
        };
        if (orphanField.type === 'checkbox') {
            orphanField.checkedPdfValue = true;
            orphanField.checkedJsonValue = true;
        }
        allFields.push({ field: orphanField, matrixRow: { seccionPdf: '' } });
        warnings.push({
            stage: 'orphan-field',
            detail: 'Campo PDF "' + orphanName + '" agregado como oculto (sin fila en la matriz).',
        });
    }

    // 8. Organize into sections
    var fieldsList = allFields.map(function (a) { return a.field; });
    var matrixList = allFields.map(function (a) { return a.matrixRow; });
    var sections = sectionBuilder.organizeIntoSections(fieldsList, matrixList);

    // 9. Build final JSON
    var signframeJson = {
        _meta: {
            generator: 'FormTools Signframe Generator',
            version: 1,
            generatedAt: new Date().toISOString(),
            matrixRows: matrixRows.length,
            pdfFields: pdfFields.length,
            totalFields: fieldsList.length,
        },
        sections: sections,
    };

    // 10. Parse target JSON for validation
    var targetJson = null;
    if (targetJsonText) {
        try { targetJson = JSON.parse(targetJsonText); } catch (e) {
            warnings.push({ stage: 'target-json', detail: 'No se pudo parsear JSON destino: ' + e.message });
        }
    }

    // 11. Validate
    var validation = validator.validate(signframeJson, pdfFields, targetJson);

    return {
        json: signframeJson,
        validation: validation,
        warnings: warnings,
        stats: {
            matrixRows: matrixRows.length,
            pdfFields: pdfFields.length,
            totalFields: fieldsList.length,
            sections: sections.length,
            radioGroups: Object.keys(radioGroups).length,
            orphanedPdf: crossRef.orphanedPdf.length,
            unmatchedMatrix: crossRef.unmatched.length,
        },
    };
}

function crossReference(matrixRows, pdfFieldsMap) {
    var matches = {};
    var unmatched = [];
    var matchedPdfNames = new Set();

    for (var i = 0; i < matrixRows.length; i++) {
        var row = matrixRows[i];
        var acro = row.acroActual;

        if (pdfFieldsMap[acro]) {
            matches[acro] = pdfFieldsMap[acro];
            matchedPdfNames.add(acro);
        } else {
            var normalized = acro.replace(/[\s._-]+/g, '').toLowerCase();
            var found = false;
            for (var pdfName in pdfFieldsMap) {
                var normPdf = pdfName.replace(/[\s._-]+/g, '').toLowerCase();
                if (normPdf === normalized) {
                    matches[acro] = pdfFieldsMap[pdfName];
                    matchedPdfNames.add(pdfName);
                    found = true;
                    break;
                }
            }
            if (!found) {
                unmatched.push(row);
            }
        }
    }

    var orphanedPdf = [];
    for (var name in pdfFieldsMap) {
        if (!matchedPdfNames.has(name)) {
            orphanedPdf.push(name);
        }
    }

    return { matches: matches, unmatched: unmatched, orphanedPdf: orphanedPdf };
}

module.exports = { generateSignframeJson };
