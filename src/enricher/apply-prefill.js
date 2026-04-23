'use strict';

function applyPrefill(field, excelRow) {
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
