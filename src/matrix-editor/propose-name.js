'use strict';

/**
 * Propose Name
 *
 * Generates the `acroFormPropuesto` (column 4) and `etiquetaPublico` (column 5)
 * for each field, applying the convención B with prefixes:
 *
 *   acroFormPropuesto = sectionPrefix + subHeadingPrefix + slug(label)
 *
 * Plus 3 extra responsibilities:
 *   - Detect repeatable rows (FieldNameRow1, FieldNameRow2, ...) and route them
 *     to beneficiario_N_/fila_N_/etc.
 *   - Resolve naming collisions: text+checkbox same name → text gets _texto
 *     suffix (covers the "Otro" pattern). Same-type collisions get _2, _3.
 *   - Add context to public labels when the same label repeats (Día → Día (Solicitud)).
 */

const { _internal: detectorInternal } = require('./section-detector');
const slugify = detectorInternal.slugify;
const normalize = detectorInternal.normalize;

const ROW_REGEX = /Row\s*(\d+)$/i;

const GROUP_LABEL_ES = {
    fecha_solicitud:    'Solicitud',
    fecha_nacimiento:   'Nacimiento',
    vigencia_desde:     'Vigencia Desde',
    vigencia_hasta:     'Vigencia Hasta',
    tipo_identificacion: 'Tipo Identificación',
    sexo:               'Sexo',
    calidad:            'Calidad',
};

function detectRepeatableRow(fieldName, sectionInfo) {
    const m = String(fieldName || '').match(ROW_REGEX);
    if (!m) return null;
    const rowN = parseInt(m[1], 10);

    const sectionN = normalize(sectionInfo && sectionInfo.sectionName ? sectionInfo.sectionName : '');
    const sectionH = normalize(sectionInfo && sectionInfo.sectionHeading ? sectionInfo.sectionHeading : '');

    if (sectionInfo && sectionInfo.sectionRepeatable) {
        const beneN = sectionInfo.beneficiarioN || rowN;
        return { rowN, rowPrefix: 'beneficiario_' + beneN + '_', warning: false };
    }
    if (sectionN.includes('beneficiario') || sectionH.includes('beneficiario')) {
        return { rowN, rowPrefix: 'beneficiario_' + rowN + '_', warning: false };
    }
    console.warn(
        `[propose-name] Repeatable row "${fieldName}" without recognizable section heading. ` +
        `Falling back to "fila_${rowN}_". Review section detection.`
    );
    return { rowN, rowPrefix: 'fila_' + rowN + '_', warning: true };
}

/**
 * Compute the bare proposed name + group for a single field.
 * No collision resolution and no public-label context yet — those run as a
 * second pass over the full row set.
 *
 * @param {Object} field          { name, type, page, rect, detectedLabel }
 * @param {Object} sectionInfo    output of assignSectionToField
 * @param {Object} dateInfo       value from detectDateGroups Map (or null)
 * @returns {{ acroFormPropuesto: string, group: string|null, etiquetaPublico: string }}
 */
function proposeName(field, sectionInfo, dateInfo) {
    const repeatable = detectRepeatableRow(field.name, sectionInfo);

    let mainPrefix = '';
    if (repeatable) {
        mainPrefix = repeatable.rowPrefix;
    } else if (sectionInfo && sectionInfo.sectionPrefix) {
        mainPrefix = sectionInfo.sectionPrefix;
    } else if (sectionInfo) {
        // Section detected but not in whitelist (or explicitly empty prefix)
        mainPrefix = '';
    }

    let subPrefix = '';
    let group = null;
    if (dateInfo) {
        subPrefix = dateInfo.subHeadingPrefix || 'fecha_';
        group = dateInfo.groupKey || null;
    } else if (sectionInfo && sectionInfo.subHeadingPrefix) {
        subPrefix = sectionInfo.subHeadingPrefix;
        group = sectionInfo.group || null;
    }

    let slug;
    if (dateInfo) {
        slug = dateInfo.part || '';
    } else if (repeatable) {
        const labelOnly = String(field.name).replace(ROW_REGEX, '').trim();
        const labelForSlug = field.detectedLabel || labelOnly || field.name;
        slug = slugify(labelForSlug);
    } else {
        const label = field.detectedLabel || field.name || '';
        slug = slugify(label);
    }

    let acroFormPropuesto = (mainPrefix + subPrefix + slug).replace(/_+/g, '_').replace(/^_|_$/g, '');

    if (!acroFormPropuesto) {
        console.warn(
            `[propose-name] Could not generate name for field "${field.name}" ` +
            `(label="${field.detectedLabel}", section="${sectionInfo && sectionInfo.sectionName}"). ` +
            `Falling back to slug of original name.`
        );
        acroFormPropuesto = slugify(field.name) || '_unnamed';
    }

    const etiquetaPublico = field.detectedLabel ? field.detectedLabel.trim() : (field.name || '');

    return { acroFormPropuesto, group, etiquetaPublico };
}

