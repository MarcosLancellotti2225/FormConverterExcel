'use strict';

/**
 * Mapa de JSON de un form-definition de Signframe.
 *
 * Recorre TODAS las rutas declaradas en el form-def y reconstruye:
 *   - el JSON de SALIDA que el formulario va a generar (salidaJSON /
 *     jsonOutputPath / salidaJSONSecundaria, respetando excludeFromJson),
 *   - el JSON de ENTRADA que consume para prellenar (prefillKey +
 *     prefillMappings),
 *   - qué campo escribe en cada ruta, y los problemas del contrato.
 *
 * Problemas que detecta (todos vistos en producción):
 *   - Ruta a nodo contenedor: si un campo escribe en `personas[0]` y otro en
 *     `personas[0].nombre`, el primero reemplaza el objeto entero y borra el
 *     subárbol. Es el bug que dejó un payload con 25 hojas en vez de 112.
 *   - Varios campos escribiendo la misma ruta (radios que comparten salida).
 *   - Campos que no van al JSON y tampoco están marcados excludeFromJson.
 */

// ─── Recorrido del form-def ──────────────────────────────────────────────────

function collectFields(json) {
    var sections = json.sections ||
        (json.data && json.data.jsonDefinition && json.data.jsonDefinition.sections) ||
        (json.jsonDefinition && json.jsonDefinition.sections) || [];
    var out = [];
    function walk(node, depth, sectionTitle, path) {
        if (!node || depth > 12) return;
        var fields = node.fields || [];
        for (var i = 0; i < fields.length; i++) {
            out.push({ field: fields[i], section: sectionTitle, container: path });
        }
        var subs = node.subsections || [];
        for (var s = 0; s < subs.length; s++) {
            walk(subs[s], depth + 1, sectionTitle, path + ' / ' + (subs[s].title || subs[s].id || 'sub'));
        }
    }
    for (var k = 0; k < sections.length; k++) {
        var title = sections[k].title || sections[k].id || ('Sección ' + (k + 1));
        walk(sections[k], 0, title, title);
    }
    return { fields: out, sectionCount: sections.length };
}

// ─── Parseo de rutas ─────────────────────────────────────────────────────────

/**
 * "datosFormulario.personas[0].nombre" →
 *   [{key:'datosFormulario'},{key:'personas',index:0},{key:'nombre'}]
 * Soporta también "personas[]" (índice abierto).
 */
function parsePath(path) {
    var clean = String(path || '').trim();
    if (!clean) return null;
    var segs = [];
    var parts = clean.split('.');
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        var m = p.match(/^([^[\]]+)((\[\d*\])+)$/);
        if (!m) { segs.push({ key: p, index: null }); continue; }
        var key = m[1];
        var idxs = m[2].match(/\[(\d*)\]/g) || [];
        for (var j = 0; j < idxs.length; j++) {
            var num = idxs[j].replace(/[[\]]/g, '');
            segs.push({ key: j === 0 ? key : null, index: num === '' ? -1 : Number(num) });
        }
    }
    return segs.length ? segs : null;
}

// El prefillKey puede traer una condición: "ruta==valor". La ruta es lo de antes.
function splitPrefillKey(key) {
    var s = String(key || '').trim();
    var m = s.match(/^(.*?)(==|!=)(.*)$/);
    if (!m) return { path: s, condition: null };
    return { path: m[1].trim(), condition: m[2] + m[3].trim() };
}

// ─── Valor representativo por campo ──────────────────────────────────────────

