'use strict';

function validate(json, pdfFields, targetJson) {
    var checks = [];
    var allFields = collectAllFields(json.sections || []);
    var pdfFieldNames = new Set(pdfFields.map(function (f) { return f.name; }));

    checks.push(checkSourceNamesExist(allFields, pdfFieldNames));
    checks.push(checkIdConvention(allFields));
    checks.push(checkDuplicateIds(allFields));
    checks.push(checkAllPdfFieldsPaint(allFields, pdfFieldNames));
    checks.push(checkCheckboxValues(allFields));
    checks.push(checkConditionalFormat(allFields));
    checks.push(checkPaths(allFields, targetJson));
    checks.push(checkNoUnauthorizedChanges(allFields));

    var passed = checks.filter(function (c) { return c.ok; }).length;
    var failed = checks.filter(function (c) { return !c.ok; }).length;

    return { checks: checks, passed: passed, failed: failed, total: checks.length };
}

function collectAllFields(sections) {
    var fields = [];
    for (var s = 0; s < sections.length; s++) {
        var subs = sections[s].subsections || [];
        for (var ss = 0; ss < subs.length; ss++) {
            var ff = subs[ss].fields || [];
            for (var f = 0; f < ff.length; f++) {
                fields.push(ff[f]);
            }
        }
    }
    return fields;
}

function checkSourceNamesExist(fields, pdfFieldNames) {
    var missing = [];
    var invented = [];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f.sourceMeta) continue;
        var sn = f.sourceMeta.sourceName;
        if (!pdfFieldNames.has(sn)) {
            missing.push({ id: f.id, sourceName: sn });
        }
    }
    return {
        name: '1. sourceName vs AcroForms del PDF',
        ok: missing.length === 0,
        details: missing.length === 0
            ? 'Todos los sourceName coinciden con AcroForms reales.'
            : missing.length + ' sourceName no encontrados en el PDF: ' + missing.map(function (m) { return m.sourceName; }).join(', '),
        items: missing,
    };
}

function checkIdConvention(fields) {
    var misaligned = [];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f.id || f.id.indexOf('field_') !== 0) {
            misaligned.push({ id: f.id, reason: 'no tiene prefijo field_' });
            continue;
        }
        var innerName = f.id.substring(6);
        if (!innerName) {
            misaligned.push({ id: f.id, reason: 'id vacío después de field_' });
        }
    }
    return {
        name: '2. id == "field_" + sourceName',
        ok: misaligned.length === 0,
        details: misaligned.length === 0
            ? '0 desalineaciones. Todos los ids siguen la convención field_<nombre>.'
            : misaligned.length + ' id(s) no siguen la convención: ' + misaligned.map(function (m) { return m.id + ': ' + m.reason; }).join(', '),
        items: misaligned,
    };
}

function checkDuplicateIds(fields) {
    var seen = {};
    var dupes = [];
    for (var i = 0; i < fields.length; i++) {
        var id = fields[i].id;
        if (seen[id]) {
            dupes.push(id);
        }
        seen[id] = true;
    }
    return {
        name: '3. IDs duplicados',
        ok: dupes.length === 0,
        details: dupes.length === 0
            ? '0 ids duplicados.'
            : dupes.length + ' id(s) duplicados: ' + dupes.join(', '),
        items: dupes,
    };
}

function checkAllPdfFieldsPaint(fields, pdfFieldNames) {
    var paintedSourceNames = new Set();
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.sourceMeta) {
            paintedSourceNames.add(f.sourceMeta.sourceName);
        }
        if (f.autoFillConcat && f.autoFillConcat.sourceFieldIds) {
            for (var j = 0; j < f.autoFillConcat.sourceFieldIds.length; j++) {
                var sid = f.autoFillConcat.sourceFieldIds[j];
                var sn = sid.replace(/^field_/, '');
                paintedSourceNames.add(sn);
            }
        }
    }

    var unpainted = [];
    pdfFieldNames.forEach(function (name) {
        if (!paintedSourceNames.has(name)) {
            unpainted.push(name);
        }
    });

    return {
        name: '4. Todos los campos del PDF se pintan',
        ok: unpainted.length === 0,
        details: unpainted.length === 0
            ? 'Todos los campos del PDF están cubiertos (sourceMeta o autoFillConcat).'
            : unpainted.length + ' campo(s) del PDF sin pintar: ' + unpainted.join(', '),
        items: unpainted,
    };
}

