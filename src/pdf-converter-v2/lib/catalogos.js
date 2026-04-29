/**
 * @file catalogos.js
 * @version 1.1.0
 * @description Hardcoded INS catalogs for form options.
 * @changelog
 *   - v1.1.0: Initial — 10 catalogs from INS specification
 */
'use strict';

const CAT_TIPO_FORMULARIO = [
    { value: 'GMC01', label: 'Gastos Médicos Abreviado' },
    { value: 'GMC02', label: 'Gastos Médicos Enrolamiento' },
    { value: 'GMC03', label: 'Gastos Médicos Completo' },
    { value: 'VCA01', label: 'Vida Colectiva - Asegurado' },
    { value: 'VUA01', label: 'Vida Universal Plus Colectivo - Asegurado' },
    { value: 'PCA01', label: 'Protección Crediticia Colectivo - Asegurado' },
    { value: 'GMT01', label: 'Gastos Médicos - Tomador' },
    { value: 'VCT01', label: 'Vida Colectiva - Tomador' },
    { value: 'VUT01', label: 'Vida Universal Plus Colectivo - Tomador' },
    { value: 'PCT01', label: 'Protección Crediticia Colectivo - Tomador' },
];

const CAT_TIPO_TRAMITE = [
    { value: 'EMI', label: 'Nuevo Seguro' },
    { value: 'VAR', label: 'Cambios en tu Seguro' },
    { value: 'CAN', label: 'Dar de Baja tu Seguro' },
];

const CAT_TIPO_PERSONA = [
    { value: 'ASG', label: 'Asegurado Directo' },
    { value: 'DME', label: 'Dependiente Menor de Edad' },
    { value: 'DMA', label: 'Dependiente Mayor de Edad' },
    { value: 'ASN', label: 'Asegurado Nominal' },
    { value: 'BNF', label: 'Beneficiario' },
    { value: 'TOM', label: 'Tomador de Seguro' },
];

const CAT_TIPO_IDENTIFICACION = [
    { value: '0', label: 'Cédula Física Nacional' },
    { value: '2', label: 'Cédula Jurídica Gobierno Central' },
    { value: '3', label: 'Cédula Persona Jurídica Nacional' },
    { value: '4', label: 'Cédula Institución Autónoma' },
    { value: '6', label: 'Documento Único (DIMEX)' },
    { value: '7', label: 'Cédula Jurídica de Empresas extranjeras' },
    { value: '9', label: 'Pasaporte' },
    { value: '12', label: 'Cédulas de Cuerpos diplomáticos' },
];

const CAT_MONEDA = [
    { value: 'CRC', label: 'Colones' },
    { value: 'USD', label: 'Dólares' },
];

const CAT_ESTADO_CIVIL = [
    { value: '1', label: 'Soltero (a)' },
    { value: '2', label: 'Casado (a)' },
    { value: '3', label: 'Separación judicial' },
    { value: '4', label: 'Divorciado (a)' },
    { value: '5', label: 'Viudo (a)' },
    { value: '6', label: 'Célibe' },
    { value: '7', label: 'Reconciliación judicial' },
    { value: '8', label: 'Anulado' },
    { value: '9', label: 'Unión libre' },
];

const CAT_GENERO = [
    { value: 'M', label: 'Masculino' },
    { value: 'F', label: 'Femenino' },
];

const CAT_PARENTESCO = [
    { value: 'Madre', label: 'Madre' },
    { value: 'Padre', label: 'Padre' },
    { value: 'Hijo (a)', label: 'Hijo (a)' },
    { value: 'Hermano (a)', label: 'Hermano (a)' },
    { value: 'Cónyuge', label: 'Cónyuge' },
    { value: 'Otro', label: 'Otro' },
];

const CAT_NOTIFICACION = [
    { value: 'Correo electrónico', label: 'Correo electrónico' },
    { value: 'Domicilio físico', label: 'Domicilio físico' },
    { value: 'Otros', label: 'Otros' },
];

const CAT_CALIDAD_DEUDOR = [
    { value: 'DEU', label: 'Deudor' },
    { value: 'COD', label: 'Codeudor' },
];

const ALL_CATALOGS = {
    tipo_formulario: CAT_TIPO_FORMULARIO,
    tipo_tramite: CAT_TIPO_TRAMITE,
    tipo_persona: CAT_TIPO_PERSONA,
    tipo_identificacion: CAT_TIPO_IDENTIFICACION,
    moneda: CAT_MONEDA,
    estado_civil: CAT_ESTADO_CIVIL,
    genero: CAT_GENERO,
    parentesco: CAT_PARENTESCO,
    notificacion: CAT_NOTIFICACION,
    calidad_deudor: CAT_CALIDAD_DEUDOR,
};

function resolveCatalog(catalogoNombre, grupo) {
    if (!catalogoNombre && !grupo) return null;

    const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const cn = norm(catalogoNombre);
    const gn = norm(grupo);

    if (cn.includes('tipo identificacion') || cn.includes('tipo de identificacion') || gn === 'tipo_identificacion') return CAT_TIPO_IDENTIFICACION;
    if (cn.includes('parentesco') || gn === 'parentesco') return CAT_PARENTESCO;
    if (cn.includes('sexo') || cn.includes('genero') || cn.includes('género') || gn === 'sexo') return CAT_GENERO;
    if (cn.includes('notificacion') || cn.includes('medio de notificacion') || gn === 'notificacion') return CAT_NOTIFICACION;
    if (cn.includes('moneda') || gn === 'moneda') return CAT_MONEDA;
    if (cn.includes('estado civil') || gn === 'estado_civil') return CAT_ESTADO_CIVIL;
    if (cn.includes('tipo persona') || cn.includes('tipo de persona') || gn === 'tipo_persona') return CAT_TIPO_PERSONA;
    if (cn.includes('tipo formulario') || cn.includes('tipo de formulario') || gn === 'tipo_formulario') return CAT_TIPO_FORMULARIO;
    if (cn.includes('tipo tramite') || cn.includes('tipo de tramite') || cn.includes('tipo de trámite') || gn === 'tipo_tramite') return CAT_TIPO_TRAMITE;
    if (cn.includes('calidad') || cn.includes('deudor') || gn === 'calidad' || gn === 'calidad_deudor') return CAT_CALIDAD_DEUDOR;

    return null;
}

module.exports = {
    CAT_TIPO_FORMULARIO,
    CAT_TIPO_TRAMITE,
    CAT_TIPO_PERSONA,
    CAT_TIPO_IDENTIFICACION,
    CAT_MONEDA,
    CAT_ESTADO_CIVIL,
    CAT_GENERO,
    CAT_PARENTESCO,
    CAT_NOTIFICACION,
    CAT_CALIDAD_DEUDOR,
    ALL_CATALOGS,
    resolveCatalog,
};
