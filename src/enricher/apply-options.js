'use strict';

const { normalizeKey } = require('../parsers/catalogs-parser');

function applyOptions(field, excelRow, comboOptions, catalogs) {
    if (field.type !== 'select' && field.type !== 'radio') return;

    if (comboOptions && comboOptions.length > 0) {
        field.options = comboOptions.map(o => ({
            value: o.code || o.label,
            label: o.label || o.code,
        }));
        return;
    }

    if (excelRow._isNewFormat && excelRow._catalogoDirect) {
        const parsed = parseCatalogoDirect(excelRow._catalogoDirect, catalogs);
        if (parsed && parsed.length > 0) {
            field.options = parsed;
            return;
        }
    }

    const rule = (excelRow.rule || '').toLowerCase();
    if (/cat[aá]logo/.test(rule) || /ver\s+cat/.test(rule)) {
        const resolved = resolveCatalog(field, excelRow, catalogs);
        if (resolved) {
            field.options = resolved;
            return;
        }
    }

    const auto = autoResolveCatalog(field, excelRow, catalogs);
    if (auto) {
        field.options = auto;
    }
}

function parseCatalogoDirect(catalogoStr, catalogs) {
    if (!catalogoStr) return null;
    const colonIdx = catalogoStr.indexOf(':');
    if (colonIdx < 0) return null;
    const catName = catalogoStr.substring(0, colonIdx).trim();
    const optsRaw = catalogoStr.substring(colonIdx + 1).trim();

    if (optsRaw.startsWith('(') && catalogs) {
        const key = normalizeKey(catName);
        const catOpts = catalogs[key] || catalogs[catName];
        if (catOpts) return formatCatalogOptions(catOpts);
    }

    if (!optsRaw) return null;
    return optsRaw.split('|').map(s => s.trim()).filter(Boolean)
        .map(label => ({ value: label, label }));
}

function resolveCatalog(field, excelRow, catalogs) {
    if (!catalogs) return null;

    const candidates = [
        excelRow.fieldLabel,
        excelRow.pdfLabel,
        field.label,
    ];

    for (const c of candidates) {
        if (!c) continue;
        const key = normalizeKey(c);
        const opts = catalogs[key];
        if (opts) return formatCatalogOptions(opts);

        const cleaned = c.replace(/^tipo\s+de\s+/i, 'tipo ');
        const key2 = normalizeKey(cleaned);
        const opts2 = catalogs[key2];
        if (opts2) return formatCatalogOptions(opts2);
    }

    return null;
}

function autoResolveCatalog(field, excelRow, catalogs) {
    if (!catalogs) return null;

    const label = (excelRow.fieldLabel || field.label || '').toLowerCase();

    const KNOWN_MAPPINGS = [
        { pattern: /moneda/,                catalog: 'Moneda' },
        { pattern: /estado\s*civil/,        catalog: 'Estado Civil' },
        { pattern: /parentesco/,            catalog: 'Parentesco' },
        { pattern: /tipo\s*formulario/,     catalog: 'Tipo Formulario' },
        { pattern: /tipo\s*persona/,        catalog: 'Tipo Persona' },
        { pattern: /tipo\s*tr[aá]mite/,     catalog: 'TipoTramite' },
        { pattern: /tipo\s*identificaci[oó]n/, catalog: 'Tipo Identificación' },
    ];

    for (const m of KNOWN_MAPPINGS) {
        if (m.pattern.test(label)) {
            const opts = catalogs[m.catalog] || catalogs[normalizeKey(m.catalog)];
            if (opts) return formatCatalogOptions(opts);
        }
    }

    return null;
}

function formatCatalogOptions(opts) {
    return opts.map(o => ({
        value: o.code || o.label,
        label: o.label || o.code,
    }));
}

module.exports = { applyOptions };
