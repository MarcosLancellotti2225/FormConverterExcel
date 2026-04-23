'use strict';

function regroupSections(fields, matchMap) {
    const sectionOrder = [];
    const sectionMap = new Map();
    const unmatched = [];

    for (const f of fields) {
        const match = matchMap.get(f.id);
        if (!match || !match.row) {
            unmatched.push(f);
            continue;
        }

        const step = match.row.step || 'General';
        const section = match.row.section || step || 'Datos';
        const key = slug(step) + '__' + slug(section);

        if (!sectionMap.has(key)) {
            const sec = {
                id: 'section_' + slug(step) + '_' + slug(section),
                title: section,
                description: step !== section ? step : null,
                instructions: null,
                conditionalVisibility: null,
                order: sectionOrder.length + 1,
                fields: [],
            };
            sectionMap.set(key, sec);
            sectionOrder.push(key);
        }

        sectionMap.get(key).fields.push(f);
    }

    const sections = sectionOrder.map(k => sectionMap.get(k));

    if (unmatched.length > 0) {
        sections.push({
            id: 'section_sin_clasificar',
            title: 'Sin clasificar',
            description: 'Campos sin match en el Excel',
            instructions: null,
            conditionalVisibility: null,
            order: sections.length + 1,
            fields: unmatched,
        });
    }

    return sections;
}

function slug(str) {
    return String(str || 'x')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'x';
}

module.exports = { regroupSections };
