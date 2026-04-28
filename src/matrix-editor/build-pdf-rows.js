'use strict';

/**
 * Build PDF Rows
 *
 * Orchestrator for the matrix-editor "Descargar por Formulario" flow.
 * Takes a single PDF + the cleaned matrix rows + optional catalogos
 * and produces the 20-column row set for one Excel workbook.
 *
 * Pipeline:
 *   1. extractFields + extractText + detectLabels (existing modules)
 *   2. detectSections + detectDateGroups (Phase 1)
 *   3. proposeName per field (Phase 2)
 *   4. matchAgainstMatrix → enrich with JSON path / regla / catálogo
 *   5. resolveCollisions + addContextIfDuplicate (Phase 2 second pass)
 *   6. interleavePrefilled: insert "no se llena en PDF" matrix rows
 *      grouped under each section
 *
 * 20-column shape:
 *   #, Sección PDF, AcroForm Actual, AcroForm Propuesto, Etiqueta,
 *   sourceName, Tipo (Tx|Btn), Grupo, Página,
 *   Path JSON principal, Paths secundarios, Pre-rellenado, Obligatorio,
 *   MaxLength, Patrón, Formato, Visibilidad condicional, Catálogo,
 *   Tipo dato (matriz), Regla original
 */

const { extractFields } = require('../pdf-converter/extract-fields');
const { extractText } = require('../pdf-converter/extract-text');
const { detectLabels } = require('../pdf-converter/label-detector');
const { detectSections, assignSectionToField, detectDateGroups } = require('./section-detector');
const { proposeName, resolveCollisions, addContextIfDuplicate } = require('./propose-name');
const { _internal: ruleInternal } = require('../parsers/rule-parser');
const { normalize } = require('./cross-with-pdf');

const HEADERS = [
    '#', 'Sección del PDF', 'AcroForm Actual', 'AcroForm Propuesto',
    'Etiqueta para el público', 'Nombre interno (sourceName)', 'Tipo', 'Grupo',
    'Página', 'Path JSON principal', 'Paths secundarios', 'Pre-rellenado',
    'Obligatorio', 'MaxLength', 'Patrón regex', 'Formato',
    'Visibilidad condicional', 'Catálogo / Opciones', 'Tipo de dato (matriz)',
    'Regla original',
];

const COL_WIDTHS = [4, 22, 28, 26, 24, 32, 5, 18, 5, 36, 30, 11, 11, 9, 22, 13, 30, 22, 18, 38];

const FORMATO_MAP = {
    'fecha':            'fecha',
    'email':            'email',
    'correo':           'email',
    'numerico':         'numérico',
    'numérico':         'numérico',
    'numérico/porcentual': 'numérico',
    'alfanumerico':     'alfanumérico',
    'alfanumérico':     'alfanumérico',
    'texto':            'alfanumérico',
};

const CATALOGO_NAMES = [
    'tipo identificacion', 'tipo identificación', 'parentesco',
    'estado civil', 'moneda', 'tipo formulario', 'tipo persona',
    'tipo tramite', 'tipo trámite', 'nacionalidad', 'provincia',
    'canton', 'distrito', 'ocupacion', 'ocupación',
];

const FORMULARIO_KEYWORDS = {
    '1009052': ['vida colectiva', 'colectiva'],
    'D0306':   ['vida universal', 'universal'],
    'D0309':   ['proteccion crediticia', 'protección crediticia', 'crediticia'],
};