function sampleValue(field, pathEntry) {
    var t = String(field.type || 'text').toLowerCase();
    // Valores explícitos declarados en el form-def
    var explicit = [];
    if (pathEntry && pathEntry.values && pathEntry.values.length) explicit = pathEntry.values;

    if (explicit.length) {
        var uniq = explicit.filter(function (v, i) { return explicit.indexOf(v) === i; });
        if (uniq.length === 1) return uniq[0];
        return '<' + t + ': ' + uniq.slice(0, 6).join(' | ') + (uniq.length > 6 ? ' | …' : '') + '>';
    }
    if (t === 'checkbox') return '<boolean>';
    if (t === 'date') return '<date ' + (field.jsonDateFormat || field.dateFormat || 'dd/MM/yyyy') + '>';
    if (t === 'number') return '<number>';
    if (t === 'signature') return '<signature>';
    if (t === 'select' || t === 'radio') {
        var opts = (field.options || []).map(function (o) {
            return o && typeof o === 'object' ? (o.value != null ? o.value : o.label) : o;
        }).filter(function (x) { return x != null && x !== ''; });
        if (opts.length) return '<' + t + ': ' + opts.slice(0, 6).join(' | ') + (opts.length > 6 ? ' | …' : '') + '>';
    }
    return '<' + t + '>';
}

// ─── Construcción del árbol ──────────────────────────────────────────────────

function setPath(root, segs, value) {
    var node = root;
    for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        var isLast = i === segs.length - 1;
        var key = seg.key;

        if (key != null) {
            if (seg.index == null) {
                if (isLast) { node[key] = value; return; }
                if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) {
                    node[key] = {};
                }
                node = node[key];
            } else {
                if (!Array.isArray(node[key])) node[key] = [];
                var arr = node[key];
                var idx = seg.index === -1 ? 0 : seg.index;
                if (isLast) { arr[idx] = value; return; }
                if (typeof arr[idx] !== 'object' || arr[idx] === null) arr[idx] = {};
                node = arr[idx];
            }
        } else {
            // índice encadenado: a[0][1]
            var idx2 = seg.index === -1 ? 0 : seg.index;
            if (!Array.isArray(node)) return;
            if (isLast) { node[idx2] = value; return; }
            if (typeof node[idx2] !== 'object' || node[idx2] === null) node[idx2] = {};
            node = node[idx2];
        }
    }
}

// Rellena los huecos de los arrays dispersos (personas[0] y personas[2]).
function fillHoles(node) {
    if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
            if (node[i] === undefined) node[i] = null;
            else fillHoles(node[i]);
        }
    } else if (node && typeof node === 'object') {
        for (var k in node) if (Object.prototype.hasOwnProperty.call(node, k)) fillHoles(node[k]);
    }
    return node;
}

// ─── Análisis principal ──────────────────────────────────────────────────────

