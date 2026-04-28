'use strict';

/**
 * Section Detector
 *
 * Inputs (from the PDF):
 *   - textItems: [{ str, x, y, width, height, page }]    (pdf.js tokens)
 *   - fields:    [{ name, type, rect:{x,y,width,height}, page, detectedLabel }]
 *
 * Outputs:
 *   detectSections(textItems)
 *     → { headings, subHeadings }
 *
 *   assignSectionToField(field, headings, subHeadings)
 *     → { sectionHeading, sectionPrefix, subHeading, subHeadingPrefix, group, warnings }
 *
 *   detectDateGroups(fields, headings)
 *     → Map<fieldName, { groupKey: 'fecha_solicitud'|'fecha_nacimiento'|..., subHeadingPrefix: 'fecha_'|'fecha_nacimiento_', part: 'dia'|'mes'|'ano' }>
 *
 * Concatenation rule:
 *   acroFormPropuesto = sectionPrefix + subHeadingPrefix + slug(label)
 *
 * If the section heading or sub-heading is not in the whitelist:
 *   → empty prefix + console.warn (no invented prefixes).
 */

const SECTION_WHITELIST = [
    { match: ['lugar y fecha de solicitud'],                                   prefix: 'solicitud_',     name: 'Lugar y Fecha de Solicitud' },
    { match: ['datos de la poliza', 'datos de la póliza', 'poliza'],           prefix: 'poliza_',        name: 'Datos de la Póliza' },
    { match: ['datos del solicitante', 'datos del asegurado', 'asegurado',
              'solicitante'],                                                   prefix: 'asegurado_',     name: 'Datos del Solicitante' },
    { match: ['datos del objeto de interes', 'datos del objeto de interés',
              'objeto de interes', 'objeto de interés'],                       prefix: '',               name: 'Datos del Objeto de Interés' },
    { match: ['beneficiario', 'beneficiarios'],                                prefix: 'beneficiario_',  name: 'Beneficiarios', repeatable: true },
    { match: ['plazo de vigencia', 'vigencia'],                                prefix: 'vigencia_',      name: 'Plazo de Vigencia' },
    { match: ['notificaciones', 'notificacion', 'notificación'],               prefix: 'notificacion_',  name: 'Notificaciones' },
    { match: ['firma', 'tomador'],                                             prefix: 'tomador_',       name: 'Firma / Tomador' },
];

const SUBHEADING_WHITELIST = [
    { match: ['tipo de identificacion', 'tipo de identificación',
              'tipo identificacion', 'tipo identificación'],                   prefix: 'tipo_id_',  group: 'tipo_identificacion' },
    { match: ['sexo'],                                                          prefix: 'sexo_',     group: 'sexo' },
    { match: ['en calidad de'],                                                 prefix: 'calidad_',  group: 'calidad' },
];

const DATE_PART_LABELS = {
    dia: ['dia', 'día'],
    mes: ['mes'],
    ano: ['ano', 'año'],
};

const HEADING_MIN_LEN     = 8;       // "POLIZA" is 6, but real headings are 10+
const HEADING_UPPER_RATIO = 0.7;     // % uppercase letters
const SUBHEADING_MAX_LEN  = 40;
const SUBHEADING_CHECKBOX_Y_TOLERANCE = 6;
const SUBHEADING_MIN_CHECKBOXES = 2;
const SUBHEADING_MAX_CHECKBOXES = 8;
const DATE_TRIPLET_X_GAP = 80;       // max x distance between día/mes/año

const ACCENTS_RE = /[̀-ͯ]/g;

function normalize(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(ACCENTS_RE, '');
}

