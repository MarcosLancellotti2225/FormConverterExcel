'use strict';

function applyValidations(field, excelRow) {
    const rule = (excelRow.rule || '').trim();
    if (!rule) return;

    const skip = new Set(['select', 'radio', 'checkbox', 'heading', 'readonly']);
    if (skip.has(field.type)) return;

    const r = norm(rule);

    const lenMatch = r.match(/(\d+)\s*caract/)
                  || r.match(/max(?:imo)?\s*[:=]?\s*(\d+)/)
                  || r.match(/hasta\s+(\d+)/);
    if (lenMatch) {
        field.maxLength = parseInt(lenMatch[1], 10);
    }

    if (/formato\s+dd\/?mm\/?(aaaa|yyyy)/.test(r) || /dd\/mm\/aaaa/.test(r)) {
        field.validationPattern = '^\\d{2}/\\d{2}/\\d{4}$';
    } else if (/formato\s+dd-mm-(aaaa|yyyy)/.test(r)) {
        field.validationPattern = '^\\d{2}-\\d{2}-\\d{4}$';
    }

    if (!field.validationPattern) {
        const digitsMatch = r.match(/numerico\s+y\s+(\d+)\s*digitos/) ||
                            r.match(/(\d+)\s*digitos?\s*numerico/);
        if (digitsMatch) {
            field.validationPattern = '^\\d{' + digitsMatch[1] + '}$';
        } else if (/s[oó]lo\s*n[uú]meros/.test(r) || /solo\s*numeros/.test(r)) {
            field.validationPattern = '^\\d+$';
        }
    }

    if (!field.validationPattern && (/email|correo/.test(r))) {
        field.validationPattern = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
    }

    if (!field.validationPattern && /alfanum/.test(r)) {
        field.validationPattern = '^[A-Za-z0-9 ]+$';
    }

    if (!field.validationPattern) {
        const decMatch = r.match(/(\d+)\s*caract.*?(\d+)\s*decimal/);
        if (decMatch) {
            const intLen = parseInt(decMatch[1], 10);
            const decLen = parseInt(decMatch[2], 10);
            field.validationPattern = '^\\d{1,' + intLen + '}(\\.\\d{1,' + decLen + '})?$';
        }
    }
}

function norm(s) {
    return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ').trim();
}

module.exports = { applyValidations };
