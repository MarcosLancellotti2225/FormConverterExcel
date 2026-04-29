/**
 * @file help-texts.js
 * @version 1.1.0
 * @description Help text table per sourceName for Lovable field helpText.
 * @changelog
 *   - v1.1.0: Initial — 50+ entries covering all 1009052 fields
 */
'use strict';

const HELP_TEXTS = {
    solicitud_lugar: 'Indique la ciudad o localidad donde se realiza la solicitud.',
    solicitud_fecha_dia: 'Día de la fecha de solicitud.',
    solicitud_fecha_mes: 'Mes de la fecha de solicitud.',
    solicitud_fecha_ano: 'Año de la fecha de solicitud.',

    poliza_nombre_tomador: 'Nombre completo del tomador de la póliza (persona o empresa).',
    poliza_numero: 'Número de póliza asignado por el INS.',

    asegurado_primer_apellido: 'Primer apellido del asegurado según documento de identidad.',
    asegurado_segundo_apellido: 'Segundo apellido del asegurado según documento de identidad.',
    asegurado_nombre_completo: 'Nombre(s) de pila del asegurado.',
    asegurado_tipo_id_cedula: 'Seleccione si el tipo de identificación es Cédula.',
    asegurado_tipo_id_dimex: 'Seleccione si el tipo de identificación es DIMEX.',
    asegurado_tipo_id_didi: 'Seleccione si el tipo de identificación es DIDI.',
    asegurado_tipo_id_pasaporte: 'Seleccione si el tipo de identificación es Pasaporte.',
    asegurado_tipo_id_otro: 'Seleccione si el tipo de identificación es otro no listado.',
    asegurado_tipo_id_otro_texto: 'Especifique el tipo de identificación si eligió "Otro".',
    asegurado_numero_identificacion: 'Número del documento de identificación.',
    asegurado_profesion_ocupacion: 'Profesión u ocupación actual del asegurado.',
    asegurado_fecha_nac_dia: 'Día de nacimiento del asegurado.',
    asegurado_fecha_nac_mes: 'Mes de nacimiento del asegurado.',
    asegurado_fecha_nac_ano: 'Año de nacimiento del asegurado.',
    asegurado_sexo_masculino: 'Seleccione si el sexo es Masculino.',
    asegurado_sexo_femenino: 'Seleccione si el sexo es Femenino.',
    asegurado_pais: 'País de residencia del asegurado.',
    asegurado_provincia: 'Provincia de residencia dentro de Costa Rica.',
    asegurado_canton: 'Cantón de residencia dentro de la provincia.',
    asegurado_distrito: 'Distrito de residencia dentro del cantón.',
    asegurado_direccion_exacta: 'Dirección física completa para correspondencia.',
    asegurado_telefono_movil: 'Número de teléfono celular del asegurado.',
    asegurado_correo: 'Correo electrónico para comunicaciones del seguro.',

    monto_asegurado: 'Monto del capital asegurado en la moneda seleccionada.',

    vigencia_desde: 'Fecha de inicio de vigencia de la póliza.',
    vigencia_hasta: 'Fecha de fin de vigencia de la póliza.',

    medio_notificacion: 'Medio preferido para recibir notificaciones del INS.',

    tomador_nombre_cargo: 'Nombre completo y cargo del representante legal o tomador.',
};

function addBeneficiarioHelpTexts() {
    for (let n = 1; n <= 10; n++) {
        const p = 'beneficiario_' + n + '_';
        HELP_TEXTS[p + 'numero'] = 'Número consecutivo del beneficiario.';
        HELP_TEXTS[p + 'nombre'] = 'Nombre completo del beneficiario ' + n + '.';
        HELP_TEXTS[p + 'tipo_id'] = 'Tipo de identificación del beneficiario ' + n + '.';
        HELP_TEXTS[p + 'numero_id'] = 'Número de identificación del beneficiario ' + n + '.';
        HELP_TEXTS[p + 'parentesco'] = 'Parentesco del beneficiario ' + n + ' con el asegurado.';
        HELP_TEXTS[p + 'porcentaje'] = 'Porcentaje de participación del beneficiario ' + n + '. La suma de todos debe ser 100%.';
    }
}

addBeneficiarioHelpTexts();

function getHelpText(sourceName) {
    if (!sourceName) return null;
    return HELP_TEXTS[sourceName] || null;
}

module.exports = { getHelpText, HELP_TEXTS };
