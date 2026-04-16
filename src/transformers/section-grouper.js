/**
 * Section Grouper
 * Groups Field[] into Section[] for the Lovable JSON output.
 *
 * Default strategy: logical sections built from "Pasos Formulario" + "Sección".
 * Alternative: `sec_page_N` based on PDF page. Controlled by `strategy`.
 *
 * TODO-LOVABLE-1: confirmar con dev si las secciones deben ser lógicas (step+section)
 * o `sec_page_N` (como en el ejemplo actual). Por defecto usamos lógicas.
 */
'use strict';

const DEFAULT_STRATEGY = 'logical';

function groupBySections(fields, strategy = DEFAULT_STRATEGY) {
    if (strategy === 'pdf_page') {
        return groupByPdfPage(fields);
    }
    return groupByLogical(fields);
}

function groupByLogical(fields) {
    const sections = [];
    const map = new Map();

    for (const field of fields) {
        const stepTitle = field.step || 'General';
        const secTitle = field.section || field.step || 'Datos';
        const key = `${slug(stepTitle)}__${slug(secTitle)}`;

        if (!map.has(key)) {
            const section = {
                id: `sec_${slug(stepTitle)}_${slug(secTitle)}`,
                stepTitle,
                title: secTitle,
                order: sections.length,
                fields: []
            };
            map.set(key, section);
            sections.push(section);
        }
        map.get(key).fields.push(field);
    }

    return sections;
}

function groupByPdfPage(fields) {
    const sections = [];
    const map = new Map();

    for (const field of fields) {
        const page = field.pdfCoords?.page ?? 0;
        const key = `page_${page}`;

        if (!map.has(key)) {
            const section = {
                id: `sec_page_${page + 1}`,
                stepTitle: `Página ${page + 1}`,
                title: `Página ${page + 1}`,
                order: sections.length,
                fields: []
            };
            map.set(key, section);
            sections.push(section);
        }
        map.get(key).fields.push(field);
    }

    return sections;
}

function slug(str) {
    return String(str || 'x')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'x';
}

/**
 * After rule-parser flags trigger fields (cond._kind = 'triggerOn'),
 * re-route those conditions onto the DEPENDENT field in the section list.
 *
 * Expects: conditionalVisibility as a JSON string with `_kind: 'triggerOn'`
 * Produces: dependents get `conditionalVisibility: JSON.stringify({ dependsOn, equals })`
 * and the trigger row is cleared.
 */
function resolveTriggerConditionals(sections) {
    const allFields = sections.flatMap(s => s.fields);
    const byLabelOrId = new Map();
    for (const f of allFields) {
        byLabelOrId.set(norm(f.label), f);
        byLabelOrId.set(f.id, f);
    }

    for (const f of allFields) {
        if (!f.conditionalVisibility) continue;
        let parsed;
        try { parsed = JSON.parse(f.conditionalVisibility); } catch { continue; }
        if (parsed._kind !== 'triggerOn') continue;

        const target = byLabelOrId.get(norm(parsed.target));
        if (target) {
            target.conditionalVisibility = JSON.stringify({
                dependsOn: parsed.triggerField,
                equals: parsed.triggerValue
            });
        }
        // Clear the trigger hint regardless — it's metadata, not an actual rule on this field
        f.conditionalVisibility = null;
    }
}

function norm(s) {
    return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim();
}

module.exports = { groupBySections, resolveTriggerConditionals };
