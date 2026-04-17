/**
 * Excel Matrix Parser
 * Reads the matrix xlsx and normalizes rows into Field[] ready for the pipeline.
 *
 * Expected columns (resilient to header variants):
 *  - Código Formulario              (NEW — groups rows into forms; matches PDF filename)
 *  - Pasos Formulario
 *  - Sección
 *  - Nombre en PDF                 (label on the PDF)
 *  - Nombre del campo en formulario (label in the digital form)
 *  - Tipo de dato
 *  - Valor
 *  - Regla
 *  - Obligatorio
 *  - Formulario a visualizar       (legacy product-scope filter)
 *  - Visualización en Formularios  (readonly / hidden)
 *  - Observaciones
 *  - Nombre del Campo en Json
 *  - Nombre del Campo en PDF       (AcroForm id)
 */
'use strict';

const XLSX = require('xlsx');

const COLUMN_MATCHERS = {
    formCode:      ['código formulario', 'codigo formulario', 'código pdf', 'codigo pdf',
                    'form code', 'pdf id', 'id formulario', 'formulario id'],
    step:          ['pasos formulario', 'paso', 'pasos'],
    section:       ['sección', 'seccion'],
    pdfLabel:      ['nombre en pdf'],
    fieldLabel:    ['nombre del campo en formulario', 'campo en formulario'],
    dataType:      ['tipo de dato', 'tipo dato'],
    value:         ['valor'],
    rule:          ['regla'],
    required:      ['obligatorio'],
    productScope:  ['formulario a visualizar'],
    visualization: ['visualización en formularios', 'visualizacion en formularios'],
    obs:           ['observaciones'],
    jsonName:      ['nombre del campo en json', 'campo en json'],
    pdfFieldName:  ['nombre del campo en pdf', 'campo en pdf']
};

/**
 * Parse a matrix xlsx buffer (ArrayBuffer / Uint8Array / Buffer)
 * → { sheetName, fields: Field[], formCodes: string[], hasFormCodeColumn: boolean }
 */
function parseMatrixFromBuffer(buffer) {
    if (!buffer) {
        throw new Error('parseMatrixFromBuffer: buffer is required');
    }
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = findMatrixSheet(workbook);
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rawRows.length < 2) {
        throw new Error(`Matrix sheet "${sheetName}" is empty`);
    }

    const { headerRow, columnMap } = findHeaderAndColumns(rawRows);

    if (columnMap.fieldLabel === undefined) {
        throw new Error('Could not find "Nombre del campo en formulario" column in the matrix');
    }

    const hasFormCodeColumn = columnMap.formCode !== undefined;

    const rawFields = [];
    for (let i = headerRow + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.every(c => c === '' || c == null)) continue;

        const field = {
            formCode:      cleanStr(getCell(row, columnMap.formCode)),
            step:          cleanStr(getCell(row, columnMap.step)),
            section:       cleanStr(getCell(row, columnMap.section)),
            pdfLabel:      cleanStr(getCell(row, columnMap.pdfLabel)),
            fieldLabel:    cleanStr(getCell(row, columnMap.fieldLabel)),
            dataType:      cleanStr(getCell(row, columnMap.dataType)),
            value:         cleanStr(getCell(row, columnMap.value)),
            rule:          cleanStr(getCell(row, columnMap.rule)),
            required:      cleanStr(getCell(row, columnMap.required)),
            productScope:  cleanStr(getCell(row, columnMap.productScope)),
            visualization: cleanStr(getCell(row, columnMap.visualization)),
            obs:           cleanStr(getCell(row, columnMap.obs)),
            jsonName:      cleanStr(getCell(row, columnMap.jsonName)),
            pdfFieldName:  cleanStr(getCell(row, columnMap.pdfFieldName)),
            _rowIndex: i + 1
        };

        if (!field.fieldLabel && !field.value && !field.pdfLabel) continue;

        rawFields.push(field);
    }

    const fields = groupComboRows(rawFields).map(normalizeField);

    const formCodes = [...new Set(fields.map(f => f.formCode).filter(Boolean))];

    return { sheetName, totalRawRows: rawFields.length, fields, formCodes, hasFormCodeColumn };
}

/**
 * Group fields by formCode. Fields with empty/todos/all formCode are included in every group.
 * Returns Map<formCode, Field[]>.
 */
function groupFieldsByFormCode(fields) {
    const groups = new Map();
    const shared = [];

    for (const f of fields) {
        const code = f.formCode.toLowerCase();
        if (!code || code === 'todos' || code === 'all') {
            shared.push(f);
        } else {
            if (!groups.has(f.formCode)) groups.set(f.formCode, []);
            groups.get(f.formCode).push(f);
        }
    }

    // Prepend shared fields to every group
    if (shared.length && groups.size) {
        for (const [code, arr] of groups) {
            groups.set(code, [...shared, ...arr]);
        }
    }

    // If no group was created (no formCode column or all rows are shared),
    // create a single group with all fields
    if (groups.size === 0) {
        groups.set('_all', fields);
    }

    return groups;
}

function findMatrixSheet(workbook) {
    const names = workbook.SheetNames;
    const preferred = names.find(n =>
        /formulario\s*digital/i.test(n) || /formulario/i.test(n)
    );
    if (preferred) return preferred;

    let biggest = names[0];
    let maxRows = 0;
    for (const n of names) {
        const range = XLSX.utils.decode_range(workbook.Sheets[n]['!ref'] || 'A1');
        const rows = range.e.r - range.s.r + 1;
        if (rows > maxRows) { maxRows = rows; biggest = n; }
    }
    return biggest;
}

