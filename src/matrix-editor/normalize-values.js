'use strict';

function normalizeObligatorio(val) {
    const t = String(val || '').trim().toLowerCase();
    if (t === 'si' || t === 'sí') return 'Si';
    if (t === 'no') return 'No';
    return val;
}

function mapFormulario(formVis) {
    const t = String(formVis || '').trim().toLowerCase();
    if (!t) return '';
    if (t === 'todos') return 'TODOS';
    if (t.includes('colectiva')) return 'VC';
    if (t.includes('universal')) return 'VU';
    if (t.includes('crediticia')) return 'PC';
    return formVis;
}

module.exports = { normalizeObligatorio, mapFormulario };
