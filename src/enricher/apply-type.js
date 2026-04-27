'use strict';

const TYPE_MAP = {
    'texto':                  'text',
    'text':                   'text',
    'alfanumerico':           'text',
    'alfanumérico':           'text',
    'numerico':               'number',
    'numérico':               'number',
    'number':                 'number',
    'fecha':                  'date',
    'date':                   'date',
    'combo':                  'select',
    'select':                 'select',
    'lista':                  'select',
    'radio/combo':            'radio',
    'radio':                  'radio',
    'checkbox':               'checkbox',
    'check':                  'checkbox',
    'comentario informativo': 'readonly',
    'informativo':            'readonly',
    'titulo':                 'heading',
    'heading':                'heading',
};

function applyType(field, excelRow) {
    const raw = (excelRow.dataType || '').trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const mapped = TYPE_MAP[raw];
    if (mapped) {
        field.type = mapped;
    }
    if (mapped === 'readonly') {
        field.readOnly = true;
    }
    if (excelRow._isNewFormat && excelRow._soloLectura) {
        const ro = excelRow._soloLectura.toLowerCase().trim();
        if (ro === 'si' || ro === 'sí') field.readOnly = true;
    }
}

function applyReadOnly(field, excelRow) {
    const vis = (excelRow.visualization || '').toLowerCase();
    if (/disabled/.test(vis)) {
        field.readOnly = true;
        if (/no\s*visible/.test(vis)) {
            field.hidden = true;
        }
    }
    if (/no\s*aplica/.test(vis)) {
        field.hidden = true;
    }
    if (/editable/.test(vis) && !/disabled/.test(vis)) {
        field.readOnly = false;
    }
}

function applyRequired(field, excelRow) {
    const r = (excelRow.required || '').trim().toLowerCase();
    field.required = r === 'si' || r === 'sí' || r === 'yes' || r === 'true' || r === 'obligatorio';
}

module.exports = { applyType, applyReadOnly, applyRequired };
