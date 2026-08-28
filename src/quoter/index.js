'use strict';

/**
 * Cotizador de Formularios.
 *
 * Recibe un ZIP con los insumos de un formulario (PDFs, Excels de reglas de
 * negocio con múltiples pestañas, JSONs de definición) y devuelve:
 *   - el inventario completo del ZIP (qué hay adentro),
 *   - los números que importan: campos del PDF y reglas de negocio del Excel,
 *   - un score ponderado y la complejidad: Baja / Media / Alta.
 *
 * Todo client-side. Cada archivo se analiza con try/catch: uno roto no tumba
 * el análisis completo (queda listado con su error).
 */

var JSZip = require('jszip');
var XLSX = require('xlsx');
var { detectFields } = require('../pdf-detect/index');

// ─── Configuración (pesos y umbrales) ────────────────────────────────────────
// Editable desde la UI para calibrar la cotización.

var DEFAULT_CONFIG = {
    weights: {
        pdfField: 1,          // cada campo AcroForm del PDF
        pdfPage: 2,           // cada página de formulario
        businessRule: 2.5,    // cada regla de negocio del Excel
        conditionalRule: 6,   // visibilidad condicional (más cara)
        repeater: 10,         // bloques repetidos (dependientes/beneficiarios)
        catalogItem: 0.2,     // ítems de catálogo (listas)
        catalog: 5,           // cada catálogo distinto
        extraForm: 40,        // cada PDF extra (más de uno = más integración)
    },
    // Calibrado con un caso real: Fidelidad (202 campos, 344 reglas, 25
    // catálogos, 4 págs) = complejidad Media. Ajustable desde la UI.
    thresholds: { baja: 500, media: 1800 },   // <=baja, <=media, resto alta
    hoursPerPoint: 0.035,                       // estimación de esfuerzo
    // Cuánto cuesta lo ya resuelto (repetido dentro del form o compartido con
    // otra variante): 0.15 = 15% del esfuerzo normal.
    reuseFactor: 0.15,
};

/**
 * Normaliza los umbrales aceptando el nombrado viejo (facil/medio) además del
 * actual (baja/media), para no romper configuraciones ya guardadas.
 */
function normalizeThresholds(t) {
    if (!t) return null;
    var baja = t.baja != null ? t.baja : t.facil;
    var media = t.media != null ? t.media : t.medio;
    if (baja == null && media == null) return null;
    return {
        baja: baja != null ? baja : DEFAULT_CONFIG.thresholds.baja,
        media: media != null ? media : DEFAULT_CONFIG.thresholds.media,
    };
}

/**
 * Ajusta los umbrales para que un proyecto de `points` caiga en `targetLevel`
 * (baja / media / alta). Sirve para calibrar con casos reales ("este me salió
 * media") sin adivinar. Deja el caso centrado en su banda, no pegado al borde.
 */
