'use strict';

function applyPrefill(field, excelRow) {
    if (excelRow._isNewFormat) {
        const key = (excelRow._prefillKeyDirect || '').trim();
        if (key) {
            field.prefillKey = key;
            const modo = (excelRow._prefillModeDirect || '').toLowerCase();
            if (modo.includes('obligatorio')) field.prefillMode = 'required';
            else if (modo.includes('opcional')) field.prefillMode = 'optional';
            else if (modo.includes('no pre')) field.prefillMode = 'none';
            else field.prefillMode = field.required ? 'required' : 'optional';
        }
        if (excelRow._pathsSecundarios) {
            const secondary = excelRow._pathsSecundarios.split('|').map(s => s.trim()).filter(Boolean);
            if (secondary.length > 0) field.mappedPaths = secondary;
        }
        return;
    }

    const raw = (excelRow.jsonName || '').trim();
    if (!raw) return;

    const parts = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);

    if (parts.length >= 1) {
        field.prefillKey = parts[0];
        field.prefillMode = field.required ? 'required' : 'optional';
    }

    if (parts.length >= 2) {
        field.mappedPaths = parts.slice(1);
    }
}

module.exports = { applyPrefill };
