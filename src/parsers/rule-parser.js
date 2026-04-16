/**
 * Rule Parser
 * Infers conditionalVisibility + validation constraints from the natural-language
 * contents of `Regla` and `Observaciones` columns in the matrix.
 *
 * Recognized patterns (case-insensitive, accent-insensitive):
 *   - "Si se selecciona {valor} se (debe|debe de) (habilitar|desplegar|mostrar) el campo {label}"
 *   - "Si selecciona {valor} se despliega {label}"
 *   - "Si el (campo|usuario) {label} = {valor} ..."
 *   - "Si {label} es {valor} ..."
 *   - "Depende de {label}"
 *
 * For validations:
 *   - "N caracteres"   → maxLength = N
 *   - "formato dd/mm/aaaa" / "formato dd-mm-yyyy" → pattern date
 *   - "sólo números" / "solo numeros"            → pattern digits
 *   - "alfanumérico"                             → pattern alnum
 *   - "email" / "correo"                         → pattern email
 */
'use strict';

const ACCENTS_RE = /[\u0300-\u036f]/g;

/**
 * Apply the rule parser to a list of Field[] (mutates in place, returns same array).
 * Also returns a warnings[] list for unparseable rules.
 */
function applyRules(fields) {
    const byLabel = buildLabelIndex(fields);
    const warnings = [];

    for (const field of fields) {
        const { pattern, maxLength } = parseValidation(field.rule, field.dataTypeRaw);
        field.validationPattern = pattern;
        field.maxLength = maxLength;

        const text = joinTexts(field.rule, field.obs);
        if (!text) continue;

        const cond = parseConditional(text, field, byLabel, warnings);
        if (cond) {
            field.conditionalVisibility = JSON.stringify(cond);
        }
    }

    return { fields, warnings };
}

/**
 * Build a { normalizedLabel → field.id } index for cross-field reference lookups.
 */
function buildLabelIndex(fields) {
    const idx = new Map();
    for (const f of fields) {
        if (f.label) {
            idx.set(normalize(f.label), f.id);
        }
        if (f.pdfLabel && f.pdfLabel !== f.label) {
            idx.set(normalize(f.pdfLabel), f.id);
        }
    }
    return idx;
}

/**
 * Parse validations from rule text.
 */
function parseValidation(rule, dataTypeRaw) {
    const out = { pattern: null, maxLength: null };
    if (!rule) return out;
    const r = normalize(rule);

    // Length: "N caracteres" or "hasta N caracteres" or "max N"
    const lenMatch = r.match(/(\d+)\s*caract/)
                  || r.match(/max(?:imo)?\s*[:=]?\s*(\d+)/);
    if (lenMatch) {
        out.maxLength = parseInt(lenMatch[1], 10);
    }

    // Date format
    if (/formato\s+dd\/?mm\/?(aaaa|yyyy)/.test(r) || /dd\/mm\/aaaa/.test(r)) {
        out.pattern = '^\\d{2}/\\d{2}/\\d{4}$';
    } else if (/formato\s+dd-mm-(aaaa|yyyy)/.test(r)) {
        out.pattern = '^\\d{2}-\\d{2}-\\d{4}$';
    }

    // Numeric-only
    if (!out.pattern && (/s[oó]lo\s*n[uú]meros/.test(r) || /solo\s*numeros/.test(r) || /only\s*digits/.test(r))) {
        out.pattern = '^\\d+$';
    }

    // Email
    if (!out.pattern && (/email|correo/.test(r) && dataTypeRaw)) {
        out.pattern = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
    }

    // Alphanumeric
    if (!out.pattern && /alfanum/.test(r)) {
        out.pattern = '^[A-Za-z0-9 ]+$';
    }

    return out;
}

/**
 * Parse conditional visibility rules. Returns an object like
 *   { dependsOn: <fieldId>, equals: '<value>' }
 * or `null` if no conditional can be inferred.
 */
function parseConditional(text, field, byLabel, warnings) {
    const n = normalize(text);

    // Pattern A: "si se selecciona X se [...] Y"
    // This rule lives on the TRIGGER field ("X" is a value of this field)
    const triggerRe = /si\s+se\s+(selecciona|elige|marca)\s+([^,.;]+?)\s+se\s+(?:debe(?:\s+de)?\s+)?(?:habilitar|desplegar|mostrar|visualizar|mostrar el campo)\s+(?:el\s+campo\s+)?([^,.;]+)/;
    const mA = n.match(triggerRe);
    if (mA) {
        // The current field IS the trigger, the condition is applied to the dependent.
        // In Lovable, conditionalVisibility goes on the DEPENDENT field, so the matrix
        // describes how a dependent reveals itself when the trigger equals "X".
        // If the matrix row is the trigger, we store a reverse hint so the section-grouper
        // can push this rule onto the dependent field.
        return {
            _kind: 'triggerOn',
            triggerField: field.id,
            triggerValue: cleanValue(mA[2]),
            target: cleanValue(mA[3])
        };
    }

    // Pattern B: "si [campo] = X" / "si [label] es X"
    const depRe = /si\s+(?:el\s+campo\s+|el\s+|la\s+|los\s+)?([a-z0-9 áéíóúñ]+?)\s+(?:es|=|==|igual\s+a)\s+([a-z0-9 ]+)/;
    const mB = n.match(depRe);
    if (mB) {
        const targetLabel = mB[1].trim();
        const targetValue = cleanValue(mB[2]);
        const depId = byLabel.get(normalize(targetLabel));
        if (depId) {
            return { dependsOn: depId, equals: targetValue };
        }
        warnings.push({
            type: 'unknown_reference',
            row: field._rowIndex,
            field: field.label,
            text,
            reason: `Could not resolve referenced field "${targetLabel}"`
        });
        return null;
    }

    // Pattern C: "Depende de X"
    const depSimple = n.match(/depende\s+de\s+([a-z0-9 áéíóúñ]+)/);
    if (depSimple) {
        const targetLabel = depSimple[1].trim();
        const depId = byLabel.get(normalize(targetLabel));
        if (depId) {
            return { dependsOn: depId, equals: null };
        }
    }

    // Pattern D: free-form heuristic — if field label suggests "detalle de X" / "cantidad de X"
    // and obs mentions "si" and "no"
    if (/\bsi\b/.test(n) && /\bno\b/.test(n) && /desplega|habilita|muestra/.test(n)) {
        warnings.push({
            type: 'ambiguous_rule',
            row: field._rowIndex,
            field: field.label,
            text,
            reason: 'Matches yes/no display pattern but could not identify trigger'
        });
        return null;
    }

    // Nothing matched, but there's text → log so a human can review
    if (/\bsi\b|\bdepende\b|\bvisualiza\b|\bdesplieg/.test(n)) {
        warnings.push({
            type: 'unparsed_rule',
            row: field._rowIndex,
            field: field.label,
            text,
            reason: 'Text looks conditional but no known pattern matched'
        });
    }

    return null;
}

function joinTexts(...parts) {
    return parts.filter(Boolean).join(' · ');
}

function cleanValue(raw) {
    return String(raw)
        .replace(/[.,:;]+$/, '')
        .replace(/^['"]+|['"]+$/g, '')
        .trim();
}

function normalize(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD').replace(ACCENTS_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    applyRules,
    // exports for tests
    _internal: { parseValidation, parseConditional, normalize }
};