async function buildPdfRows(pdfBytes, matrixRows, formularioCode, catalogos) {
    const { fields: rawFields } = await extractFields(pdfBytes);
    const textItems = await extractText(pdfBytes);
    const labeled = detectLabels(rawFields, textItems);

    const sections = detectSections(textItems);
    const dateGroupsMap = detectDateGroups(labeled, sections);

    const intermediates = [];
    for (const field of labeled) {
        const sectionInfo = assignSectionToField(field, sections);
        const dateInfo = dateGroupsMap.get(field.name) || null;
        const named = proposeName(field, sectionInfo, dateInfo);

        intermediates.push({
            field,
            sectionInfo,
            dateInfo,
            acroFormPropuesto: named.acroFormPropuesto,
            etiquetaPublico: named.etiquetaPublico,
            group: named.group,
            _typeNative: field.type,
            _sectionName: sectionInfo ? (sectionInfo.sectionName || sectionInfo.sectionHeading) : '',
            _dateGroupKey: dateInfo ? dateInfo.groupKey : null,
        });
    }

    resolveCollisions(intermediates);
    addContextIfDuplicate(intermediates);

    const matrixIndex = buildMatrixIndex(matrixRows, formularioCode);
    const usedMatrixIdx = new Set();

    const pdfRows = [];
    for (let i = 0; i < intermediates.length; i++) {
        const im = intermediates[i];
        const matrixRow = matchMatrixRow(im, matrixIndex, usedMatrixIdx);
        const enrich = matrixRow ? extractFromMatrix(matrixRow, catalogos, matrixRows) : emptyEnrichment();

        pdfRows.push(buildRow({
            idx: i + 1,
            sectionPdf: im._sectionName || '',
            acroFormActual: im.field.name,
            acroFormPropuesto: im.acroFormPropuesto,
            etiquetaPublico: im.etiquetaPublico,
            tipo: tipoFromNative(im._typeNative),
            group: im.group || '',
            page: im.field.page != null ? im.field.page + 1 : '',
            ...enrich,
            prerellenado: 'No',
        }));
    }

    const prefilled = collectPrefilledMatrixRows(matrixRows, formularioCode, usedMatrixIdx, catalogos);
    const finalRows = interleavePrefilled(pdfRows, prefilled);

    return {
        rows: finalRows,
        summary: {
            pdfFieldCount: intermediates.length,
            matchedToMatrix: usedMatrixIdx.size,
            prefilledCount: prefilled.length,
        }
    };
}

function buildMatrixIndex(matrixRows, code) {
    const idx = [];
    for (let i = 0; i < matrixRows.length; i++) {
        const row = matrixRows[i];
        if (!appliesToFormulario(row['Formulario a visualizar'], code)) continue;
        const labelN = normalize(row['Nombre del campo en formulario']);
        const pdfN = normalize(row['Nombre en PDF']);
        idx.push({ row, rowIndex: i, labelN, pdfN });
    }
    return idx;
}

function appliesToFormulario(formVis, code) {
    const s = normalize(formVis);
    if (!s) return true;
    if (s.includes('todos')) return true;
    const kws = FORMULARIO_KEYWORDS[code] || [];
    return kws.some(kw => s.includes(kw));
}

function matchMatrixRow(intermediate, matrixIndex, usedSet) {
    const labelN = normalize(intermediate.field.detectedLabel || '');
    const fieldNameN = normalize(intermediate.field.name);
    if (!labelN && !fieldNameN) return null;

    if (labelN) {
        const exact = matrixIndex.find(m => !usedSet.has(m.rowIndex) && m.labelN === labelN);
        if (exact) { usedSet.add(exact.rowIndex); return exact.row; }
    }

    if (fieldNameN) {
        const byPdf = matrixIndex.find(m => !usedSet.has(m.rowIndex) && m.pdfN && m.pdfN === fieldNameN);
        if (byPdf) { usedSet.add(byPdf.rowIndex); return byPdf.row; }
    }

    if (labelN && labelN.length >= 4) {
        const partial = matrixIndex.find(m =>
            !usedSet.has(m.rowIndex) && m.labelN && (m.labelN.includes(labelN) || labelN.includes(m.labelN))
        );
        if (partial) { usedSet.add(partial.rowIndex); return partial.row; }
    }

    return null;
}

function extractFromMatrix(matrixRow, catalogos, allRows) {
    const jsonPath = matrixRow['Nombre del Campo en Json'] || '';
    const all = String(jsonPath).split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    const principal = all[0] || '';
    const secundarios = all.slice(1).join(' | ');

    const regla = matrixRow['Regla'] || '';
    const obs = matrixRow['Observaciones'] || '';
    const tipoDato = matrixRow['Tipo de dato'] || '';

    const validation = ruleInternal.parseValidation(regla, tipoDato);
    const condicional = parseConditionalText(regla, obs);
    const formato = mapFormato(tipoDato);
    const obligatorio = normalizeYesNo(matrixRow['Obligatorio']);
    const catalogo = buildCatalogoColumn(matrixRow, allRows, catalogos);

    return {
        pathPrincipal: principal,
        pathsSecundarios: secundarios,
        obligatorio,
        maxLength: validation.maxLength != null ? String(validation.maxLength) : '',
        patron: validation.pattern || '',
        formato,
        condicional,
        catalogo,
        tipoDatoMatriz: tipoDato,
        reglaOriginal: regla,
    };
}

