/**
 * @file precharged-lists.js
 * @version 1.1.0
 * @description Pre-charged select options for date fields (days, months, years).
 * @changelog
 *   - v1.1.0: Initial — DIAS (1-31), MESES (Ene-Dic), ANIOS (2024-2080)
 */
'use strict';

const DIAS = Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
    pdfValue: String(i + 1).padStart(2, '0'),
}));

const MESES = [
    { value: '1',  label: 'Enero',      pdfValue: 'Ene' },
    { value: '2',  label: 'Febrero',    pdfValue: 'Feb' },
    { value: '3',  label: 'Marzo',      pdfValue: 'Mar' },
    { value: '4',  label: 'Abril',      pdfValue: 'Abr' },
    { value: '5',  label: 'Mayo',       pdfValue: 'May' },
    { value: '6',  label: 'Junio',      pdfValue: 'Jun' },
    { value: '7',  label: 'Julio',      pdfValue: 'Jul' },
    { value: '8',  label: 'Agosto',     pdfValue: 'Ago' },
    { value: '9',  label: 'Septiembre', pdfValue: 'Set' },
    { value: '10', label: 'Octubre',    pdfValue: 'Oct' },
    { value: '11', label: 'Noviembre',  pdfValue: 'Nov' },
    { value: '12', label: 'Diciembre',  pdfValue: 'Dic' },
];

const YEAR_START = 2024;
const YEAR_END = 2080;
const ANIOS = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => ({
    value: String(YEAR_START + i),
    label: String(YEAR_START + i),
    pdfValue: String(YEAR_START + i),
}));

function getDateOptions(sourceName) {
    if (!sourceName) return null;
    const sn = sourceName.toLowerCase();
    if (sn.endsWith('_dia') || sn.endsWith('_dia_')) return DIAS;
    if (sn.endsWith('_mes') || sn.endsWith('_mes_')) return MESES;
    if (sn.endsWith('_ano') || sn.endsWith('_ano_')) return ANIOS;
    return null;
}

module.exports = { DIAS, MESES, ANIOS, getDateOptions };
