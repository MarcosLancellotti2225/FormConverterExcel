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
const { indexPaths } = require('./path-indexer');
const { findCatalog, formatCatalogOptionsJson } = require('./catalogs-formatter');

const HEADERS = [
    '#', 'Sección del PDF', 'AcroForm Actual', 'AcroForm Propuesto',
    'Etiqueta para el público', 'Nombre interno (sourceName)', 'Tipo', 'Grupo',
    'Página', 'Path JSON principal', 'Paths secundarios', 'Pre-rellenado',
    'Obligatorio', 'MaxLength', 'Patrón regex', 'Formato',
    'Visibilidad condicional', 'Catálogo (nombre)', 'Opciones formato Lovable (JSON)',
    'Tipo de dato (matriz)', 'Regla original', 'Hoja del Excel catálogo',
];

const COL_WIDTHS = [4, 22, 28, 26, 24, 32, 5, 18, 5, 36, 30, 11, 11, 9, 22, 13, 30, 22, 60, 18, 38, 22];

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

const NOISE_MIN_LEN = 35;
const NOISE_CONNECTORS = /_(y|de|del|la|el|que|con|en|los|las|para|una|un|se|por)_/;
const NOISE_PHRASES = [
    'exprese_claramente', 'nombre_completo_y_el_cargo',
    'desempena_dentro', 'persona_juridica', 'datos_personales',
    'declaro_que', 'acepto_que', 'autorizo_a',
];

function isNoiseField(proposedName) {
    if (!proposedName) return false;
    if (proposedName.length < NOISE_MIN_LEN) return false;
    const connectorMatches = (proposedName.match(NOISE_CONNECTORS) || []).length;
    if (connectorMatches >= 2) return true;
    for (const phrase of NOISE_PHRASES) {
        if (proposedName.includes(phrase)) return true;
    }
    return false;
}

const FORMULARIO_KEYWORDS = {
    '1009052': ['vida colectiva', 'colectiva'],
    'D0306':   ['vida universal', 'universal'],
    'D0309':   ['proteccion crediticia', 'protección crediticia', 'crediticia'],
};

async function buildPdfRows(pdfBytes, matrixRows, formularioCode, catalogos) {
    const { fields: rawFields } = await extractFields(pdfBytes);
    const textItems = await extractText(pdfBytes);
    const labeled = detectLabels(rawFields, textItems);

    const { headings, subHeadings } = detectSections(textItems, labeled);
    const dateGroupsMap = detectDateGroups(labeled, headings, textItems);

    const intermediates = [];
    for (const field of labeled) {
        const sectionInfo = assignSectionToField(field, headings, subHeadings);
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
            _sectionPrefix: derivePrefixForRow(named.acroFormPropuesto, sectionInfo),
        });
    }

    const filtered = intermediates.filter(im => !isNoiseField(im.acroFormPropuesto));

    resolveCollisions(filtered);
    addContextIfDuplicate(filtered);

    const matrixIndex = buildMatrixIndex(matrixRows, formularioCode);
    const usedMatrixIdx = new Set();

    const summary = {
        pdfFieldCount: filtered.length,
        noiseFiltered: intermediates.length - filtered.length,
        matchedToMatrix: 0,
        unmatched: 0,
        prefilledCount: 0,
        sinCatalogo: 0,
        pathsSinIndice: 0,
    };

    const pdfRows = [];
    const renameMapping = [];

    for (let i = 0; i < filtered.length; i++) {
        const im = filtered[i];
        const matrixRow = matchMatrixRow(im, matrixIndex, usedMatrixIdx);

        let enrich;
        if (matrixRow) {
            enrich = extractFromMatrix(matrixRow, catalogos, matrixRows, im);
            summary.matchedToMatrix++;
        } else {
            enrich = emptyEnrichment();
            summary.unmatched++;
            // Catálogo can still be resolved from the field's group/label even
            // without a matrix match (e.g. synthetic Sexo).
            const cat = findCatalog(im.group, im.etiquetaPublico, catalogos);
            if (cat.options.length) {
                enrich.catalogoNombre = cat.sheetName;
                enrich.catalogoOpciones = formatCatalogOptionsJson(cat.options);
                enrich.catalogoHoja = cat.sheetName;
            }
        }

        if (enrich._pathWarning) summary.pathsSinIndice++;
        if (isCatalogExpected(im) && !enrich.catalogoOpciones) summary.sinCatalogo++;

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

        if (im.field.name && im.acroFormPropuesto) {
            renameMapping.push({ originalName: im.field.name, newName: im.acroFormPropuesto });
        }
    }

    return { rows: pdfRows, summary, renameMapping };
}

function derivePrefixForRow(acroFormPropuesto, sectionInfo) {
    // beneficiario_N_ has the index baked into the prefix and is not in
    // sectionInfo.sectionPrefix (which is just "beneficiario_"). Re-derive
    // it from the propuesto so path-indexer maps to personas[N] correctly.
    if (!acroFormPropuesto) return sectionInfo ? (sectionInfo.sectionPrefix || '') : '';
    const m = String(acroFormPropuesto).match(/^(beneficiario_\d+_)/);
    if (m) return m[1];
    return sectionInfo ? (sectionInfo.sectionPrefix || '') : '';
}

