/**
 * Prefill Key Validator
 * Walks the client JSON (`Json_Formulario_Vida_-_Asegurado.txt`) and builds a set
 * of all canonical paths, then flags any prefillKey / mappedPaths[] that aren't
 * present in that tree.
 *
 * The goal is not to block generation but to surface misalignments early so the
 * pipeline output stays aligned with the INS API payload.
 */
'use strict';

const fs = require('fs');

/**
 * Build the path set from the cliente JSON text file.
 * @param {string} clientJsonPath
 * @returns {Set<string>}  canonical paths like "Cliente.PrimerNombre", arrays as "Cliente.Telefonos.Telefono[].Numero"
 */
function loadClientPaths(clientJsonPath) {
    if (!fs.existsSync(clientJsonPath)) {
        return new Set();
    }
    const raw = fs.readFileSync(clientJsonPath, 'utf-8').trim();
    if (!raw) return new Set();

    let json;
    try {
        json = JSON.parse(raw);
    } catch (err) {
        // Files saved with trailing commas / JS-ish extensions — best-effort fix
        try {
            json = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1'));
        } catch (e2) {
            console.warn('prefillkey-validator: could not parse client JSON:', e2.message);
            return new Set();
        }
    }

    const paths = new Set();
    walk(json, '', paths);
    return paths;
}

function walk(node, base, out) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
        out.add(base + '[]');
        if (node.length > 0) walk(node[0], base + '[]', out);
        return;
    }
    if (typeof node === 'object') {
        if (base) out.add(base);
        for (const key of Object.keys(node)) {
            const next = base ? `${base}.${key}` : key;
            walk(node[key], next, out);
        }
        return;
    }
    // scalar leaf
    out.add(base);
}

/**
 * Validate a Lovable JSON output against the client path set.
 * Returns list of { field, prefillKey, reason } for any path that doesn't match.
 */
function validateLovableJson(lovableJson, clientPaths) {
    const issues = [];
    if (!clientPaths || clientPaths.size === 0) return issues;

    for (const sec of lovableJson.sections || []) {
        for (const f of sec.fields || []) {
            const toCheck = [];
            if (f.prefillKey)      toCheck.push(f.prefillKey);
            if (f.mappedPaths)     toCheck.push(...f.mappedPaths);

            for (const key of toCheck) {
                if (!key) continue;
                if (!isKnownPath(key, clientPaths)) {
                    issues.push({
                        field: f.id,
                        label: f.label,
                        prefillKey: key,
                        reason: 'path not found in client JSON tree'
                    });
                }
            }
        }
    }

    return issues;
}

function isKnownPath(key, paths) {
    if (paths.has(key)) return true;
    // Accept paths with slightly different array notation
    const normalized = key.replace(/\[\]/g, '').toLowerCase();
    for (const p of paths) {
        if (p.replace(/\[\]/g, '').toLowerCase() === normalized) return true;
    }
    // Accept shorthand (just the leaf name)
    for (const p of paths) {
        const leaf = p.split('.').pop().replace(/\[\]/g, '');
        if (leaf && leaf.toLowerCase() === key.toLowerCase()) return true;
    }
    return false;
}

module.exports = { loadClientPaths, validateLovableJson };
