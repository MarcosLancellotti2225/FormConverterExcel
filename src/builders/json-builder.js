/**
 * JSON Builder (Lovable)
 * Assembles the final JSON for one PDF product from enriched fields + sections.
 *
 * TODO-LOVABLE-2: beneficiarios como repeatable vs N instancias planas.
 *   Default: `repeatable: true`.
 * TODO-LOVABLE-3: combos con código + descripción.
 *   Default: prefillKey principal + mappedPaths[].
 * TODO-LOVABLE-4: un JSON por producto (default) vs único multi-producto.
 * TODO-LOVABLE-5: campos ocultos → hidden inline (default).
 * TODO-LOVABLE-6: concat automática (NombreCompleto) con `computed` flag.
 */
'use strict';

function buildLovableJson(ctx) {
    const { sections, pdfId, pdfBase64, meta, catalogs } = ctx;

    const out = {
        $schema: 'lovable-form.v1',
        productCode: pdfId,
        productName: meta?.productName || pdfId,
        version: meta?.version || '0.1.0',
        generatedAt: new Date().toISOString(),
        _sourcePdf: pdfBase64
            ? { fileName: `${pdfId}.pdf`, encoding: 'base64', b64: pdfBase64 }
            : undefined,
        sections: sections.map(sec => ({
            id: sec.id,
            stepTitle: sec.stepTitle,
            title: sec.title,
            order: sec.order,
            fields: sec.fields.map(buildField)
        })),
        // TODO-LOVABLE-4: if consolidating products, wrap the above in a products[] list
        _meta: {
            catalogNames: Object.keys(catalogs || {}),
            fieldCount: sections.reduce((n, s) => n + s.fields.length, 0)
        }
    };

    return out;
}

function buildField(f) {
    const field = {
        id: f.id,
        label: f.label,
        type: f.type,
        required: !!f.required,
        readOnly: !!f.readOnly,
        hidden: !!f.hidden // TODO-LOVABLE-5: confirmar estrategia de hidden
    };

    if (f.value && !f.options?.length) field.defaultValue = f.value;

    if (f.options?.length) {
        field.options = f.options;
        // Detect repeatable groups heuristically (beneficiarios, dependientes)
        // TODO-LOVABLE-2: beneficiarios — definir estrategia final
        if (/beneficiario|dependiente/i.test(f.label)) {
            field.repeatable = true;
        }
    }

    if (f.validationPattern) field.validationPattern = f.validationPattern;
    if (f.maxLength)         field.maxLength = f.maxLength;

    if (f.conditionalVisibility) field.conditionalVisibility = f.conditionalVisibility;

    if (f.productScope && !f.productScope.includes('all')) {
        field.productScope = f.productScope;
    }

    // prefillKey + mappedPaths — TODO-LOVABLE-3
    const { prefillKey, mappedPaths } = resolvePrefillPaths(f);
    if (prefillKey) field.prefillKey = prefillKey;
    if (mappedPaths && mappedPaths.length) field.mappedPaths = mappedPaths;

    if (f.catalogName) field.catalog = f.catalogName;

    // TODO-LOVABLE-6: `computed` for Nombre Completo / full-name style concatenations
    if (/nombre\s*completo/i.test(f.label)) {
        field.computed = {
            sources: ['primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido'],
            join: ' '
        };
    }

    // sourceMeta (link back to PDF AcroForm field)
    if (f.sourceMeta) {
        field.sourceMeta = f.sourceMeta;
        if (f.pdfCoords) {
            field.sourceMeta.page = f.pdfCoords.page;
            field.sourceMeta.rect = f.pdfCoords.rect;
        }
    }

    return field;
}

/**
 * Parse the Excel "Nombre del Campo en Json" column for 1..N paths.
 * Formats seen in practice:
 *   - "codigoTipoFormulario"
 *   - "codigoTipoFormulario, descripcionTipoFormulario"
 *   - "Cliente.PrimerNombre"
 *   - "codigoTipoIdentificacion / descripcionTipoIdentificacion"
 */
function resolvePrefillPaths(field) {
    const raw = field.jsonName || '';
    if (!raw) return { prefillKey: null, mappedPaths: [] };

    const parts = raw.split(/[,;/]|\s+y\s+/i).map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) {
        return { prefillKey: parts[0], mappedPaths: [] };
    }
    // TODO-LOVABLE-3: decidir si prefillKey + mappedPaths[] o options con {code,label}.
    return { prefillKey: parts[0], mappedPaths: parts.slice(1) };
}

module.exports = { buildLovableJson, buildField };
