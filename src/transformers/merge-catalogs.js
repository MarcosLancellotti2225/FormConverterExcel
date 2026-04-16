/**
 * Merge Catalogs
 * Resolves each Field's options[] against the catalogs map.
 * If a field's dataType is a combo/select and its label/pdfLabel matches a catalog name,
 * its options are replaced by the catalog entries (code + label).
 */
'use strict';

const { normalizeKey } = require('../parsers/catalogs-parser');

/**
 * Field.options arrive as [{code,label}] from excel-parser; this stage overwrites
 * them with the canonical catalog when one exists, and tags the catalog name
 * so json-builder can emit proper prefillKeys for code+description combos.
 */
function mergeCatalogs(fields, catalogs) {
    const catalogIndex = {};
    for (const key of Object.keys(catalogs)) {
        catalogIndex[normalizeKey(key)] = { name: key, options: catalogs[key] };
    }

    for (const field of fields) {
        if (field.type !== 'select' && field.type !== 'radio') continue;

        const candidates = buildCatalogCandidates(field);
        for (const cand of candidates) {
            const found = catalogIndex[cand];
            if (found) {
                field.catalogName = found.name;
                // Overwrite options only if the field doesn't already hold a richer list
                if (!field.options || field.options.length <= 1) {
                    field.options = found.options;
                }
                break;
            }
        }
    }

    return fields;
}

function buildCatalogCandidates(field) {
    const set = new Set();
    const push = s => s && set.add(normalizeKey(s));

    push(field.label);
    push(field.pdfLabel);
    // "Tipo Identificación" / "tipo_identificacion" / "tipoIdentificacion"
    push(field.label?.replace(/^tipo\s+de\s+/i, 'tipo '));
    push(field.jsonName);

    // Common mappings between field labels and catalog sheet names
    const lower = (field.label || '').toLowerCase();
    if (/moneda/.test(lower))            push('Moneda');
    if (/estado\s*civil/.test(lower))    push('Estado Civil');
    if (/parentesco/.test(lower))        push('Parentesco');
    if (/tipo\s+formulario/.test(lower)) push('Tipo Formulario');
    if (/tipo\s+persona/.test(lower))    push('Tipo Persona');
    if (/tipo\s*tr[aá]mite/.test(lower)) push('TipoTramite');
    if (/tipo\s+identificaci[oó]n/.test(lower)) push('Tipo Identificación');

    return Array.from(set);
}

module.exports = { mergeCatalogs };