function isCatalogExpected(intermediate) {
    if (intermediate.group === 'tipo_identificacion' || intermediate.group === 'sexo') return true;
    const lab = String(intermediate.etiquetaPublico || '').toLowerCase();
    return /parentesco|tipo\s+(de\s+)?identificaci|estado\s+civil|nacionalidad|moneda|tipo\s+(de\s+)?persona/.test(lab);
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

    const sectionN = normalize(intermediate._sectionName || '');

    if (labelN) {
        const exactInSection = matrixIndex.find(m =>
            !usedSet.has(m.rowIndex) && m.labelN === labelN && pathMatchesSection(m.row, sectionN)
        );
        if (exactInSection) { usedSet.add(exactInSection.rowIndex); return exactInSection.row; }

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

function pathMatchesSection(matrixRow, sectionN) {
    if (!sectionN) return false;
    const path = normalize(matrixRow['Nombre del Campo en Json'] || '');
    if (!path) return false;
    if (sectionN.includes('solicitante') || sectionN.includes('asegurado')) {
        return path.includes('asegurado') || path.includes('solicitante');
    }
    if (sectionN.includes('beneficiario')) return path.includes('beneficiario');
    if (sectionN.includes('tomador') || sectionN.includes('firma')) {
        return path.includes('tomador') || path.includes('firma');
    }
    if (sectionN.includes('poliza')) return path.includes('poliza');
    if (sectionN.includes('vigencia')) return path.includes('vigencia');
    if (sectionN.includes('notificacion')) return path.includes('notificacion');
    return false;
}

function extractFromMatrix(matrixRow, catalogos, allRows, intermediate) {
    const jsonPath = matrixRow['Nombre del Campo en Json'] || '';
    const all = String(jsonPath).split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    const principalRaw = all[0] || '';
    const secundariosRaw = all.slice(1).join(' | ');

    const sectionPrefix = intermediate ? intermediate._sectionPrefix : '';
    const indexed = indexPaths(principalRaw, secundariosRaw, sectionPrefix);

    const regla = matrixRow['Regla'] || '';
    const obs = matrixRow['Observaciones'] || '';
    const tipoDato = matrixRow['Tipo de dato'] || '';

    const validation = ruleInternal.parseValidation(regla, tipoDato);
    const condicional = parseConditionalText(regla, obs);
    const formato = mapFormato(tipoDato);
    const obligatorio = normalizeYesNo(matrixRow['Obligatorio']);

    const catRes = resolveCatalogo(intermediate, matrixRow, catalogos, allRows);

    return {
        pathPrincipal: indexed.principal,
        pathsSecundarios: indexed.secundarios,
        obligatorio,
        maxLength: validation.maxLength != null ? String(validation.maxLength) : '',
        patron: validation.pattern || '',
        formato,
        condicional,
        catalogoNombre: catRes.nombre,
        catalogoOpciones: catRes.opcionesJson,
        catalogoHoja: catRes.hoja,
        tipoDatoMatriz: tipoDato,
        reglaOriginal: regla,
        _pathWarning: indexed.warning,
    };
}

function resolveCatalogo(intermediate, matrixRow, catalogos, allRows) {
    const group = intermediate ? intermediate.group : '';
    const label = intermediate ? intermediate.etiquetaPublico : (matrixRow['Nombre del campo en formulario'] || '');

    const cat = findCatalog(group, label, catalogos);
    if (cat.options.length) {
        return {
            nombre: cat.sheetName,
            opcionesJson: formatCatalogOptionsJson(cat.options),
            hoja: cat.sheetName,
        };
    }

    // Fallback: inline values from the matrix when same label has multiple "Valor" rows
    if (Array.isArray(allRows) && matrixRow) {
        const matrixLabel = matrixRow['Nombre del campo en formulario'] || '';
        const sameLabel = allRows.filter(r =>
            r['Nombre del campo en formulario'] === matrixLabel &&
            r['Valor'] && String(r['Valor']).trim()
        );
        if (sameLabel.length > 1) {
            const inlineOpts = [...new Set(sameLabel.map(r => String(r['Valor']).trim()))]
                .filter(Boolean)
                .map(v => ({ value: v, label: v }));
            if (inlineOpts.length) {
                return {
                    nombre: '(inline)',
                    opcionesJson: JSON.stringify(inlineOpts),
                    hoja: '(inline)',
                };
            }
        }
    }

    return { nombre: '', opcionesJson: '', hoja: '' };
}

function emptyEnrichment() {
    return {
        pathPrincipal: '', pathsSecundarios: '', obligatorio: '',
        maxLength: '', patron: '', formato: '', condicional: '',
        catalogoNombre: '', catalogoOpciones: '', catalogoHoja: '',
        tipoDatoMatriz: '', reglaOriginal: '', _pathWarning: false,
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
        o.catalogoNombre,
        o.catalogoOpciones,
        o.tipoDatoMatriz,
        o.reglaOriginal,
        o.catalogoHoja,
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
        '',                                  // AcroForm Actual (vacío)
        '',                                  // AcroForm Propuesto (no aplica)
        pf.label,
        '',                                  // sourceName
        '',                                  // Tipo
        '',                                  // Grupo
        '',                                  // Página
        pf.enrich.pathPrincipal,
        pf.enrich.pathsSecundarios,
        'Sí',                                // Pre-rellenado
        pf.enrich.obligatorio,
        pf.enrich.maxLength,
        pf.enrich.patron,
        pf.enrich.formato,
        pf.enrich.condicional,
        pf.enrich.catalogoNombre || '',
        pf.enrich.catalogoOpciones || '',
        pf.enrich.tipoDatoMatriz,
        pf.enrich.reglaOriginal,
        pf.enrich.catalogoHoja || '',
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
        parseConditionalText, resolveCatalogo, derivePrefixForRow,
        isCatalogExpected, isNoiseField, pathMatchesSection,
        collectPrefilledMatrixRows, interleavePrefilled, inferSectionFromPath,
    },
};
