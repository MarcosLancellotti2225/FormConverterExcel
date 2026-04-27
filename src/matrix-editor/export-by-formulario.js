'use strict';

const XLSX = require('xlsx');

const FORMULARIOS = [
    { code: '1009052', name: 'Vida Colectiva', short: 'VC', keywords: ['vida colectiva'] },
    { code: 'D0306', name: 'Vida Universal Plus', short: 'VU', keywords: ['vida universal'] },
    { code: 'D0309', name: 'Protección Crediticia', short: 'PC', keywords: ['proteccion crediticia', 'crediticia'] },
];

const HEADERS = [
    'N° Formulario', 'Código Form', 'Pasos Formulario', 'Sección',
    'Nombre en PDF', 'Nombre del campo en formulario', 'Tipo de dato',
    'Valor', 'Obligatorio', 'Regla original', 'Observaciones',
    'Nombre del Campo en Json', 'MaxLength', 'Patrón regex', 'Formato',
    'Condicional', 'Aplica a TODOS', 'Visualización en Formularios',
];

const COL_WIDTHS = [22, 12, 18, 28, 32, 30, 16, 18, 11, 32, 38, 38, 11, 26, 18, 30, 11, 22];

function appliesTo(formVis, code) {
    const s = normalize(formVis);
    if (!s) return true;
    if (s.includes('todos')) return true;
    const form = FORMULARIOS.find(f => f.code === code);
    if (!form) return false;
    return form.keywords.some(kw => s.includes(kw));
}

function isAllForms(formVis) {
    const s = normalize(formVis);
    return !s || s.includes('todos');
}

function getPdfNameForForm(nombrePdf, code) {
    if (!nombrePdf) return '';
    const s = String(nombrePdf).trim();

    if (s.includes(' / ') && s.includes(':')) {
        const segments = s.split(' / ');
        const form = FORMULARIOS.find(f => f.code === code);
        if (!form) return s;
        for (const seg of segments) {
            if (!seg.includes(':')) continue;
            const colonIdx = seg.indexOf(':');
            const labelPart = seg.substring(0, colonIdx);
            const namePart = seg.substring(colonIdx + 1);
            const labelNorm = normalize(labelPart);
            if (form.keywords.some(kw => labelNorm.includes(kw))) {
                return namePart.trim();
            }
        }
        return null;
    }

    return s;
}

function parseRegla(regla, observaciones) {
    const texto = [regla, observaciones].filter(Boolean).join(' | ').toLowerCase();
    const result = { maxLength: '', patron: '', formato: '', condicional: '' };

    const lenMatch = texto.match(/(\d{1,4})\s*(caracteres?|dígitos?|digitos?|car\.|caract)/);
    if (lenMatch) result.maxLength = lenMatch[1];

    if (texto.includes('dd/mm/aaaa') || texto.includes('dd/mm')) {
        result.formato = 'fecha (dd/mm/aaaa)';
        result.patron = '^\\d{2}/\\d{2}/\\d{4}$';
    } else if (texto.includes('correo') && (texto.includes('formato') || texto.includes('electrónico') || texto.includes('electronico'))) {
        result.formato = 'email';
        result.patron = '^[\\w\\.-]+@[\\w\\.-]+\\.\\w+$';
    } else if (/numérico|numerico|dígitos|digitos/.test(texto)) {
        result.formato = 'numérico';
        if (result.maxLength) {
            result.patron = '^\\d{' + result.maxLength + '}$';
        } else {
            result.patron = '^\\d+$';
        }
    } else if (texto.includes('alfanum')) {
        result.formato = 'alfanumérico';
    }

    const condPatterns = [
        /si\s+(?:se\s+)?selecciona[n]?\s+(.+?)\s+se\s+(?:debe\s+(?:de\s+)?)?(?:habilitar|desplegar|mostrar|activar)/,
        /si\s+(.+?)\s*(?:=|es|igual\s+a)\s*(.+?),?\s+(?:entonces|se)/,
    ];
    for (const pat of condPatterns) {
        const m = texto.match(pat);
        if (m) {
            result.condicional = 'Si "' + m[1].trim() + '" → mostrar';
            break;
        }
    }

    return result;
}

function normalizeOblig(val) {
    if (!val) return '';
    const s = String(val).trim().toLowerCase();
    if (s === 'si' || s === 'sí') return 'Si';
    if (s === 'no') return 'No';
    return String(val).trim();
}

function normalize(s) {
    if (!s) return '';
    return String(s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function transformRow(row, code, form) {
    const nombrePdf = getPdfNameForForm(row['Nombre en PDF'], code);
    if (nombrePdf === null) return null;

    const regla = row['Regla'] || '';
    const obs = row['Observaciones'] || '';
    const parsed = parseRegla(regla, obs);
    const todos = isAllForms(row['Formulario a visualizar']);

    return [
        form.name,
        form.code,
        row['Pasos Formulario'] || '',
        row['Sección'] || '',
        nombrePdf,
        row['Nombre del campo en formulario'] || '',
        row['Tipo de dato'] || '',
        row['Valor'] || '',
        normalizeOblig(row['Obligatorio']),
        regla,
        obs,
        row['Nombre del Campo en Json'] || '',
        parsed.maxLength,
        parsed.patron,
        parsed.formato,
        parsed.condicional,
        todos ? 'Sí' : 'No',
        row['Visualización en Formularios'] || '',
    ];
}

function buildPerFormulariosWorkbook(rows) {
    const wb = XLSX.utils.book_new();

    const formStats = [];

    for (const form of FORMULARIOS) {
        const filtered = [];
        let countTodos = 0;
        let countSpecific = 0;

        for (const row of rows) {
            if (!appliesTo(row['Formulario a visualizar'], form.code)) continue;
            const transformed = transformRow(row, form.code, form);
            if (transformed === null) continue;
            filtered.push(transformed);
            if (isAllForms(row['Formulario a visualizar'])) {
                countTodos++;
            } else {
                countSpecific++;
            }
        }

        formStats.push({
            form,
            total: filtered.length,
            todos: countTodos,
            specific: countSpecific,
            data: filtered,
        });
    }

    const resumenData = [
        ['Formulario', 'Código', 'Total filas', 'Filas TODOS', 'Filas específicas'],
    ];
    for (const fs of formStats) {
        resumenData.push([fs.form.name, fs.form.code, fs.total, fs.todos, fs.specific]);
    }
    resumenData.push([]);
    resumenData.push(['Notas:']);
    resumenData.push(['• Las filas con "Aplica a TODOS = No" son específicas del formulario']);
    resumenData.push(['• La columna "Nombre en PDF" ya está limpia con el nombre que usa ESE formulario']);
    resumenData.push(['• MaxLength, Patrón regex, Formato y Condicional se derivaron de "Regla original"']);

    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
    wsResumen['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    for (const fs of formStats) {
        const sheetData = [HEADERS, ...fs.data];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }));
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };
        if (!ws['!views']) ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
        const sheetName = fs.form.code + ' ' + fs.form.short;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    return wb;
}

function exportPerFormulario(rows) {
    const wb = buildPerFormulariosWorkbook(rows);
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

module.exports = { exportPerFormulario, buildPerFormulariosWorkbook, appliesTo, getPdfNameForForm, parseRegla };
