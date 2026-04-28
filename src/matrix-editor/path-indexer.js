'use strict';

/**
 * Path Indexer
 *
 * The client matrix carries JSON paths WITHOUT array indices, e.g.
 *   datosFormulario.personas.primerApellido
 *
 * The real client JSON uses an array `personas[]`:
 *   personas[0] → ASG  (asegurado/solicitante)
 *   personas[1] → BNF  (beneficiario 1)
 *   personas[2] → BNF  (beneficiario 2)
 *   personas[3] → BNF  (beneficiario 3)
 *
 * This module rewrites the bare path by injecting the right index based on
 * the section prefix that the row belongs to.
 *
 * Sections that don't live under `personas[]` (poliza_, solicitud_, etc.)
 * pass through unchanged.
 *
 * Future sections (DME, ASN) that we don't have a defined index for yet
 * emit a warning so a human can decide.
 */

const PERSONAS_INDEX = {
    'asegurado_':       0,
    'beneficiario_1_':  1,
    'beneficiario_2_':  2,
    'beneficiario_3_':  3,
};

const FUTURE_SECTIONS = ['dme_', 'asn_', 'dependiente_', 'codeudor_'];

const PERSONAS_TOKEN_RE = /\bpersonas\b(?!\s*\[)/g;

function addPathIndex(rawPath, sectionPrefix) {
    if (!rawPath) return { path: '', warning: false };

    const path = String(rawPath).trim();
    if (!path) return { path: '', warning: false };

    if (!path.includes('personas')) {
        return { path, warning: false };
    }

    if (PERSONAS_TOKEN_RE.test(path)) {
        PERSONAS_TOKEN_RE.lastIndex = 0;
    } else {
        PERSONAS_TOKEN_RE.lastIndex = 0;
        return { path, warning: false };
    }

    const prefix = String(sectionPrefix || '');

    if (Object.prototype.hasOwnProperty.call(PERSONAS_INDEX, prefix)) {
        const idx = PERSONAS_INDEX[prefix];
        const newPath = path.replace(PERSONAS_TOKEN_RE, 'personas[' + idx + ']');
        PERSONAS_TOKEN_RE.lastIndex = 0;
        return { path: newPath, warning: false };
    }

    if (FUTURE_SECTIONS.includes(prefix)) {
        console.warn(
            `[path-indexer] Section prefix "${prefix}" hits a personas[] path but ` +
            `no index is defined yet. Path left without index: "${path}". ` +
            `Add it to PERSONAS_INDEX once the JSON layout is known.`
        );
        return { path, warning: true };
    }

    console.warn(
        `[path-indexer] Path "${path}" mentions personas but section prefix ` +
        `"${prefix}" has no defined index. Leaving path unchanged.`
    );
    return { path, warning: true };
}

/**
 * Apply addPathIndex to both principal and secondary paths in one call.
 * Returns { principal, secundarios, warning } where `warning` is true when
 * either path triggered a warning.
 */
function indexPaths(principal, secundariosStr, sectionPrefix) {
    const p = addPathIndex(principal, sectionPrefix);

    const secList = String(secundariosStr || '')
        .split('|')
        .map(s => s.trim())
        .filter(Boolean);

    let warning = p.warning;
    const indexedSec = [];
    for (const sec of secList) {
        const r = addPathIndex(sec, sectionPrefix);
        indexedSec.push(r.path);
        if (r.warning) warning = true;
    }

    return {
        principal: p.path,
        secundarios: indexedSec.join(' | '),
        warning,
    };
}

module.exports = {
    addPathIndex,
    indexPaths,
    PERSONAS_INDEX,
    FUTURE_SECTIONS,
};