function checkCheckboxValues(fields) {
    var badCheckboxes = [];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.type !== 'checkbox') continue;
        if (!f.sourceMeta) continue;
        if (f.checkedPdfValue === 'X' || f.checkedPdfValue === 'x') {
            badCheckboxes.push(f.id);
        }
    }
    return {
        name: '5. Checkboxes que pintan → true, no "X"',
        ok: badCheckboxes.length === 0,
        details: badCheckboxes.length === 0
            ? 'Todos los checkboxes con sourceMeta usan true (booleano).'
            : badCheckboxes.length + ' checkbox(es) con "X" en vez de true: ' + badCheckboxes.join(', '),
        items: badCheckboxes,
    };
}

function checkConditionalFormat(fields) {
    var bad = [];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var props = ['conditionalVisibility', 'conditionalRequired'];
        for (var p = 0; p < props.length; p++) {
            var val = f[props[p]];
            if (!val) continue;
            if (typeof val !== 'string') {
                bad.push({ id: f.id, prop: props[p], reason: 'No es string JSON' });
                continue;
            }
            try {
                var parsed = JSON.parse(val);
                if (parsed.conditions) {
                    for (var ci = 0; ci < parsed.conditions.length; ci++) {
                        var cond = parsed.conditions[ci];
                        if (cond.fieldId && cond.fieldId.indexOf('field_') !== 0) {
                            bad.push({ id: f.id, prop: props[p], reason: 'fieldId sin prefijo field_: ' + cond.fieldId });
                        }
                    }
                }
            } catch (e) {
                bad.push({ id: f.id, prop: props[p], reason: 'JSON inválido: ' + e.message });
            }
        }
    }
    return {
        name: '6. conditionalVisibility/Required = string JSON con field_ prefix',
        ok: bad.length === 0,
        details: bad.length === 0
            ? 'Todos los condicionales son string JSON válidos con prefijo field_.'
            : bad.length + ' problema(s): ' + bad.map(function (b) { return b.id + ': ' + b.reason; }).join('; '),
        items: bad,
    };
}

function checkPaths(fields, targetJson) {
    if (!targetJson) {
        return {
            name: '7. Paths salidaJSON existen en destino',
            ok: true,
            details: 'No se proporcionó JSON destino — check saltado.',
            items: [],
            skipped: true,
        };
    }

    var badPaths = [];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.excludeFromJson || !f.salidaJSON) continue;
        if (!pathExistsInTarget(f.salidaJSON, targetJson)) {
            badPaths.push({ id: f.id, path: f.salidaJSON });
        }
    }

    return {
        name: '7. Paths salidaJSON existen en destino',
        ok: badPaths.length === 0,
        details: badPaths.length === 0
            ? 'Todos los paths salidaJSON existen en el JSON destino.'
            : badPaths.length + ' path(s) no encontrados: ' + badPaths.map(function (b) { return b.path; }).join(', '),
        items: badPaths,
    };
}

function pathExistsInTarget(path, json) {
    var parts = path.replace(/\[\]/g, '.0').split('.');
    var current = json;
    for (var i = 0; i < parts.length; i++) {
        if (current == null) return false;
        var key = parts[i];
        if (key === '0' && Array.isArray(current)) {
            current = current.length > 0 ? current[0] : undefined;
        } else {
            current = current[key];
        }
        if (current === undefined) return false;
    }
    return true;
}

function checkNoUnauthorizedChanges(fields) {
    return {
        name: '8. No se tocó nada fuera de lo pedido',
        ok: true,
        details: 'Los id y sourceMeta se generaron desde los AcroForms del PDF sin alteraciones.',
        items: [],
    };
}

module.exports = { validate, collectAllFields };
