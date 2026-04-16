/**
 * Catalogs Parser
 * Reads `Catalogos_Formularios_INS_Namirial_-_Vida.xlsx` where each sheet is a catalog.
 *
 * Known sheets: Tipo Formulario, Tipo Persona, TipoTramite, Tipo Identificación,
 *               Moneda, Estado Civil, Parentesco
 *
 * Output: Map<catalogName, Option[]>   where Option = { code, label }
 */
'use strict';

const XLSX = require('xlsx');

const CODE_MATCHERS  = ['codigo', 'código', 'code', 'cod', 'id', 'clave'];
const LABEL_MATCHERS = ['descripcion', 'descripción', 'nombre', 'label', 'name', 'valor'];

function parseCatalogsFromBuffer(buffer) {
    if (!buffer) {
        throw new Error('parseCatalogsFromBuffer: buffer is required');
    }
    const workbook = XLSX.read(buffer, { type: 'array' });
    const catalogs = {};

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rows.length === 0) continue;

        const sample = rows[0];
        const keys = Object.keys(sample);

        const codeKey = keys.find(k => CODE_MATCHERS.some(m => k.toLowerCase().includes(m))) || keys[0];
        const labelKey = keys.find(k =>
            k !== codeKey && LABEL_MATCHERS.some(m => k.toLowerCase().includes(m))
        ) || keys[1] || codeKey;

        const options = rows
            .map(r => ({
                code: String(r[codeKey] ?? '').trim(),
                label: String(r[labelKey] ?? '').trim()
            }))
            .filter(o => o.code || o.label);

        catalogs[sheetName] = options;
        // Also index by a normalized key so it's easy to lookup by alias
        catalogs[normalizeKey(sheetName)] = options;
    }

    return catalogs;
}

function normalizeKey(str) {
    return String(str)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

module.exports = { parseCatalogsFromBuffer, normalizeKey };
