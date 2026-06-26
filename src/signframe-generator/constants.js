'use strict';

const SECTION_ORDER = [
    {
        key: 'datos_generales', title: 'Datos Generales', order: 1,
        subsections: [
            { key: 'sistema', title: 'Datos del Sistema (oculto)', hidden: true },
            { key: 'solicitud', title: 'Información de la Solicitud' },
            { key: 'asesor', title: 'Datos del Asesor' },
            { key: 'notificacion', title: 'Preferencias de Notificación' },
        ],
    },
    {
        key: 'datos_tomador', title: 'Datos del Tomador', order: 2,
        subsections: [
            { key: 'tomador', title: 'Datos del Tomador' },
            { key: 'contacto', title: 'Contacto y Ubicación' },
        ],
    },
    {
        key: 'datos_grupo', title: 'Datos del Grupo a Asegurar', order: 3,
        subsections: [
            { key: 'grupo', title: 'Tipo del Grupo · Suma a Asegurar · Cantidad de Miembros' },
        ],
    },
    {
        key: 'coberturas', title: 'Coberturas del Seguro', order: 4,
        subsections: [
            { key: 'basicas', title: 'Coberturas Básicas' },
            { key: 'adicionales', title: 'Coberturas Adicionales' },
        ],
    },
    {
        key: 'condiciones', title: 'Condiciones Generales Modificables', order: 5,
        subsections: [
            { key: 'condiciones', title: 'Condiciones Generales Modificables' },
        ],
    },
    {
        key: 'declaraciones', title: 'Declaraciones Legales', order: 6,
        subsections: [
            { key: 'declaraciones', title: 'Declaraciones' },
            { key: 'aceptacion', title: 'Aceptación y consentimiento' },
        ],
    },
];

const SECTION_KEYWORDS = {
    sistema: ['sistema', 'oculto', 'hidden', 'internal'],
    solicitud: ['solicitud', 'información de la solicitud', 'info solicitud'],
    asesor: ['asesor', 'agente', 'intermediario', 'corredor'],
    notificacion: ['notificación', 'notificacion', 'preferencia'],
    tomador: ['tomador', 'contratante', 'titular'],
    contacto: ['contacto', 'ubicación', 'ubicacion', 'dirección', 'direccion', 'domicilio'],
    grupo: ['grupo', 'asegurar', 'suma', 'miembro', 'cantidad'],
    basicas: ['básica', 'basica', 'cobertura básica', 'coberturas basicas'],
    adicionales: ['adicional', 'cobertura adicional'],
    condiciones: ['condición', 'condicion', 'modificable'],
    declaraciones: ['declaración', 'declaracion', 'legal'],
    aceptacion: ['aceptación', 'aceptacion', 'consentimiento', 'firma'],
};

const TYPE_MAP = {
    texto: 'text',
    alfanumerico: 'text',
    'alfanumérico': 'text',
    numerico: 'number',
    'numérico': 'number',
    fecha: 'date',
    combo: 'select',
    lista: 'select',
    select: 'select',
    dropdown: 'select',
    radio: 'radio',
    'radio/combo': 'radio',
    checkbox: 'checkbox',
    check: 'checkbox',
    'comentario informativo': 'readonly',
    informativo: 'readonly',
    titulo: 'heading',
    textarea: 'textarea',
};

const NATIVE_TYPE_MAP = {
    Tx: 'text',
    Btn: 'checkbox',
    Ch: 'select',
    Sig: 'signature',
};

const CATALOG_CODES = {
    tipoIdTomador: [
        { label: 'Jurídica Nacional', jsonValue: '3', pdfValue: 'Jurídica Nacional' },
        { label: 'Gobierno', jsonValue: '2', pdfValue: 'Gobierno' },
        { label: 'Inst. autónoma', jsonValue: '4', pdfValue: 'Inst. autónoma' },
        { label: 'Jurídica extranjera', jsonValue: '7', pdfValue: 'Jurídica extranjera' },
    ],
    moneda: [
        { label: 'Colones', jsonValue: 'CRC', pdfValue: 'Colones' },
        { label: 'Dólares', jsonValue: 'USD', pdfValue: 'Dólares' },
    ],
    formaPago: [
        { label: 'Mensual', jsonValue: 'MEN', pdfValue: 'Mensual' },
        { label: 'Trimestral', jsonValue: 'TRI', pdfValue: 'Trimestral' },
        { label: 'Semestral', jsonValue: 'SEM', pdfValue: 'Semestral' },
        { label: 'Anual', jsonValue: 'ANU', pdfValue: 'Anual' },
    ],
    notificacion: [
        { label: 'Correo Electrónico', jsonValue: 'Correo Electrónico', pdfValue: 'Correo Electrónico' },
        { label: 'Domicilio Fisico', jsonValue: 'Domicilio Fisico', pdfValue: 'Domicilio Fisico' },
        { label: 'Otro', jsonValue: 'Otro', pdfValue: 'Otro' },
    ],
};

const NUMBER_FORMATS = {
    monto: '#.##0,00',
    entero: '#.##0',
    porcentaje: '00.00',
};

const PATH_CORRECTIONS = {
    'datosGenerales.personas': 'datosFormulario.personas',
    Consentimiento: 'consentimiento',
    dispotabilidadCarencia: 'disputabilidadCarencia',
};

const NEVER_CONDITION = JSON.stringify({
    logic: 'and',
    conditions: [{ fieldId: 'field_NEVER_EXISTS', operator: 'not_empty' }],
});

module.exports = {
    SECTION_ORDER,
    SECTION_KEYWORDS,
    TYPE_MAP,
    NATIVE_TYPE_MAP,
    CATALOG_CODES,
    NUMBER_FORMATS,
    PATH_CORRECTIONS,
    NEVER_CONDITION,
};
