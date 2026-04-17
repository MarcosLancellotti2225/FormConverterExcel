/**
 * JSON Builder (Lovable)
 * Assembles the final JSON in the exact shape Lovable consumes:
 *   { data: { id, templateId, versionNumber, status, signatureMode,
 *             jsonDefinition: { sections, validationRules, prefillMappings,
 *                               generatedDocuments, _sourcePdf, fieldPositions,
 *                               importedAt, sourceType },
 *             publishedAt, createdAt } }
 */
'use strict';

function buildLovableJson(ctx) {
    const {
        sections,
        pdfId,
        pdfBase64,
        pdfData,
        pdfFileName,
        meta
    } = ctx;

    const now = new Date().toISOString();
    const fileName = pdfFileName || (pdfData ? `${pdfId}.pdf` : null);
    const pageCount = pdfData?.numPages ?? 0;

    const builtSections = sections.map((sec, idx) => ({
        id: sec.id || `sec_page_${idx + 1}`,
        title: sectionTitle(sec, idx),
        description: null,
        order: idx + 1,
        fields: sec.fields.map(buildField)
    }));

    // Second pass: populate radioGroupFields by looking up sibling radios
    resolveRadioGroups(builtSections);

    const jsonDefinition = {
        sections: builtSections,
        validationRules: [],
        prefillMappings: [],
        generatedDocuments: [],
        _sourcePdf: pdfBase64 && fileName
            ? { fileName, pageCount, b64: pdfBase64 }
            : null,
        fieldPositions: pdfData ? buildFieldPositions(pdfData) : [],
        importedAt: now,
        sourceType: 'pdf'
    };

    return {
        data: {
            id: null,
            templateId: null,
            versionNumber: 1,
            status: 1,
            signatureMode: null,
            jsonDefinition,
            publishedAt: null,
            createdAt: now
        }
    };
}

function sectionTitle(sec, idx) {
    if (sec.title && /^p[aá]gina\s+\d+$/i.test(sec.title)) {
        return `Page ${idx + 1}`;
    }
    return sec.title || `Page ${idx + 1}`;
}

function buildField(f) {
    const id = prefixId(f.id);
    const type = mapLovableType(f);

    const field = {
        id,
        label: f.label || '',
        type,
        placeholder: null,
        required: !!f.required,
        readOnly: !!f.readOnly,
        width: 'full',
        helpText: null,
        validationPattern: f.validationPattern || null,
        options: buildOptions(f),
        conditionalVisibility: buildConditionalVisibility(f),
        defaultValue: f.value && !(f.options && f.options.length) ? f.value : null,
        sourceMeta: buildSourceMeta(f),
        prefillMode: f.required ? 'required' : 'optional',
        prefillKey: resolvePrefillKey(f),
        radioGroupFields: []   // populated in resolveRadioGroups()
    };

    return field;
}

function prefixId(id) {
    if (!id) return 'field_unknown';
    return id.startsWith('field_') ? id : `field_${id}`;
}

/**
 * Map matrix/pdf types to Lovable types: text|select|radio|number|phone|email
 */
function mapLovableType(f) {
    const hintLabel = (f.label || '').toLowerCase();
    const hintJson  = (f.jsonName || '').toLowerCase();
    if (/email|correo/.test(hintLabel) || /email|correo/.test(hintJson)) return 'email';
    if (/tel[eé]fono|celular|movil|m[oó]vil|phone/.test(hintLabel) || /telefono|celular|phone/.test(hintJson)) return 'phone';

    switch (f.type) {
        case 'radio':    return 'radio';
        case 'select':   return 'select';
        case 'number':   return 'number';
        case 'checkbox': return 'radio';
        case 'date':     return 'text';
        case 'heading':  return 'text';
        case 'readonly': return 'text';
        case 'text':
        default:         return 'text';
    }
}

function buildOptions(f) {
    if (!f.options || !f.options.length) return null;
    // Options arrive as {code,label}; Lovable wants strings (labels)
    return f.options.map(o => {
        if (typeof o === 'string') return o;
        return o.label || o.code || '';
    }).filter(Boolean);
}

/**
 * Convert internal conditionalVisibility ({dependsOn, equals}) into Lovable's
 * JSON-stringified shape: { logic, conditions:[{fieldId, operator, value?}] }
 */
