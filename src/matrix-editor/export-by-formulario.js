'use strict';

const XLSX = require('xlsx');
const JSZip = require('jszip');

const FORMULARIOS = [
    { code: '1009052', name: 'Vida Colectiva', short: 'VC', keywords: ['vida colectiva'] },
    { code: 'D0306', name: 'Vida Universal Plus', short: 'VU', keywords: ['vida universal'] },
    { code: 'D0309', name: 'Protección Crediticia', short: 'PC', keywords: ['proteccion crediticia', 'crediticia'] },
];

const FILENAMES = {
    '1009052': 'Matriz_1009052_Vida_Colectiva.xlsx',
    'D0306': 'Matriz_D0306_Vida_Universal_Plus.xlsx',
    'D0309': 'Matriz_D0309_Proteccion_Crediticia.xlsx',
};

const HEADERS = [
    '#', 'Código formulario', 'Sección JSON', 'Etiqueta',
    'Nombre del Campo en PDF', 'Salida JSON (principal)', 'Paths secundarios',
    'Clave externa (prefill)', 'Tipo de campo', 'Origen', 'Obligatorio',
    'Solo lectura', 'Modo pre-llenado', 'MaxLength', 'Patrón regex',
    'Visibilidad condicional', 'Catálogo / Opciones', 'Texto de ayuda',
    'Regla original',
];

const COL_WIDTHS = [4, 11, 18, 28, 24, 38, 38, 38, 14, 14, 11, 11, 22, 11, 26, 30, 38, 32, 38];

const TIPO_MAP = {
    'texto': 'text',
    'alfanumerico': 'text',
    'alfanumérico': 'text',
    'numérico': 'number',
    'numerico': 'number',
    'numérico/porcentual': 'number',
    'numerico/porcentual': 'number',
    'fecha': 'date',
    'combo': 'select',
    'radio/combo': 'radio',
    'radio': 'radio',
    'checkbox': 'checkbox',
    'comentario informativo': 'readonly',
    'titulo': 'heading',
    'título': 'heading',
};

const GENERIC_LEAVES = ['descripcion', 'codigo', 'nombre', 'valor', 'fecha'];

const CATALOGO_NAMES = [
    'tipo identificacion', 'tipo identificación', 'parentesco',
    'estado civil', 'moneda', 'tipo formulario', 'tipo persona',
    'tipo tramite', 'tipo trámite', 'nacionalidad', 'provincia',
    'canton', 'distrito', 'ocupacion', 'ocupación',
];

function appliesTo(formVis, code) {
    const s = normalize(formVis);
    if (!s) return true;
    if (s.includes('todos')) return true;
    const form = FORMULARIOS.find(f => f.code === code);
    if (!form) return false;
    return form.keywords.some(kw => s.includes(kw));
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

function deriveAcroformName(jsonPath) {
    if (!jsonPath) return '';
    const firstPath = String(jsonPath).split(/[,\n]/)[0].trim().replace(/\[\]/g, '');
    if (!firstPath) return '';
    const segments = firstPath.split('.');
    let leaf = segments.pop();
    if (!leaf) return '';
    leaf = leaf.trim();
    if (segments.length > 0 && GENERIC_LEAVES.includes(leaf.toLowerCase())) {
        const parent = segments.pop();
        if (parent) leaf = parent + '_' + leaf;
    }
    return leaf.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/_+/g, '_');
}

function splitJsonPaths(jsonPath) {
    if (!jsonPath) return { principal: '', secundarios: '' };
    const all = String(jsonPath).split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
    if (all.length === 0) return { principal: '', secundarios: '' };
    return { principal: all[0], secundarios: all.slice(1).join(' | ') };
}

function extractSeccionJson(jsonPath) {
    if (!jsonPath) return '';
    const firstPath = String(jsonPath).split(/[,\n]/)[0].trim();
    const first = firstPath.split('.')[0];
    return first || '';
}