/**
 * Mutate `rows` in place to disambiguate duplicate proposed names.
 *
 * Rules:
 *   - text + (checkbox|button|radio) collision → the text gets `_texto` suffix
 *     (covers the "Otro" textbox pattern next to "Otro" checkbox).
 *   - same-type collision → all but the first get `_2`, `_3`, … suffix
 *     (preserve insertion order so the topmost field on the page keeps the
 *     bare name).
 *
 * Each row is expected to have at least { acroFormPropuesto, _typeNative }
 * where _typeNative is one of 'text'|'checkbox'|'radio'|'button'|'select'|'signature'.
 */
function resolveCollisions(rows) {
    const groups = new Map();
    rows.forEach((row, idx) => {
        const key = row.acroFormPropuesto;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ row, idx });
    });

    let renamed = 0;
    for (const [, entries] of groups) {
        if (entries.length <= 1) continue;

        const texts = entries.filter(e => e.row._typeNative === 'text');
        const buttons = entries.filter(e => e.row._typeNative !== 'text');

        if (texts.length === 1 && buttons.length >= 1) {
            const t = texts[0];
            t.row.acroFormPropuesto = t.row.acroFormPropuesto + '_texto';
            renamed++;
            continue;
        }

        for (let i = 1; i < entries.length; i++) {
            entries[i].row.acroFormPropuesto = entries[i].row.acroFormPropuesto + '_' + (i + 1);
            renamed++;
        }
    }

    return renamed;
}

/**
 * Mutate rows in place: when a `etiquetaPublico` repeats, add a "(<Context>)"
 * suffix so each public-facing label is unique.
 *
 * Context preference:
 *   1. group friendly name (Solicitud, Nacimiento, Vigencia Desde, …)
 *   2. sectionName (Datos del Solicitante, Beneficiario 1, …)
 *   3. raw groupKey
 */
function addContextIfDuplicate(rows) {
    const counts = new Map();
    for (const r of rows) {
        if (!r.etiquetaPublico) continue;
        counts.set(r.etiquetaPublico, (counts.get(r.etiquetaPublico) || 0) + 1);
    }

    let updated = 0;
    for (const r of rows) {
        if (!r.etiquetaPublico) continue;
        if ((counts.get(r.etiquetaPublico) || 0) <= 1) continue;
        const ctx = pickContext(r);
        if (!ctx) continue;
        r.etiquetaPublico = r.etiquetaPublico + ' (' + ctx + ')';
        updated++;
    }
    return updated;
}

function pickContext(row) {
    if (row._dateGroupKey && GROUP_LABEL_ES[row._dateGroupKey]) {
        return GROUP_LABEL_ES[row._dateGroupKey];
    }
    if (row.group && GROUP_LABEL_ES[row.group]) {
        return GROUP_LABEL_ES[row.group];
    }
    if (row._sectionName) return row._sectionName;
    if (row.group) return row.group;
    return null;
}

module.exports = {
    proposeName,
    detectRepeatableRow,
    resolveCollisions,
    addContextIfDuplicate,
    GROUP_LABEL_ES,
};