function buildConditionalVisibility(f) {
    if (!f.conditionalVisibility) return null;
    let parsed;
    try { parsed = JSON.parse(f.conditionalVisibility); } catch { return null; }
    if (!parsed || !parsed.dependsOn) return null;

    const cond = { fieldId: prefixId(parsed.dependsOn) };
    if (parsed.equals === null || parsed.equals === undefined || parsed.equals === '') {
        cond.operator = 'not_empty';
    } else {
        cond.operator = 'equals';
        cond.value = String(parsed.equals);
    }

    return JSON.stringify({ logic: 'and', conditions: [cond] });
}

function buildSourceMeta(f) {
    if (!f.sourceMeta && !f.pdfCoords) return null;

    const rect = f.pdfCoords?.rect ? rectFromArray(f.pdfCoords.rect) : null;
    // Lovable expects 1-indexed pages (page:1 = first page, matching sec_page_1)
    const page = f.pdfCoords?.page != null ? f.pdfCoords.page + 1 : 1;
    return {
        kind: 'pdf',
        sourceName: f.sourceMeta?.sourceName || f.pdfFieldName || null,
        sourceNames: null,
        page,
        rect,
        sourceRects: rect ? [rect] : null,
        buttonFlags: null,
        sourceType: 'pdf'
    };
}

function rectFromArray(arr) {
    if (!arr || arr.length < 4) return null;
    const [x, y, width, height] = arr;
    return { x, y, width, height };
}

function resolvePrefillKey(f) {
    const raw = (f.jsonName || '').trim();
    if (!raw) return null;
    // Take first path if multiple were listed ("codigo, descripcion")
    const first = raw.split(/[,;/]|\s+y\s+/i)[0].trim();
    return first || null;
}

/**
 * Group radio fields that share an AcroForm parent so each radio lists its siblings.
 * Heuristic: radios whose sourceName share the same "/ParentGroup/..." prefix are
 * treated as one group. Single radios stay with an empty array.
 */
function resolveRadioGroups(sections) {
    const allRadios = [];
    for (const sec of sections) {
        for (const f of sec.fields) {
            if (f.type === 'radio') allRadios.push(f);
        }
    }
    if (allRadios.length < 2) return;

    const groups = new Map();
    for (const r of allRadios) {
        const key = radioGroupKey(r);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }

    for (const [, members] of groups) {
        if (members.length < 2) continue;
        for (const m of members) {
            m.radioGroupFields = members.filter(x => x.id !== m.id).map(x => x.id);
        }
    }
}

function radioGroupKey(field) {
    const src = field.sourceMeta?.sourceName;
    if (!src) return null;
    // Everything before the last "/" is the parent — siblings share it.
    const idx = src.lastIndexOf('/');
    if (idx > 0) return src.slice(0, idx);
    // No hierarchy: fall back to field label without trailing options
    return (field.label || '').toLowerCase().trim() || null;
}

/**
 * Flatten the parsed PDF AcroForm fields into fieldPositions[].
 * One entry per widget so multi-widget fields (radio groups) are all represented.
 */
function buildFieldPositions(pdfData) {
    if (!pdfData || !pdfData.fields) return [];
    const out = [];
    for (const name of Object.keys(pdfData.fields)) {
        const entry = pdfData.fields[name];
        const widgets = entry.widgets && entry.widgets.length
            ? entry.widgets
            : (entry.rect ? [{ page: entry.page, rect: entry.rect }] : []);

        if (!widgets.length) {
            out.push({
                sourceName: name,
                page: (entry.page ?? 0) + 1,
                hasCoordinates: false,
                xPx: 0, yPx: 0, widthPx: 0, heightPx: 0,
                xInt: 0, yInt: 0, widthInt: 0, heightInt: 0
            });
            continue;
        }

        for (const w of widgets) {
            const [x, y, width, height] = w.rect || [0, 0, 0, 0];
            out.push({
                sourceName: name,
                page: (w.page ?? 0) + 1,
                hasCoordinates: !!w.rect,
                xPx: x, yPx: y, widthPx: width, heightPx: height,
                xInt: Math.round(x),
                yInt: Math.round(y),
                widthInt: Math.round(width),
                heightInt: Math.round(height)
            });
        }
    }
    return out;
}

module.exports = { buildLovableJson, buildField };
