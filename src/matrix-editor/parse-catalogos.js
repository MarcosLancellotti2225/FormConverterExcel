'use strict';

const XLSX = require('xlsx');

function parseCatalogos(buffer) {
    const wb = XLSX.read(buffer, { type: 'array' });
    const result = {};
    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        const options = [];
        for (const row of data) {
            const code = row.Codigo != null ? row.Codigo : (row.codigo != null ? row.codigo : undefined);
            const label = row.Nombre || row.nombre || row.Descripcion || row.descripcion || '';
            if (code !== undefined) {
                options.push({ code: String(code), label: String(label) });
            }
        }
        if (options.length > 0) {
            result[sheetName.toLowerCase().trim()] = options;
        }
    }
    return result;
}

module.exports = { parseCatalogos };