function findHeaderAndColumns(rawRows) {
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
        const row = rawRows[i];
        if (!row) continue;
        const tempMap = {};
        let matchCount = 0;

        for (let j = 0; j < row.length; j++) {
            const cell = cleanStr(String(row[j] || '')).toLowerCase();
            if (!cell) continue;

            for (const [key, matchers] of Object.entries(COLUMN_MATCHERS)) {
                if (tempMap[key] !== undefined) continue;
                if (matchers.some(m => cell.includes(m))) {
                    tempMap[key] = j;
                    matchCount++;
                    break;
                }
            }
        }

        if (matchCount >= 4 && tempMap.fieldLabel !== undefined) {
            return { headerRow: i, columnMap: tempMap };
        }
    }

    return {
        headerRow: 0,
        columnMap: {
            step: 0, section: 1, pdfLabel: 2, fieldLabel: 3, dataType: 4,
            value: 5, rule: 6, required: 7, productScope: 8, visualization: 9,
            obs: 10, jsonName: 11, pdfFieldName: 12
        }
    };
}

function groupComboRows(rows) {
    const out = [];
    let i = 0;
    while (i < rows.length) {
        const cur = rows[i];
        const type = cur.dataType.toLowerCase();
        const isChoice = /combo|radio|select|lista/.test(type);

        if (isChoice && cur.fieldLabel) {
            const options = [];
            if (cur.value) options.push(optionFromRow(cur));

            let j = i + 1;
            while (j < rows.length) {
                const next = rows[j];
                const sameField = (next.fieldLabel === cur.fieldLabel) ||
                                  (!next.fieldLabel && next.value);
                const nextType = next.dataType.toLowerCase();
                const compatible = !next.dataType || /combo|radio|select|lista/.test(nextType);

                if (sameField && compatible && next.value) {
                    options.push(optionFromRow(next));
                    if (!cur.jsonName && next.jsonName) cur.jsonName = next.jsonName;
                    if (!cur.rule && next.rule)         cur.rule = next.rule;
                    if (!cur.obs && next.obs)           cur.obs = next.obs;
                    if (!cur.productScope && next.productScope) cur.productScope = next.productScope;
                    j++;
                } else {
                    break;
                }
            }

            cur.options = options;
            out.push(cur);
            i = j;
        } else {
            out.push(cur);
            i++;
        }
    }
    return out;
}

function optionFromRow(row) {
    const val = row.value;
    const m = val.match(/^([A-Z0-9]{1,6})\s*[-|,]\s*(.+)$/);
    if (m) {
        return { code: m[1].trim(), label: m[2].trim() };
    }
    return { code: val, label: val };
}

function normalizeField(raw) {
    const id = makeId(raw);
    return {
        id,
        formCode: raw.formCode || '',
        step: raw.step || '',
        section: raw.section || '',
        label: raw.fieldLabel || raw.pdfLabel || '',
        pdfLabel: raw.pdfLabel || '',
        pdfFieldName: raw.pdfFieldName || '',
        dataTypeRaw: raw.dataType || '',
        type: mapType(raw.dataType),
        value: raw.value || '',
        options: raw.options || [],
        rule: raw.rule || '',
        obs: raw.obs || '',
        productScope: normalizeProductScope(raw.productScope),
        visualization: raw.visualization || '',
        required: normalizeRequired(raw.required),
        jsonName: raw.jsonName || '',
        _rowIndex: raw._rowIndex,
        readOnly: /lectura|readonly|solo lectura/i.test(raw.visualization),
        hidden: /oculto|hidden|no visible/i.test(raw.visualization),
        prefillKey: '',
        mappedPaths: [],
        conditionalVisibility: null,
        validationPattern: null,
        maxLength: null,
        sourceMeta: null
    };
}

function mapType(raw) {
    const t = (raw || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/titulo|heading/.test(t)) return 'heading';
    if (/comentario informativo|informativo|info/.test(t)) return 'readonly';
    if (/radio/.test(t)) return 'radio';
    if (/combo|select|lista/.test(t)) return 'select';
    if (/fecha|date/.test(t)) return 'date';
    if (/numeric|numero|number/.test(t)) return 'number';
    if (/checkbox|check/.test(t)) return 'checkbox';
    if (/alfanum/.test(t)) return 'text';
    if (/texto|text|string/.test(t)) return 'text';
    return 'text';
}

function normalizeRequired(raw) {
    const r = String(raw || '').trim().toLowerCase();
    return r === 'si' || r === 'sí' || r === 'yes' || r === 'true' || r === 'obligatorio';
}

function normalizeProductScope(raw) {
    const r = String(raw || '').trim().toLowerCase();
    if (!r || r === 'todos' || r === 'all') return ['all'];
    const scopes = r.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    return scopes.length ? scopes : ['all'];
}

function makeId(raw) {
    const base = raw.fieldLabel || raw.pdfLabel || raw.pdfFieldName || raw.jsonName || `row_${raw._rowIndex}`;
    return String(base)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || `row_${raw._rowIndex}`;
}

function getCell(row, idx) {
    if (idx === undefined || idx === null) return '';
    return row[idx] !== undefined ? row[idx] : '';
}

function cleanStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

module.exports = {
    parseMatrixFromBuffer,
    groupFieldsByFormCode,
    _internal: { mapType, normalizeRequired, normalizeProductScope, groupComboRows, makeId }
};