function emptyEnrichment() {
    return {
        pathPrincipal: '', pathsSecundarios: '', obligatorio: '',
        maxLength: '', patron: '', formato: '', condicional: '',
        catalogo: '', tipoDatoMatriz: '', reglaOriginal: '',
    };
}

function buildRow(o) {
    return [
        o.idx,
        o.sectionPdf,
        o.acroFormActual,
        o.acroFormPropuesto,
        o.etiquetaPublico,
        o.acroFormPropuesto,                 // sourceName mirrors propuesto
        o.tipo,
        o.group,
        o.page,
        o.pathPrincipal,
        o.pathsSecundarios,
        o.prerellenado,
        o.obligatorio,
        o.maxLength,
        o.patron,
        o.formato,
        o.condicional,
        o.catalogo,
        o.tipoDatoMatriz,
        o.reglaOriginal,
    ];
}

function tipoFromNative(t) {
    if (!t) return '';
    const low = String(t).toLowerCase();
    if (low === 'text' || low.includes('text')) return 'Tx';
    return 'Btn';
}

function mapFormato(tipoDato) {
    const k = normalize(tipoDato);
    if (!k) return '';
    if (FORMATO_MAP[k]) return FORMATO_MAP[k];
    if (k.includes('fecha')) return 'fecha';
    if (k.includes('numer')) return 'numérico';
    if (k.includes('alfanum')) return 'alfanumérico';
    if (k.includes('combo') || k.includes('radio') || k.includes('checkbox')) return '';
    return 'alfanumérico';
}

function normalizeYesNo(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'si' || s === 'sí') return 'Sí';
    if (s === 'no') return 'No';
    return '';
}

function parseConditionalText(regla, obs) {
    const raw = [regla, obs].filter(Boolean).join(' · ');
    if (!raw) return '';
    const text = raw.toLowerCase();

    const triggerRe = /si\s+se\s+(?:selecciona|elige|marca)\s+([^,.;]+?)\s+se\s+(?:debe(?:\s+de)?\s+)?(?:habilitar|desplegar|mostrar|visualizar)\s+(?:el\s+campo\s+)?([^,.;]+)/;
    const m = text.match(triggerRe);
    if (m) return 'Si "' + capFirst(m[1].trim()) + '" → mostrar "' + capFirst(m[2].trim()) + '"';

    const depRe = /si\s+(?:el\s+campo\s+|el\s+|la\s+)?([a-z0-9 áéíóúñ]+?)\s+(?:es|=|igual\s+a)\s+([a-z0-9 ]+)/;
    const m2 = text.match(depRe);
    if (m2) return 'Si ' + capFirst(m2[1].trim()) + ' = ' + capFirst(m2[2].trim());

    return '';
}

function capFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildCatalogoColumn(matrixRow, allRows, catalogos) {
    const tipo = String(matrixRow['Tipo de dato'] || '').toLowerCase();
    if (!/(combo|radio|checkbox)/.test(tipo)) return '';

    const label = matrixRow['Nombre del campo en formulario'] || '';
    if (Array.isArray(allRows)) {
        const sameLabel = allRows.filter(r =>
            r['Nombre del campo en formulario'] === label &&
            r['Valor'] && String(r['Valor']).trim() && r['Valor'] !== (matrixRow['Valor'] || '')
        );
        if (sameLabel.length > 0) {
            const allVals = [matrixRow['Valor'], ...sameLabel.map(r => r['Valor'])].filter(Boolean);
            const unique = [...new Set(allVals)];
            return '(inline): ' + unique.join(' | ');
        }
    }

    const text = normalize((matrixRow['Regla'] || '') + ' ' + (matrixRow['Observaciones'] || ''));
    for (const name of CATALOGO_NAMES) {
        const nameNorm = normalize(name);
        if (text.includes(nameNorm)) {
            if (catalogos) {
                const cat = catalogos[nameNorm] || catalogos[name.toLowerCase()];
                if (cat) {
                    return name + ': ' + cat.map(o => o.label).join(' | ');
                }
                for (const [key, val] of Object.entries(catalogos)) {
                    if (normalize(key).includes(nameNorm) || nameNorm.includes(normalize(key))) {
                        return name + ': ' + val.map(o => o.label).join(' | ');
                    }
                }
            }
            return name + ': (ver hoja Catálogos)';
        }
    }

    return '';
}

