'use strict';

const XLSX = require('xlsx');
const { COLUMNS } = require('./analyze-matrix');

const PDF_COLUMNS = ['PDF AcroForm Name', 'PDF Tipo Nativo', 'PDF Página', 'PDF Rect'];
const EXPORT_COLUMNS = [...COLUMNS, 'Formulario', ...PDF_COLUMNS];

function exportToXlsx(rows) {
    const hasPdfData = rows.some(r => r['PDF AcroForm Name']);
    const cols = hasPdfData ? EXPORT_COLUMNS : EXPORT_COLUMNS.filter(c => !PDF_COLUMNS.includes(c));

    const data = [cols];
    for (const row of rows) {
        data.push(cols.map(col => row[col] || ''));
    }

    const ws = XLSX.utils.aoa_to_sheet(data);

    ws['!cols'] = cols.map(col => {
        if (col === 'Nombre en PDF' || col === 'Nombre del campo en formulario') return { wch: 40 };
        if (col === 'Regla' || col === 'Observaciones') return { wch: 35 };
        if (col === 'Nombre del Campo en Json') return { wch: 45 };
        if (col === 'Nombre del Campo en PDF' || col === 'PDF AcroForm Name') return { wch: 30 };
        if (col === 'PDF Rect') return { wch: 22 };
        return { wch: 18 };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Formulario Digital');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

module.exports = { exportToXlsx };