function analyzeFormDef(json) {
    var collected = collectFields(json);
    var all = collected.fields;

    var outPaths = {};   // path -> { path, fields:[], values:[], types:{}, secondary:bool }
    var inPaths = {};    // path -> { path, fields:[], conditions:[] }
    var noOutput = [];   // campos sin ruta de salida ni excludeFromJson
    var excluded = 0;
    var repeaters = [];

    function addOut(path, field, meta) {
        var p = String(path).trim();
        if (!p) return;
        if (!outPaths[p]) outPaths[p] = { path: p, fields: [], values: [], types: {}, secondary: false };
        var e = outPaths[p];
        e.fields.push({ id: field.id, label: field.label, type: field.type, section: meta.section });
        e.types[field.type || 'text'] = true;
        if (meta.secondary) e.secondary = true;
        // valores concretos que este campo escribe
        [field.jsonValue, field.jsonValueSecundario, field.checkedJsonValue].forEach(function (v) {
            if (v !== undefined && v !== null && v !== '') e.values.push(v);
        });
    }

    function addIn(key, field, meta) {
        var sp = splitPrefillKey(key);
        if (!sp.path) return;
        if (!inPaths[sp.path]) inPaths[sp.path] = { path: sp.path, fields: [], conditions: [] };
        var e = inPaths[sp.path];
        e.fields.push({ id: field.id, label: field.label, type: field.type, section: meta.section, mode: field.prefillMode || null });
        if (sp.condition) e.conditions.push(sp.condition);
    }

    for (var i = 0; i < all.length; i++) {
        var f = all[i].field;
        var meta = { section: all[i].section };

        // ── SALIDA ────────────────────────────────────────────────────────────
        var primary = f.salidaJSON || f.jsonOutputPath || '';
        var isExcluded = f.excludeFromJson === true;
        if (isExcluded) excluded++;
        if (primary && !isExcluded) addOut(primary, f, meta);
        if (f.salidaJSONSecundaria && !isExcluded) {
            addOut(f.salidaJSONSecundaria, f, { section: meta.section, secondary: true });
        }
        if (!primary && !isExcluded && f.type !== 'header' && f.type !== 'paragraph') {
            noOutput.push({ id: f.id, label: f.label, type: f.type, section: meta.section });
        }

        // Repeater: sus subcampos escriben dentro del array de la ruta base.
        if (f.repeaterConfig && primary) {
            var subs = (f.repeaterConfig.fields || []).map(function (sf) {
                return { id: sf.id, type: sf.type, label: sf.label };
            });
            repeaters.push({
                id: f.id, label: f.label, path: primary,
                itemLabel: f.repeaterConfig.itemLabel || null,
                minItems: f.repeaterConfig.minItems, maxItems: f.repeaterConfig.maxItems,
                subfields: subs,
            });
            for (var s = 0; s < subs.length; s++) {
                addOut(primary + '[0].' + subs[s].id,
                    { id: f.id + '.' + subs[s].id, label: subs[s].label, type: subs[s].type }, meta);
            }
        }

        // ── ENTRADA ───────────────────────────────────────────────────────────
        if (f.prefillKey) addIn(f.prefillKey, f, meta);
        ['signatureSignerNamePrefillKey', 'signatureCcPrefillKey', 'signatureCcNamesPrefillKey'].forEach(function (k) {
            if (f[k]) addIn(f[k], f, meta);
        });
    }

    // prefillMappings a nivel documento
    var mappings = json.prefillMappings;
    if (Array.isArray(mappings)) {
        for (var m = 0; m < mappings.length; m++) {
            var mp = mappings[m];
            var key = typeof mp === 'string' ? mp : (mp && (mp.prefillKey || mp.source || mp.path));
            if (key) addIn(key, { id: (mp && mp.fieldId) || '(prefillMappings)', label: '(mapping)', type: 'mapping' }, { section: 'prefillMappings' });
        }
    } else if (mappings && typeof mappings === 'object') {
        for (var mk in mappings) {
            if (!Object.prototype.hasOwnProperty.call(mappings, mk)) continue;
            addIn(mappings[mk] || mk, { id: mk, label: '(mapping)', type: 'mapping' }, { section: 'prefillMappings' });
        }
    }

    // ── Árboles ───────────────────────────────────────────────────────────────
    var outputTree = {};
    var outList = Object.keys(outPaths).map(function (p) { return outPaths[p]; });
    outList.sort(function (a, b) { return a.path.localeCompare(b.path); });
    for (var o = 0; o < outList.length; o++) {
        var segs = parsePath(outList[o].path);
        if (!segs) continue;
        var repField = outList[o].fields[0] || {};
        setPath(outputTree, segs, sampleValue(repField, outList[o]));
    }

    var inputTree = {};
    var inList = Object.keys(inPaths).map(function (p) { return inPaths[p]; });
    inList.sort(function (a, b) { return a.path.localeCompare(b.path); });
    for (var n = 0; n < inList.length; n++) {
        var segs2 = parsePath(inList[n].path);
        if (!segs2) continue;
        var rf = inList[n].fields[0] || {};
        setPath(inputTree, segs2, sampleValue(rf, null));
    }

    fillHoles(outputTree);
    fillHoles(inputTree);

    // ── Problemas ─────────────────────────────────────────────────────────────
    var issues = [];

    // 1) Ruta a nodo contenedor: una ruta es prefijo de otra → borra el subárbol.
    //    Un repeater es la excepción: declara el array y sus subcampos escriben
    //    dentro (`ruta[0].sub`), que es exactamente lo que tiene que pasar.
    var repeaterPaths = {};
    for (var rp = 0; rp < repeaters.length; rp++) repeaterPaths[repeaters[rp].path] = true;

    var pathSet = outList.map(function (e) { return e.path; });
    for (var a = 0; a < pathSet.length; a++) {
        var pa = pathSet[a];
        for (var b = 0; b < pathSet.length; b++) {
            if (a === b) continue;
            var pb = pathSet[b];
            var childObject = pb.indexOf(pa + '.') === 0;          // alguien pisa un objeto
            var childArray = pb.indexOf(pa + '[') === 0;           // alguien pisa un array
            if (childArray && repeaterPaths[pa]) continue;         // repeater: es correcto
            if (childObject && repeaterPaths[pa]) {
                // El mismo nodo se usa como array (repeater) y como objeto.
                issues.push({
                    severity: 'critical',
                    type: 'array-y-objeto',
                    path: pa,
                    detail: 'Se usa como array (repeater) y como objeto a la vez: también recibe "' + pb +
                        '". Un nodo no puede ser las dos cosas — una de las dos ramas se pierde.',
                    fields: outPaths[pa].fields.map(function (x) { return x.id; }),
                });
                break;
            }
            if (childObject || childArray) {
                issues.push({
                    severity: 'critical',
                    type: 'contenedor',
                    path: pa,
                    detail: 'Escribe en un nodo contenedor: reemplaza el objeto entero y borra "' + pb + '" y el resto del subárbol.',
                    fields: outPaths[pa].fields.map(function (x) { return x.id; }),
                });
                break;
            }
        }
    }

    // 2) Varios campos escribiendo la misma ruta.
    for (var c = 0; c < outList.length; c++) {
        var e2 = outList[c];
        if (e2.fields.length <= 1) continue;
        var types = Object.keys(e2.types);
        var isOptionGroup = types.length === 1 && (types[0] === 'radio' || types[0] === 'checkbox');
        var detail;
        if (isOptionGroup) {
            detail = e2.fields.length + ' opciones del mismo grupo escriben esta ruta: es lo esperado.';
        } else if (types.length === 1) {
            detail = e2.fields.length + ' campos "' + types[0] + '" escriben la misma ruta: el último en completarse pisa al anterior.';
        } else {
            detail = e2.fields.length + ' campos de tipos distintos (' + types.join(', ') + ') escriben la misma ruta: revisar cuál gana.';
        }
        issues.push({
            severity: isOptionGroup ? 'info' : 'warning',
            type: 'ruta-compartida',
            path: e2.path,
            detail: detail,
            fields: e2.fields.map(function (x) { return x.id; }),
        });
    }

    // 3) Campos sin salida ni excludeFromJson.
    if (noOutput.length) {
        issues.push({
            severity: 'warning',
            type: 'sin-ruta',
            path: null,
            detail: noOutput.length + ' campo(s) no escriben al JSON y tampoco están marcados excludeFromJson.',
            fields: noOutput.slice(0, 30).map(function (x) { return x.id; }),
        });
    }

    issues.sort(function (x, y) {
        var rank = { critical: 0, warning: 1, info: 2 };
        return (rank[x.severity] - rank[y.severity]) || String(x.path).localeCompare(String(y.path));
    });

    return {
        meta: {
            version: json.version || null,
            sourcePdf: (json._sourcePdf && json._sourcePdf.fileName) || null,
            sections: collected.sectionCount,
            fields: all.length,
            excluded: excluded,
        },
        output: { tree: outputTree, paths: outList, count: outList.length },
        input: { tree: inputTree, paths: inList, count: inList.length },
        repeaters: repeaters,
        issues: issues,
        stats: {
            outputPaths: outList.length,
            inputPaths: inList.length,
            excluded: excluded,
            withoutOutput: noOutput.length,
            repeaters: repeaters.length,
            critical: issues.filter(function (i2) { return i2.severity === 'critical'; }).length,
            warnings: issues.filter(function (i2) { return i2.severity === 'warning'; }).length,
        },
    };
}

module.exports = { analyzeFormDef, parsePath, splitPrefillKey };
