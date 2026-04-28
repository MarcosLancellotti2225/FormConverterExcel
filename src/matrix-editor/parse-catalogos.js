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
            const codeRaw = row.Codigo != null ? row.Codigo
                          : (row.codigo != null ? row.codigo : '');
            const label = row.Nombre || row.nombre || row.Descripcion || row.descripcion || '';
            if (!label) continue;
            options.push({
                code: codeRaw === '' || codeRaw == null ? '' : String(codeRaw),
                label: String(label),
            });
        }
        if (options.length > 0) {
            // Preserve the original sheet name as a non-enumerable property so that
            // existing consumers that iterate `cat.map(...)` keep working unchanged.
            Object.defineProperty(options, 'sheetName', {
                value: sheetName,
                enumerable: false,
                writable: false,
            });
            result[sheetName.toLowerCase().trim()] = options;
        }
    }
    return result;
}

module.exports = { parseCatalogos };
