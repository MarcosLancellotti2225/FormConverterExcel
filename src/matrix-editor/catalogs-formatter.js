'use strict';

/**
 * Catalogs Formatter
 *
 * Resolves which catálogo sheet a field belongs to and formats its options
 * as a Lovable-ready JSON array: [{"value":"<code>","label":"<desc>"}, ...].
 *
 * Lookup priority:
 *   1. SYNTHETIC_CATALOGS by group key (Sexo is not in the client Excel —
 *      hardcoded here so combos pick it up automatically).
 *   2. GROUP_TO_SHEET whitelist (group key → catalog sheet name).
 *   3. LABEL_TO_SHEET regex match against the public label.
 *
 * Returned shape:
 *   { sheetName, options, isSynthetic }   on success
 *   { sheetName: null, options: [], isSynthetic: false }   when no match.
 *
 * Catalogos input shape (from parse-catalogos.js):
 *   { '<normalized sheet name>': [{ code, label }, ...]<.sheetName='<original>'> }
 */

const SYNTHETIC_CATALOGS = {
    sexo: {
        sheetName: 'Sexo (sintético)',
        options: [
            { code: 'M', label: 'Masculino' },
            { code: 'F', label: 'Femenino' },
        ],
    },
};

const GROUP_TO_SHEET = {
    tipo_identificacion: 'tipo identificación',
    parentesco:          'parentesco',
    estado_civil:        'estado civil',
    moneda:              'moneda',
    tipo_persona:        'tipo persona',
    tipo_tramite:        'tipotramite',
    tipo_formulario:     'tipo formulario',
    nacionalidad:        'nacionalidad',
};

const LABEL_TO_SHEET = [
    { match: /tipo\s+(de\s+)?identificaci/i,    sheet: 'tipo identificación' },
    { match: /parentesco/i,                      sheet: 'parentesco' },
    { match: /estado\s+civil/i,                  sheet: 'estado civil' },
    { match: /nacionalidad/i,                    sheet: 'nacionalidad' },
    { match: /moneda/i,                          sheet: 'moneda' },
    { match: /tipo\s+(de\s+)?persona/i,          sheet: 'tipo persona' },
    { match: /tipo\s+(de\s+)?tr[aá]mite/i,       sheet: 'tipotramite' },
    { match: /tipo\s+(de\s+)?formulario/i,       sheet: 'tipo formulario' },
];

function findCatalog(group, label, catalogos) {
    const g = String(group || '').toLowerCase().trim();

    if (g && SYNTHETIC_CATALOGS[g]) {
        const syn = SYNTHETIC_CATALOGS[g];
        return { sheetName: syn.sheetName, options: syn.options, isSynthetic: true };
    }

    if (g && GROUP_TO_SHEET[g]) {
        const opts = lookupCatalog(catalogos, GROUP_TO_SHEET[g]);
        if (opts) {
            return { sheetName: opts.sheetName || GROUP_TO_SHEET[g], options: opts, isSynthetic: false };
        }
    }

    const labelStr = String(label || '');
    for (const { match, sheet } of LABEL_TO_SHEET) {
        if (match.test(labelStr)) {
            const opts = lookupCatalog(catalogos, sheet);
            if (opts) {
                return { sheetName: opts.sheetName || sheet, options: opts, isSynthetic: false };
            }
        }
    }

    return { sheetName: null, options: [], isSynthetic: false };
}

function lookupCatalog(catalogos, sheetName) {
    if (!catalogos) return null;
    const norm = String(sheetName).toLowerCase().trim();
    if (catalogos[norm]) return catalogos[norm];

    for (const [key, val] of Object.entries(catalogos)) {
        if (key.includes(norm) || norm.includes(key)) return val;
    }
    return null;
}

function formatCatalogOptionsJson(options) {
    if (!options || options.length === 0) return '';
    const arr = options.map(o => {
        const code = o.code != null && o.code !== '' ? String(o.code) : String(o.label || '');
        const label = String(o.label || '');
        return { value: code, label };
    });
    return JSON.stringify(arr);
}

module.exports = {
    findCatalog,
    formatCatalogOptionsJson,
    lookupCatalog,
    SYNTHETIC_CATALOGS,
    GROUP_TO_SHEET,
    LABEL_TO_SHEET,
};