function collectPrefilledMatrixRows(matrixRows, code, usedSet, catalogos) {
    const result = [];
    for (let i = 0; i < matrixRows.length; i++) {
        if (usedSet.has(i)) continue;
        const row = matrixRows[i];
        if (!appliesToFormulario(row['Formulario a visualizar'], code)) continue;

        const nombrePdf = String(row['Nombre en PDF'] || '').trim().toLowerCase();
        const isPrefilled = !nombrePdf
            || nombrePdf === 'no se llena en pdf'
            || nombrePdf === 'no aplica'
            || nombrePdf === 'n/a'
            || nombrePdf === 'no';
        if (!isPrefilled) continue;

        const enrich = extractFromMatrix(row, catalogos, matrixRows);
        const sectionPdf = inferSectionFromPath(enrich.pathPrincipal) || row['Sección'] || '';

        result.push({
            sectionPdf,
            label: row['Nombre del campo en formulario'] || '',
            tipoDatoMatriz: row['Tipo de dato'] || '',
            enrich,
        });
    }
    return result;
}

function inferSectionFromPath(path) {
    if (!path) return '';
    const seg = String(path).split('.')[0];
    if (!seg) return '';
    const map = {
        datosgenerales:    'LUGAR Y FECHA DE SOLICITUD',
        datostomador:      'DATOS DEL TOMADOR',
        datospoliza:       'DATOS DE LA PÓLIZA',
        datosasegurado:    'DATOS DEL SOLICITANTE',
        datossolicitante:  'DATOS DEL SOLICITANTE',
        datosobjetointeres: 'DATOS DEL OBJETO DE INTERÉS',
        datosbeneficiarios: 'BENEFICIARIOS',
        datosvigencia:     'PLAZO DE VIGENCIA',
        datosnotificacion: 'NOTIFICACIONES',
        datosnotificaciones: 'NOTIFICACIONES',
        datosfirma:        'FIRMA',
    };
    const k = normalize(seg);
    return map[k] || '';
}

function interleavePrefilled(pdfRows, prefilled) {
    if (!prefilled.length) return pdfRows;

    const out = [];
    const usedPrefilled = new Set();
    let counter = 0;

    let lastSection = null;
    for (let i = 0; i < pdfRows.length; i++) {
        const cur = pdfRows[i];
        const curSection = cur[1];

        if (curSection !== lastSection && lastSection !== null) {
            for (let p = 0; p < prefilled.length; p++) {
                if (usedPrefilled.has(p)) continue;
                if (sectionMatches(prefilled[p].sectionPdf, lastSection)) {
                    counter++;
                    out.push(buildPrefilledRow(prefilled[p], counter));
                    usedPrefilled.add(p);
                }
            }
        }

        counter++;
        cur[0] = counter;
        out.push(cur);
        lastSection = curSection;
    }

    if (lastSection !== null) {
        for (let p = 0; p < prefilled.length; p++) {
            if (usedPrefilled.has(p)) continue;
            if (sectionMatches(prefilled[p].sectionPdf, lastSection)) {
                counter++;
                out.push(buildPrefilledRow(prefilled[p], counter));
                usedPrefilled.add(p);
            }
        }
    }

    for (let p = 0; p < prefilled.length; p++) {
        if (usedPrefilled.has(p)) continue;
        counter++;
        out.push(buildPrefilledRow(prefilled[p], counter));
    }

    return out;
}

function buildPrefilledRow(pf, idx) {
    return [
        idx,
        pf.sectionPdf,
        '',                         // AcroForm Actual (vacío)
        '',                         // AcroForm Propuesto (no aplica)
        pf.label,
        '',                         // sourceName
        '',                         // Tipo
        '',                         // Grupo
        '',                         // Página
        pf.enrich.pathPrincipal,
        pf.enrich.pathsSecundarios,
        'Sí',                       // Pre-rellenado
        pf.enrich.obligatorio,
        pf.enrich.maxLength,
        pf.enrich.patron,
        pf.enrich.formato,
        pf.enrich.condicional,
        pf.enrich.catalogo,
        pf.enrich.tipoDatoMatriz,
        pf.enrich.reglaOriginal,
    ];
}

function sectionMatches(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return na.includes(nb) || nb.includes(na);
}

module.exports = {
    buildPdfRows,
    HEADERS,
    COL_WIDTHS,
    _internal: {
        buildMatrixIndex, matchMatrixRow, extractFromMatrix,
        appliesToFormulario, mapFormato, normalizeYesNo,
        parseConditionalText, buildCatalogoColumn,
        collectPrefilledMatrixRows, interleavePrefilled, inferSectionFromPath,
    },
};