function calibrateThresholds(points, targetLevel, current) {
    var cur = normalizeThresholds(current) || DEFAULT_CONFIG.thresholds;
    var th = { baja: cur.baja, media: cur.media };
    var lvl = String(targetLevel || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    var round = function (n) { return Math.max(10, Math.round(n / 10) * 10); };

    // Se aceptan también los nombres viejos (fácil / complejo).
    if (lvl.indexOf('baja') === 0 || lvl.indexOf('facil') === 0) {
        th.baja = round(points * 1.3);               // el caso queda holgado en Baja
        if (th.media <= th.baja) th.media = round(th.baja * 3);
    } else if (lvl.indexOf('alta') === 0 || lvl.indexOf('complej') === 0) {
        th.media = round(points * 0.8);              // el caso supera el corte de Media
        if (th.baja >= th.media) th.baja = round(th.media * 0.35);
    } else {
        th.baja = round(points * 0.55);              // Media: centrado entre cortes
        th.media = round(points * 1.45);
    }
    return th;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extOf(name) {
    var m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
}

function baseName(path) {
    var parts = String(path).split('/');
    return parts[parts.length - 1];
}

function isJunk(path) {
    var p = String(path);
    return p.indexOf('__MACOSX/') === 0 || /(^|\/)\._/.test(p) || /(^|\/)\.DS_Store$/.test(p);
}

function fmtBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// ─── Excel: reglas de negocio por pestaña ────────────────────────────────────

// Columnas que representan lógica de negocio a implementar.
var RULE_COL_PATTERNS = [
    { key: 'regla', rx: /^regla|regla\s+original|regla\s+de\s+negocio|validaci[oó]n/i, weightKey: 'businessRule' },
    { key: 'visualizacion', rx: /visualizaci[oó]n|visibilidad|condici[oó]n|mostrar\s+si|depende/i, weightKey: 'conditionalRule' },
    { key: 'obligatorio', rx: /obligatorio|requerido/i, weightKey: 'businessRule' },
    { key: 'valor', rx: /^valor|valores|opciones/i, weightKey: 'businessRule' },
    { key: 'formato', rx: /formato|m[aá]scara|patr[oó]n/i, weightKey: 'businessRule' },
    { key: 'observaciones', rx: /observacion/i, weightKey: 'businessRule' },
];

// Columnas que identifican una fila como "campo del formulario".
var FIELD_COL_RX = /nombre.*campo|campo.*formulario|etiqueta|nombre\s+en\s+pdf|sourcename|acroform/i;

var CATALOG_SHEET_RX = /cat[aá]logo|catalogo|lista|tabla|valores|dominio/i;

// Hojas que NO son insumo de trabajo: output ya generado, índices, portadas.
// (En las Fichas reales hay una hoja "JSON Generado" con cientos de filas que
// es el resultado, no reglas a implementar.)
var IGNORED_SHEET_RX = /json\s*generado|generado|output|resultado|instructivo|portada|[ií]ndice|estructura\s+base|readme|ejemplo/i;

// Un texto es una condición real si expresa dependencia, no un simple modo de
// campo ("editable", "input del usuario", "Disabled / Visible / Dato Prellenado").
var CONDITION_RX = /\bsi\s|\bsi:|\bcuando\b|depende|seg[uú]n|solo\s+(si|cuando|para)|en\s+caso\s+de|aplica\s+si|visible\s+si|mostrar\s+si|oculta?r?\s+si|>=|<=|=\s*['"]?s[ií]/i;

// Valores de "Obligatorio" que realmente significan obligatorio.
var YES_RX = /^(s[ií]|si\b|yes|true|x|obligatorio)$/i;

// Referencia a un catálogo externo desde la celda de Valor.
var CATALOG_REF_RX = /ver\s+cat[aá]logo|cat[aá]logo\s+adjunto|ver\s+lista/i;

function analyzeSheet(ws, sheetName) {
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    var out = {
        name: sheetName,
        rows: 0,
        columns: 0,
        fieldRows: 0,
        businessRules: 0,
        conditionalRules: 0,
        catalogRefs: 0,
        fieldKeys: [],
        ruleColumns: [],
        isCatalog: false,
        catalogItems: 0,
        ignored: false,
        empty: true,
    };
    if (!raw.length) return out;

    // Hoja de output/índice: se lista pero no aporta números (no es trabajo).
    if (IGNORED_SHEET_RX.test(sheetName)) {
        out.ignored = true;
        out.rows = raw.filter(function (r) {
            return (r || []).some(function (c) { return String(c == null ? '' : c).trim(); });
        }).length;
        out.empty = out.rows === 0;
        return out;
    }

    // Buscar la fila de headers: la de más celdas no vacías entre las primeras 8.
    var headerIdx = 0, bestCount = -1;
    for (var h = 0; h < Math.min(8, raw.length); h++) {
        var cnt = (raw[h] || []).filter(function (c) { return String(c || '').trim(); }).length;
        if (cnt > bestCount) { bestCount = cnt; headerIdx = h; }
    }
    var headers = (raw[headerIdx] || []).map(function (c) { return String(c || '').trim(); });
    out.columns = headers.filter(Boolean).length;

    // Mapear columnas de reglas y de campo.
    var ruleCols = [];   // {index, key, weightKey}
    var fieldCols = [];
    for (var c = 0; c < headers.length; c++) {
        var head = headers[c];
        if (!head) continue;
        for (var p = 0; p < RULE_COL_PATTERNS.length; p++) {
            if (RULE_COL_PATTERNS[p].rx.test(head)) {
                ruleCols.push({ index: c, key: RULE_COL_PATTERNS[p].key, weightKey: RULE_COL_PATTERNS[p].weightKey, header: head });
                break;
            }
        }
        if (FIELD_COL_RX.test(head)) fieldCols.push(c);
    }
    out.ruleColumns = ruleCols.map(function (r) { return r.header; });

    // Contar filas con datos, filas de campo y celdas de regla no vacías.
    var dataRows = 0;
    for (var i = headerIdx + 1; i < raw.length; i++) {
        var row = raw[i] || [];
        var hasData = row.some(function (cell) { return String(cell == null ? '' : cell).trim(); });
        if (!hasData) continue;
        dataRows++;

        var isField = fieldCols.length
            ? fieldCols.some(function (fc) { return String(row[fc] == null ? '' : row[fc]).trim(); })
            : false;
        if (isField) {
            out.fieldRows++;
            // Clave normalizada del campo, para cruzar reutilización entre
            // formularios (el abreviado repite casi todo el completo).
            var keyParts = fieldCols.map(function (fc) { return norm(row[fc]); }).filter(Boolean);
            if (keyParts.length) out.fieldKeys.push(keyParts.join('|'));
        }

        for (var r2 = 0; r2 < ruleCols.length; r2++) {
            var col = ruleCols[r2];
            var val = String(row[col.index] == null ? '' : row[col.index]).trim();
            if (!val) continue;
            var nv = norm(val);
            // Ruido: negativos, no aplica, guiones.
            if (nv === 'no' || nv === 'n/a' || nv === '-' || nv === 'na' || nv === 'no aplica' || nv === 'ninguna') continue;

            if (col.key === 'obligatorio') {
                // En las Fichas reales esta columna a veces trae "Both"/"JSON"
                // (a qué aplica), no sí/no. Solo cuenta si es realmente "Sí".
                if (YES_RX.test(val)) out.businessRules++;
                continue;
            }
            if (col.key === 'visualizacion') {
                // "editable / input del usuario" o "Disabled / Visible" es el modo
                // del campo, no una condición. Solo cuenta si expresa dependencia.
                if (CONDITION_RX.test(val)) out.conditionalRules++;
                else out.businessRules++;   // igual es config a implementar
                continue;
            }
            if (col.key === 'observaciones') {
                // Observación con condición → condicional; si no, regla.
                if (CONDITION_RX.test(val)) out.conditionalRules++;
                else out.businessRules++;
                continue;
            }
            if (col.key === 'valor' && CATALOG_REF_RX.test(val)) {
                out.catalogRefs++;
                out.businessRules++;
                continue;
            }
            // Una "Regla" que expresa dependencia ("Solo en el caso de que...")
            // es lógica condicional, más cara que una validación plana.
            if (col.key === 'regla' && CONDITION_RX.test(val)) { out.conditionalRules++; continue; }
            out.businessRules++;
        }
    }
    out.rows = dataRows;
    out.empty = dataRows === 0;

    // ¿Es una hoja de catálogo? Por nombre, o pocas columnas + muchas filas sin
    // columnas de regla.
    var looksCatalog = CATALOG_SHEET_RX.test(sheetName) ||
        (ruleCols.length === 0 && out.columns > 0 && out.columns <= 3 && dataRows >= 5);
    if (looksCatalog) {
        out.isCatalog = true;
        out.catalogItems = dataRows;
        // Un catálogo no aporta "reglas": son datos.
        out.businessRules = 0;
        out.conditionalRules = 0;
    }
    return out;
}

function analyzeExcel(bytes, fileName) {
    var wb = XLSX.read(bytes, { type: 'array' });
    var sheets = [];
    var businessRules = 0, conditionalRules = 0, catalogs = 0, catalogItems = 0, fieldRows = 0;
    var catalogRefNames = {}, ignoredSheets = 0, allFieldKeys = [];
    for (var s = 0; s < wb.SheetNames.length; s++) {
        var nm = wb.SheetNames[s];
        var info;
        try { info = analyzeSheet(wb.Sheets[nm], nm); }
        catch (e) { info = { name: nm, error: e.message, rows: 0, businessRules: 0, conditionalRules: 0 }; }
        sheets.push(info);
        if (info.ignored) { ignoredSheets++; continue; }
        businessRules += info.businessRules || 0;
        conditionalRules += info.conditionalRules || 0;
        fieldRows += info.fieldRows || 0;
        if (info.isCatalog) { catalogs++; catalogItems += info.catalogItems || 0; }
        if (info.catalogRefs) catalogRefNames[nm] = info.catalogRefs;
        if (info.fieldKeys) allFieldKeys = allFieldKeys.concat(info.fieldKeys);
    }
    // Catálogos referenciados desde "Valor" ("Ver catálogo") que no son hoja.
    var refTotal = 0;
    for (var k in catalogRefNames) if (catalogRefNames.hasOwnProperty(k)) refTotal += catalogRefNames[k];

    return {
        file: fileName,
        type: 'excel',
        sheetCount: wb.SheetNames.length,
        ignoredSheets: ignoredSheets,
        sheets: sheets,
        businessRules: businessRules,
        conditionalRules: conditionalRules,
        fieldRows: fieldRows,
        catalogs: catalogs,
        catalogItems: catalogItems,
        catalogRefs: refTotal,
        fieldKeys: allFieldKeys,
    };
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function analyzePdf(bytes, fileName) {
    var det = await detectFields(bytes);
    var byType = {};
    for (var i = 0; i < det.fields.length; i++) {
        var t = det.fields[i].type || 'Desconocido';
        byType[t] = (byType[t] || 0) + 1;
    }
    // Campos indexados [n] → indicio de bloques repetidos
    var repeaterRoots = {};
    for (var j = 0; j < det.fields.length; j++) {
        var m = String(det.fields[j].name || '').match(/^(.*?)\[\d+\]$/);
        if (m) repeaterRoots[m[1]] = true;
    }
    // Configuraciones únicas: los campos indexados de un mismo grupo
    // (dep[0..4]) se configuran UNA vez, no cinco.
    var configKeys = {};
    var names = [];
    for (var k = 0; k < det.fields.length; k++) {
        var nm = String(det.fields[k].name || '');
        names.push(nm);
        configKeys[nm.replace(/\[\d+\]$/, '')] = true;
    }

    return {
        file: fileName,
        type: 'pdf',
        pages: det.stats.pages,
        fieldCount: det.fields.length,
        byType: byType,
        repeaterGroups: Object.keys(repeaterRoots).length,
        uniqueConfigs: Object.keys(configKeys).length,
        fieldNames: names,
    };
}

// ─── JSON (form-def de Signframe u otro) ─────────────────────────────────────

function analyzeJson(text, fileName) {
    var json = JSON.parse(text);
    var out = { file: fileName, type: 'json', kind: 'genérico', sections: 0, fields: 0, repeaters: 0, lookups: 0, conditionals: 0, autoFill: 0 };

    var sections = json.sections || (json.data && json.data.jsonDefinition && json.data.jsonDefinition.sections) ||
        (json.jsonDefinition && json.jsonDefinition.sections) || null;
    if (!sections) {
        // JSON que no es form-def: reportar tamaño de estructura
        out.kind = 'datos';
        out.topLevelKeys = Object.keys(json).length;
        return out;
    }
    out.kind = 'form-def';
    out.sections = sections.length;

    // Los campos pueden colgar de la sección y/o de sus subsecciones (que a su
    // vez pueden anidar). Ojo: subsections suele venir como [] (truthy) con los
    // fields en la sección — hay que recorrer ambos, no elegir uno.
    function walk(node, depth) {
        if (!node || depth > 10) return;
        var fields = node.fields || [];
        for (var f = 0; f < fields.length; f++) {
            var fl = fields[f];
            out.fields++;
            if (fl.type === 'repeater') out.repeaters++;
            if (fl.conditionalVisibility || fl.conditionalRequired) out.conditionals++;
            if (fl.autoFillConcat) {
                out.autoFill++;
                var parts = (fl.autoFillConcat.parts || []);
                for (var p = 0; p < parts.length; p++) {
                    if (parts[p].type === 'repeaterLookup') { out.lookups++; break; }
                }
            }
        }
        var subs = node.subsections || [];
        for (var ss = 0; ss < subs.length; ss++) walk(subs[ss], depth + 1);
    }
    for (var s = 0; s < sections.length; s++) {
        walk(sections[s], 0);
        if (sections[s].conditionalVisibility) out.conditionals++;
    }

    // Reglas declaradas a nivel documento (también son lógica a implementar).
    out.validationRules = Array.isArray(json.validationRules) ? json.validationRules.length : 0;
    out.prefillMappings = Array.isArray(json.prefillMappings) ? json.prefillMappings.length
        : (json.prefillMappings && typeof json.prefillMappings === 'object' ? Object.keys(json.prefillMappings).length : 0);
    out.generatedDocuments = Array.isArray(json.generatedDocuments) ? json.generatedDocuments.length : 0;
    return out;
}

// ─── Reutilización ───────────────────────────────────────────────────────────
// Dos ejes de ahorro:
//  A) Interno: campos indexados de un mismo grupo (dep[0..4]) se configuran una
//     sola vez.
//  B) Entre formularios: cuando el ZIP trae varias variantes (p.ej. Gastos
//     Médicos completo y abreviado), lo que ya está resuelto en el más grande
//     se reaprovecha en los demás.

function intersectCount(setA, list) {
    var n = 0;
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        var k = list[i];
        if (seen[k]) continue;   // no contar dos veces el mismo nombre
        seen[k] = true;
        if (setA[k]) n++;
    }
    return n;
}

function computeReuse(pdfs, excels) {
    var out = {
        pdf: { total: 0, shared: 0, unique: 0, pairs: [], internalSaved: 0 },
        excel: { total: 0, shared: 0, unique: 0, pairs: [] },
        sharedFields: 0,
        uniqueFields: 0,
        sharedRules: 0,
        uniqueRules: 0,
        percent: 0,
    };

    // ── A) Ahorro interno por grupos repetidos ────────────────────────────────
    for (var i = 0; i < pdfs.length; i++) {
        out.pdf.internalSaved += (pdfs[i].fieldCount - pdfs[i].uniqueConfigs);
    }

    // ── B) Solapamiento entre PDFs ────────────────────────────────────────────
    // El más grande es la base; cada siguiente sólo "cuesta" lo que aporta nuevo.
    var bySize = pdfs.slice().sort(function (a, b) { return b.uniqueConfigs - a.uniqueConfigs; });
    var known = {};
    for (var p = 0; p < bySize.length; p++) {
        var pdf = bySize[p];
        var uniqNames = {};
        for (var f = 0; f < pdf.fieldNames.length; f++) {
            uniqNames[String(pdf.fieldNames[f]).replace(/\[\d+\]$/, '')] = true;
        }
        var list = Object.keys(uniqNames);
        var shared = p === 0 ? 0 : intersectCount(known, list);
        var own = list.length - shared;
        out.pdf.total += list.length;
        out.pdf.shared += shared;
        out.pdf.unique += own;
        if (p > 0) {
            out.pdf.pairs.push({
                file: pdf.file,
                against: bySize[0].file,
                shared: shared,
                own: own,
                percentShared: list.length ? Math.round(shared / list.length * 100) : 0,
            });
        }
        for (var l = 0; l < list.length; l++) known[list[l]] = true;
    }

    // ── B2) Solapamiento entre Excels (reglas de negocio) ─────────────────────
    var byRules = excels.slice().sort(function (a, b) {
        return (b.fieldKeys || []).length - (a.fieldKeys || []).length;
    });
    var knownRules = {};
    for (var e = 0; e < byRules.length; e++) {
        var keys = byRules[e].fieldKeys || [];
        var uniqKeys = {};
        for (var kk = 0; kk < keys.length; kk++) uniqKeys[keys[kk]] = true;
        var klist = Object.keys(uniqKeys);
        var sharedR = e === 0 ? 0 : intersectCount(knownRules, klist);
        var ownR = klist.length - sharedR;
        out.excel.total += klist.length;
        out.excel.shared += sharedR;
        out.excel.unique += ownR;
        if (e > 0) {
            out.excel.pairs.push({
                file: byRules[e].file,
                against: byRules[0].file,
                shared: sharedR,
                own: ownR,
                percentShared: klist.length ? Math.round(sharedR / klist.length * 100) : 0,
            });
        }
        for (var m = 0; m < klist.length; m++) knownRules[klist[m]] = true;
    }

    out.sharedFields = out.pdf.shared;
    out.uniqueFields = out.pdf.unique;
    out.sharedRules = out.excel.shared;
    out.uniqueRules = out.excel.unique;

    var totalItems = out.pdf.total + out.excel.total;
    var sharedItems = out.pdf.shared + out.excel.shared;
    out.percent = totalItems ? Math.round(sharedItems / totalItems * 100) : 0;
    return out;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreProject(totals, config) {
    var w = config.weights;
    var rf = config.reuseFactor != null ? config.reuseFactor : DEFAULT_CONFIG.reuseFactor;

    // Lo repetido (dentro del form o entre variantes del mismo) ya está resuelto:
    // cuesta sólo una fracción. Se descuenta de campos y de reglas.
    var reuse = totals.reuse || null;
    var repeatedFields = reuse ? (reuse.pdf.internalSaved + reuse.sharedFields) : 0;
    var repeatedRules = reuse ? reuse.sharedRules : 0;
    // Nunca descontar más de lo que hay.
    repeatedFields = Math.min(repeatedFields, totals.pdfFields);
    repeatedRules = Math.min(repeatedRules, totals.businessRules);

    var newFields = totals.pdfFields - repeatedFields;
    var newRules = totals.businessRules - repeatedRules;
    var savedPoints = Math.round((repeatedFields * w.pdfField * (1 - rf) +
        repeatedRules * w.businessRule * (1 - rf)) * 10) / 10;

    var breakdown = [
        { label: 'Campos del PDF (nuevos)', count: newFields, weight: w.pdfField, points: newFields * w.pdfField },
        { label: 'Campos repetidos', count: repeatedFields, weight: Math.round(w.pdfField * rf * 100) / 100, points: repeatedFields * w.pdfField * rf },
        { label: 'Páginas', count: totals.pages, weight: w.pdfPage, points: totals.pages * w.pdfPage },
        { label: 'Reglas de negocio (nuevas)', count: newRules, weight: w.businessRule, points: newRules * w.businessRule },
        { label: 'Reglas repetidas', count: repeatedRules, weight: Math.round(w.businessRule * rf * 100) / 100, points: repeatedRules * w.businessRule * rf },
        { label: 'Visibilidad condicional', count: totals.conditionalRules, weight: w.conditionalRule, points: totals.conditionalRules * w.conditionalRule },
        { label: 'Bloques repetidos', count: totals.repeaters, weight: w.repeater, points: totals.repeaters * w.repeater },
        { label: 'Catálogos', count: totals.catalogs, weight: w.catalog, points: totals.catalogs * w.catalog },
        { label: 'Ítems de catálogo', count: totals.catalogItems, weight: w.catalogItem, points: totals.catalogItems * w.catalogItem },
        { label: 'Formularios extra', count: totals.extraForms, weight: w.extraForm, points: totals.extraForms * w.extraForm },
    ];
    var points = 0;
    for (var i = 0; i < breakdown.length; i++) {
        breakdown[i].points = Math.round(breakdown[i].points * 10) / 10;
        points += breakdown[i].points;
    }
    points = Math.round(points * 10) / 10;

    var level, levelKey;
    var th = normalizeThresholds(config.thresholds) || DEFAULT_CONFIG.thresholds;
    if (points <= th.baja) { level = 'Baja'; levelKey = 'baja'; }
    else if (points <= th.media) { level = 'Media'; levelKey = 'media'; }
    else { level = 'Alta'; levelKey = 'alta'; }

    var hours = points * config.hoursPerPoint;
    return {
        points: points,
        level: level,
        levelKey: levelKey,
        breakdown: breakdown,
        estimatedHours: { min: Math.round(hours * 0.8), max: Math.round(hours * 1.3) },
        thresholds: th,
        reuseFactor: rf,
        savedPoints: savedPoints,
        repeatedFields: repeatedFields,
        repeatedRules: repeatedRules,
    };
}

// ─── Entrada principal ───────────────────────────────────────────────────────

/**
 * @param {Uint8Array} zipBytes
 * @param {Object} [configOverride] - {weights, thresholds, hoursPerPoint}
 */
async function analyzeZip(zipBytes, configOverride) {
    var config = {
        weights: Object.assign({}, DEFAULT_CONFIG.weights, (configOverride && configOverride.weights) || {}),
        thresholds: Object.assign({}, DEFAULT_CONFIG.thresholds, (configOverride && configOverride.thresholds) || {}),
        hoursPerPoint: (configOverride && configOverride.hoursPerPoint) || DEFAULT_CONFIG.hoursPerPoint,
        reuseFactor: (configOverride && configOverride.reuseFactor != null)
            ? configOverride.reuseFactor : DEFAULT_CONFIG.reuseFactor,
    };

    var zip = await JSZip.loadAsync(zipBytes);
    var entries = [];
    zip.forEach(function (path, entry) {
        if (entry.dir || isJunk(path)) return;
        entries.push({ path: path, entry: entry });
    });

    var inventory = [];
    var pdfs = [], excels = [], jsons = [], others = [];
    var errors = [];

    for (var i = 0; i < entries.length; i++) {
        var path = entries[i].path;
        var entry = entries[i].entry;
        var ext = extOf(path);
        var size = (entry._data && entry._data.uncompressedSize) || null;
        var record = { path: path, name: baseName(path), ext: ext, size: size, sizeLabel: fmtBytes(size), kind: 'otro' };

        try {
            if (ext === 'pdf') {
                var pdfBytes = await entry.async('uint8array');
                var pdfInfo = await analyzePdf(pdfBytes, baseName(path));
                pdfs.push(pdfInfo);
                record.kind = 'pdf';
                record.detail = pdfInfo.fieldCount + ' campos · ' + pdfInfo.pages + ' pág';
            } else if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'csv') {
                var xlsBytes = await entry.async('uint8array');
                var xlsInfo = analyzeExcel(xlsBytes, baseName(path));
                excels.push(xlsInfo);
                record.kind = 'excel';
                record.detail = xlsInfo.sheetCount + ' hoja(s) · ' +
                    (xlsInfo.businessRules + xlsInfo.conditionalRules) + ' reglas';
            } else if (ext === 'json') {
                var jsonText = await entry.async('string');
                var jsonInfo = analyzeJson(jsonText, baseName(path));
                jsons.push(jsonInfo);
                record.kind = 'json';
                record.detail = jsonInfo.kind === 'form-def'
                    ? (jsonInfo.fields + ' campos · ' + jsonInfo.sections + ' secciones')
                    : 'JSON de datos';
            } else {
                others.push(record);
            }
        } catch (e) {
            record.error = e.message;
            errors.push({ file: path, error: e.message });
        }
        inventory.push(record);
    }

    // ─── Totales ──────────────────────────────────────────────────────────────
    var totals = {
        files: inventory.length,
        pdfs: pdfs.length,
        excels: excels.length,
        jsons: jsons.length,
        others: others.length,
        pdfFields: 0,
        pages: 0,
        businessRules: 0,
        conditionalRules: 0,
        repeaters: 0,
        catalogs: 0,
        catalogItems: 0,
        excelSheets: 0,
        extraForms: Math.max(0, pdfs.length - 1),
    };
    for (var a = 0; a < pdfs.length; a++) {
        totals.pdfFields += pdfs[a].fieldCount;
        totals.pages += pdfs[a].pages;
        totals.repeaters += pdfs[a].repeaterGroups;
    }
    for (var b = 0; b < excels.length; b++) {
        totals.businessRules += excels[b].businessRules;
        totals.conditionalRules += excels[b].conditionalRules;
        // Catálogos = hojas de catálogo + combos que referencian uno ("Ver catálogo"):
        // cada uno hay que conseguirlo e integrarlo.
        totals.catalogs += excels[b].catalogs + (excels[b].catalogRefs || 0);
        totals.catalogItems += excels[b].catalogItems;
        totals.excelSheets += excels[b].sheetCount;
    }
    // Si hay form-def, sus números son los más fiables. Se usa max() (no suma)
    // para no contar dos veces lo mismo que ya declara el Excel o el PDF.
    for (var c = 0; c < jsons.length; c++) {
        if (jsons[c].kind !== 'form-def') continue;
        totals.repeaters = Math.max(totals.repeaters, jsons[c].repeaters + jsons[c].lookups);
        totals.conditionalRules = Math.max(totals.conditionalRules, jsons[c].conditionals);
        totals.businessRules = Math.max(totals.businessRules,
            (jsons[c].validationRules || 0) + (jsons[c].prefillMappings || 0) + (jsons[c].autoFill || 0));
        // Sin PDF en el ZIP, los campos del form-def son la mejor medida.
        totals.pdfFields = Math.max(totals.pdfFields, jsons[c].fields);
    }

    // Reutilización: lo que se repite (y por lo tanto se hace una sola vez).
    totals.reuse = computeReuse(pdfs, excels);
    totals.uniqueConfigs = 0;
    for (var u = 0; u < pdfs.length; u++) totals.uniqueConfigs += pdfs[u].uniqueConfigs;

    var score = scoreProject(totals, config);

    return {
        inventory: inventory,
        reuse: totals.reuse,
        pdfs: pdfs,
        excels: excels,
        jsons: jsons,
        others: others,
        errors: errors,
        totals: totals,
        score: score,
        config: config,
    };
}

module.exports = { analyzeZip, DEFAULT_CONFIG, analyzeExcel, analyzeJson, scoreProject, calibrateThresholds };
