'use strict';

const XLSX = require('xlsx');
const { COLUMNS } = require('./analyze-matrix');

const EXPORT_COLUMNS = [...COLUMNS, 'Formulario'];

function exportToXlsx(rows) {
    const data = [EXPORT_COLUMNS];
    for (const row of rows) {
        data.push(EXPORT_COLUMNS.map(col => row[col] || ''));
    }

    const ws = XLSX.utils.aoa_to_sheet(data);

    ws['!cols'] = EXPORT_COLUMNS.map(col => {
        if (col === 'Nombre en PDF' || col === 'Nombre del campo en formulario') return { wch: 40 };
        if (col === 'Regla' || col === 'Observaciones') return { wch: 35 };
        if (col === 'Nombre del Campo en Json') return { wch: 45 };
        if (col === 'Nombre del Campo en PDF') return { wch: 30 };
        return { wch: 18 };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Formulario Digital');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

module.exports = { exportToXlsx };