function mapTipoDato(tipo) {
    if (!tipo) return 'text';
    const key = String(tipo).trim().toLowerCase();
    return TIPO_MAP[key] || 'text';
}

function detectOrigen(row) {
    const nombrePdf = String(row['Nombre en PDF'] || '').toLowerCase().trim();
    const observ = String(row['Observaciones'] || '').toLowerCase();
    if (/concaten|automatic/.test(observ)) return 'Computado';
    if (nombrePdf === 'no se llena en pdf' || nombrePdf === 'no aplica' || nombrePdf === 'n/a') return 'Pre-rellenado';
    return 'PDF';
}

function detectModoPrellenado(row) {
    const jsonPath = String(row['Nombre del Campo en Json'] || '').trim();
    const obligatorio = String(row['Obligatorio'] || '').toLowerCase().trim();
    if (!jsonPath) return 'No pre-rellenable';
    if (obligatorio === 'si' || obligatorio === 'sí') return 'Pre-llenado obligatorio';
    return 'Opcional';
}

function detectSoloLectura(row) {
    const vis = String(row['Visualización en Formularios'] || '').toLowerCase();
    return vis.includes('disabled') || vis.includes('solo lectura') || vis.includes('readonly') ? 'Sí' : 'No';
}

function normalizeOblig(val) {
    if (!val) return '';
    const s = String(val).trim().toLowerCase();
    if (s === 'si' || s === 'sí') return 'Sí';
    if (s === 'no') return 'No';
    return String(val).trim();
}

function buildCatalogoColumn(row, allRows, catalogos) {
    const tipo = String(row['Tipo de dato'] || '').toLowerCase();
    if (!/(combo|radio)/.test(tipo)) return '';

    const label = row['Nombre del campo en formulario'] || '';
    const sameLabel = allRows.filter(r =>
        r['Nombre del campo en formulario'] === label &&
        r['Valor'] && r['Valor'].trim() && r['Valor'] !== (row['Valor'] || '')
    );
    if (sameLabel.length > 0) {
        const allVals = [row['Valor'], ...sameLabel.map(r => r['Valor'])].filter(Boolean);
        const unique = [...new Set(allVals)];
        return '(inline): ' + unique.join(' | ');
    }

    const text = normalize((row['Regla'] || '') + ' ' + (row['Observaciones'] || ''));
    for (const name of CATALOGO_NAMES) {
        const nameNorm = normalize(name);
        if (text.includes(nameNorm)) {
            if (catalogos) {
                const cat = catalogos[nameNorm] || catalogos[name.toLowerCase()];
                if (cat) {
                    const opts = cat.map(o => o.label).join(' | ');
                    return name + ': ' + opts;
                }
                for (const [key, val] of Object.entries(catalogos)) {
                    if (normalize(key).includes(nameNorm) || nameNorm.includes(normalize(key))) {
                        const opts = val.map(o => o.label).join(' | ');
                        return name + ': ' + opts;
                    }
                }
            }
            return name + ': (ver hoja Catálogos)';
        }
    }

    return '';
}