function slugify(s) {
    return normalize(s)
        .replace(/[^a-z0-9\s_]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function looksLikeHeading(text) {
    const trimmed = text.trim();
    if (trimmed.length < HEADING_MIN_LEN) return false;
    const letters = trimmed.replace(/[^a-zA-ZÁÉÍÓÚÑÜ]/g, '');
    if (letters.length === 0) return false;
    const upper = letters.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, '');
    return (upper.length / letters.length) >= HEADING_UPPER_RATIO;
}

function matchSectionWhitelist(text) {
    const n = normalize(text);
    for (const entry of SECTION_WHITELIST) {
        for (const kw of entry.match) {
            if (n.includes(kw)) return entry;
        }
    }
    return null;
}

function matchSubHeadingWhitelist(text) {
    const n = normalize(text).replace(/[:.]+$/, '').trim();
    for (const entry of SUBHEADING_WHITELIST) {
        for (const kw of entry.match) {
            if (n === kw || n.startsWith(kw + ' ') || n.endsWith(' ' + kw)) return entry;
        }
    }
    return null;
}

function detectSections(textItems, fields) {
    const headings = [];
    const subHeadings = [];

    for (const item of textItems || []) {
        const text = item.str.trim();
        if (!text) continue;

        const wl = matchSectionWhitelist(text);
        if (wl && (looksLikeHeading(text) || /^[A-ZÁÉÍÓÚÑÜ\s\d./-]+$/.test(text))) {
            const beneficiarioN = wl.repeatable ? extractBeneficiarioNumber(text) : null;
            headings.push({
                text, page: item.page, x: item.x, y: item.y,
                width: item.width, height: item.height,
                prefix: wl.prefix, name: wl.name,
                repeatable: !!wl.repeatable,
                beneficiarioN,
            });
            continue;
        }

        if (text.endsWith(':') && text.length <= SUBHEADING_MAX_LEN) {
            const sw = matchSubHeadingWhitelist(text);
            if (sw) {
                subHeadings.push({
                    text, page: item.page, x: item.x, y: item.y,
                    width: item.width, height: item.height,
                    prefix: sw.prefix, group: sw.group, source: 'whitelist',
                });
                continue;
            }
            if (fields && hasCheckboxesAlignedBelow(item, fields)) {
                console.warn(
                    `[section-detector] Sub-heading no en whitelist: "${text}" (page ${item.page + 1}). ` +
                    `Considerar agregar a SUBHEADING_WHITELIST. Aplicando prefijo vacío.`
                );
                subHeadings.push({
                    text, page: item.page, x: item.x, y: item.y,
                    width: item.width, height: item.height,
                    prefix: '', group: slugify(text.replace(/:$/, '')),
                    source: 'fallback-warned',
                });
            }
        }
    }

    return { headings, subHeadings };
}

function extractBeneficiarioNumber(text) {
    const m = text.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

function hasCheckboxesAlignedBelow(textItem, fields) {
    let count = 0;
    for (const f of fields) {
        if (f.page !== textItem.page) continue;
        if (f.type !== 'checkbox' && f.type !== 'radio' && f.type !== 'button') continue;
        const fieldTopY = f.rect.y + f.rect.height;
        if (fieldTopY > textItem.y - 4) continue;
        if ((textItem.y - fieldTopY) > 30) continue;
        const sameRowCheckboxes = fields.filter(g =>
            g !== f && g.page === f.page &&
            (g.type === 'checkbox' || g.type === 'radio' || g.type === 'button') &&
            Math.abs(g.rect.y - f.rect.y) <= SUBHEADING_CHECKBOX_Y_TOLERANCE
        );
        count = Math.max(count, sameRowCheckboxes.length + 1);
    }
    return count >= SUBHEADING_MIN_CHECKBOXES && count <= SUBHEADING_MAX_CHECKBOXES;
}

function assignSectionToField(field, headings, subHeadings) {
    const warnings = [];

    const sectionCandidates = (headings || [])
        .filter(h => h.page === field.page)
        .filter(h => h.y > (field.rect.y + field.rect.height))
        .sort((a, b) => a.y - b.y);
    const section = sectionCandidates[0] || null;

    let subHeading = null;
    if (subHeadings) {
        const subCandidates = subHeadings
            .filter(s => s.page === field.page)
            .filter(s => s.y > (field.rect.y + field.rect.height))
            .filter(s => !section || s.y <= section.y)
            .sort((a, b) => a.y - b.y);
        if (subCandidates.length > 0) {
            const closest = subCandidates[0];
            const distToField = closest.y - (field.rect.y + field.rect.height);
            if (distToField <= 60) subHeading = closest;
        }
    }

    if (!section) {
        warnings.push({
            type: 'no_section_match',
            fieldName: field.name,
            page: field.page,
        });
    }

    return {
        sectionHeading:    section ? section.text : null,
        sectionName:       section ? section.name : null,
        sectionPrefix:     section ? section.prefix : '',
        beneficiarioN:     section ? section.beneficiarioN : null,
        sectionRepeatable: section ? !!section.repeatable : false,
        subHeading:        subHeading ? subHeading.text : null,
        subHeadingPrefix:  subHeading ? subHeading.prefix : '',
        group:             subHeading ? subHeading.group : null,
        warnings,
    };
}

function detectDateGroups(fields, headings, textItems) {
    const result = new Map();
    if (!fields || fields.length === 0) return result;

    const byPage = new Map();
    for (const f of fields) {
        if (f.type !== 'text') continue;
        const part = identifyDatePart(f.detectedLabel);
        if (!part) continue;
        if (!byPage.has(f.page)) byPage.set(f.page, []);
        byPage.get(f.page).push({ field: f, part });
    }

    for (const [page, candidates] of byPage) {
        const triplets = groupIntoTriplets(candidates);
        for (const trip of triplets) {
            const ctxHeading = findDateContextHeading(trip, headings);
            const subHeadingPrefix = buildDateSubHeadingPrefix(trip, ctxHeading, textItems, page);
            const groupKey = buildDateGroupKey(ctxHeading, subHeadingPrefix);

            for (const entry of trip) {
                result.set(entry.field.name, {
                    groupKey,
                    subHeadingPrefix,
                    part: entry.part,
                    contextHeading: ctxHeading ? ctxHeading.text : null,
                });
            }
        }
    }

    return result;
}

function identifyDatePart(label) {
    if (!label) return null;
    const n = normalize(label).replace(/[:.]+$/, '').trim();
    for (const [part, aliases] of Object.entries(DATE_PART_LABELS)) {
        if (aliases.includes(n)) return part;
    }
    return null;
}

function groupIntoTriplets(candidates) {
    if (candidates.length < 2) return [];
    const sorted = [...candidates].sort((a, b) => {
        if (Math.abs(a.field.rect.y - b.field.rect.y) > 5) return b.field.rect.y - a.field.rect.y;
        return a.field.rect.x - b.field.rect.x;
    });

    const triplets = [];
    let current = [];

    for (const c of sorted) {
        if (current.length === 0) {
            current.push(c);
            continue;
        }
        const last = current[current.length - 1];
        const sameRow = Math.abs(c.field.rect.y - last.field.rect.y) <= 5;
        const closeX  = (c.field.rect.x - (last.field.rect.x + last.field.rect.width)) <= DATE_TRIPLET_X_GAP;
        if (sameRow && closeX) {
            current.push(c);
        } else {
            if (current.length >= 2) triplets.push(current);
            current = [c];
        }
    }
    if (current.length >= 2) triplets.push(current);

    return triplets;
}

function findDateContextHeading(triplet, headings) {
    if (!headings || headings.length === 0) return null;
    const firstField = triplet[0].field;
    const candidates = headings
        .filter(h => h.page === firstField.page)
        .filter(h => h.y > (firstField.rect.y + firstField.rect.height))
        .sort((a, b) => a.y - b.y);
    return candidates[0] || null;
}

function buildDateSubHeadingPrefix(triplet, sectionHeading, textItems, page) {
    if (!sectionHeading) return 'fecha_';
    const sectionN = normalize(sectionHeading.text);
    if (sectionN.includes('fecha de solicitud') || sectionN.includes('lugar y fecha de solicitud')) {
        return 'fecha_';
    }
    const firstField = triplet[0].field;
    const intermediateText = findIntermediateText(firstField, sectionHeading, textItems, page);
    if (!intermediateText) return 'fecha_';
    const intermediateN = normalize(intermediateText);
    if (intermediateN.includes('fecha de nacimiento') || intermediateN.includes('nacimiento')) {
        return 'fecha_nacimiento_';
    }
    if (intermediateN.includes('vigencia desde') || intermediateN.includes('desde')) {
        return 'fecha_desde_';
    }
    if (intermediateN.includes('vigencia hasta') || intermediateN.includes('hasta')) {
        return 'fecha_hasta_';
    }
    const slug = slugify(intermediateText.replace(/[:.]+$/, ''));
    if (slug && slug.length > 0 && slug.length < 30) {
        return 'fecha_' + slug + '_';
    }
    return 'fecha_';
}

/**
 * Look for descriptive text between the date triplet and the section heading above it.
 * Returns the closest text token directly above the triplet that is descriptive
 * (not "Día"/"Mes"/"Año" and not the section heading itself).
 */
function findIntermediateText(field, sectionHeading, textItems, page) {
    if (!textItems) return null;
    const tripletTopY = field.rect.y + field.rect.height;
    const sectionY = sectionHeading.y;

    const candidates = textItems
        .filter(t => t.page === page)
        .filter(t => t.y > tripletTopY && t.y < sectionY)
        .filter(t => {
            const n = normalize(t.str).replace(/[:.]+$/, '').trim();
            if (!n) return false;
            if (DATE_PART_LABELS.dia.includes(n)) return false;
            if (DATE_PART_LABELS.mes.includes(n)) return false;
            if (DATE_PART_LABELS.ano.includes(n)) return false;
            return true;
        })
        .sort((a, b) => a.y - b.y);

    if (candidates.length === 0) return null;
    return candidates[0].str;
}

function buildDateGroupKey(sectionHeading, subHeadingPrefix) {
    if (subHeadingPrefix === 'fecha_nacimiento_') return 'fecha_nacimiento';
    if (subHeadingPrefix === 'fecha_desde_')      return 'vigencia_desde';
    if (subHeadingPrefix === 'fecha_hasta_')      return 'vigencia_hasta';
    if (sectionHeading) {
        const n = normalize(sectionHeading.text);
        if (n.includes('solicitud')) return 'fecha_solicitud';
    }
    return 'fecha';
}

module.exports = {
    detectSections,
    assignSectionToField,
    detectDateGroups,
    SECTION_WHITELIST,
    SUBHEADING_WHITELIST,
    _internal: { slugify, normalize, looksLikeHeading, matchSectionWhitelist, matchSubHeadingWhitelist, identifyDatePart, groupIntoTriplets },
};