function parseRegla(regla, observaciones) {
    const texto = [regla, observaciones].filter(Boolean).join(' | ').toLowerCase();
    const result = { maxLength: '', patron: '', condicional: '' };

    const lenMatch = texto.match(/(\d{1,4})\s*(caracteres?|dígitos?|digitos?|car\.|caract)/);
    if (lenMatch) result.maxLength = lenMatch[1];

    if (texto.includes('dd/mm/aaaa') || texto.includes('dd/mm')) {
        result.patron = '^\\d{2}/\\d{2}/\\d{4}$';
    } else if (texto.includes('correo') && (texto.includes('formato') || texto.includes('electrónico') || texto.includes('electronico'))) {
        result.patron = '^[\\w\\.-]+@[\\w\\.-]+\\.\\w+$';
    } else if (/numérico|numerico|dígitos|digitos/.test(texto)) {
        if (result.maxLength) {
            result.patron = '^\\d{' + result.maxLength + '}$';
        } else {
            result.patron = '^\\d+$';
        }
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

function normalize(s) {
    if (!s) return '';
    return String(s).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function transformRow(row, idx, code, allRows, catalogos) {
    const nombrePdfFiltered = getPdfNameForForm(row['Nombre en PDF'], code);
    if (nombrePdfFiltered === null) return null;

    const jsonPath = row['Nombre del Campo en Json'] || '';
    const { principal, secundarios } = splitJsonPaths(jsonPath);
    const regla = row['Regla'] || '';
    const obs = row['Observaciones'] || '';
    const parsed = parseRegla(regla, obs);

    return [
        idx,
        code,
        extractSeccionJson(jsonPath),
        row['Nombre del campo en formulario'] || '',
        deriveAcroformName(jsonPath),
        principal,
        secundarios,
        principal,
        mapTipoDato(row['Tipo de dato']),
        detectOrigen(row),
        normalizeOblig(row['Obligatorio']),
        detectSoloLectura(row),
        detectModoPrellenado(row),
        parsed.maxLength,
        parsed.patron,
        parsed.condicional,
        buildCatalogoColumn(row, allRows, catalogos),
        obs,
        regla,
    ];
}

function buildSingleFormularioWorkbook(allRows, code, catalogos) {
    const wb = XLSX.utils.book_new();
    const filtered = [];
    let idx = 0;

    for (const row of allRows) {
        if (!appliesTo(row['Formulario a visualizar'], code)) continue;
        idx++;
        const transformed = transformRow(row, idx, code, allRows, catalogos);
        if (transformed === null) continue;
        filtered.push(transformed);
    }

    const sheetData = [HEADERS, ...filtered];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    if (!ws['!views']) ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Campos del formulario');

    if (catalogos && Object.keys(catalogos).length > 0) {
        const catData = [['Catálogo', 'Código', 'Label']];
        for (const [catName, options] of Object.entries(catalogos)) {
            for (const opt of options) {
                catData.push([catName, opt.code, opt.label]);
            }
        }
        const wsCat = XLSX.utils.aoa_to_sheet(catData);
        wsCat['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 40 }];
        XLSX.utils.book_append_sheet(wb, wsCat, 'Catálogos de opciones');
    }

    return { wb, rowCount: filtered.length };
}

function identifyPdfCode(pdfFileName) {
    const name = String(pdfFileName || '').toLowerCase();
    for (const form of FORMULARIOS) {
        if (name.includes(form.code.toLowerCase())) return form.code;
    }
    return null;
}

async function exportPerFormularioZip(rows, pdfFileNames, catalogos) {
    let codesToExport;
    if (pdfFileNames && pdfFileNames.length > 0) {
        codesToExport = [];
        for (const name of pdfFileNames) {
            const code = identifyPdfCode(name);
            if (code && !codesToExport.includes(code)) codesToExport.push(code);
        }
        if (codesToExport.length === 0) {
            codesToExport = FORMULARIOS.map(f => f.code);
        }
    } else {
        codesToExport = FORMULARIOS.map(f => f.code);
    }

    const zip = new JSZip();
    const summary = [];

    for (const code of codesToExport) {
        const { wb, rowCount } = buildSingleFormularioWorkbook(rows, code, catalogos);
        const filename = FILENAMES[code] || ('Matriz_' + code + '.xlsx');
        const wbBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        zip.file(filename, wbBytes);
        const form = FORMULARIOS.find(f => f.code === code);
        summary.push({ code, name: form ? form.name : code, rowCount, filename });
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return { zipBlob, summary };
}

module.exports = { exportPerFormularioZip, buildSingleFormularioWorkbook, appliesTo, getPdfNameForForm, identifyPdfCode };
