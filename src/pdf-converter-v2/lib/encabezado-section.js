/**
 * @file encabezado-section.js
 * @version 1.1.0
 * @description Hardcoded hidden "Encabezado" section with 10 INS header fields.
 * @changelog
 *   - v1.1.0: Initial — 10 header fields, all readOnly + mandatory
 */
'use strict';

const { CAT_TIPO_FORMULARIO, CAT_TIPO_TRAMITE } = require('./catalogos');

const NEVER_VISIBLE = '{"logic":"and","conditions":[{"fieldId":"field_NEVER_EXISTS","operator":"not_empty"}]}';

const ENCABEZADO_FIELDS = [
    {
        sourceName: 'encabezado_codigoTipoFormulario',
        label: 'Tipo de Formulario',
        type: 'select',
        prefillKey: 'encabezado.codigoTipoFormulario',
        options: CAT_TIPO_FORMULARIO,
    },
    {
        sourceName: 'encabezado_descripcionTipoFormulario',
        label: 'Descripción Tipo Formulario',
        type: 'text',
        prefillKey: 'encabezado.descripcionTipoFormulario',
        options: null,
    },
    {
        sourceName: 'encabezado_codigoTipoTramite',
        label: 'Tipo de Trámite',
        type: 'select',
        prefillKey: 'encabezado.codigoTipoTramite',
        options: CAT_TIPO_TRAMITE,
    },
    {
        sourceName: 'encabezado_descripcionTipoTramite',
        label: 'Descripción Tipo Trámite',
        type: 'text',
        prefillKey: 'encabezado.descripcionTipoTramite',
        options: null,
    },
    {
        sourceName: 'encabezado_identificadorTransaccionInterno',
        label: 'Identificador de Transacción',
        type: 'text',
        prefillKey: 'encabezado.identificadorTransaccionInterno',
        options: null,
    },
    {
        sourceName: 'encabezado_correoElectronico',
        label: 'Correo Electrónico',
        type: 'text',
        prefillKey: 'encabezado.correoElectronico',
        options: null,
    },
    {
        sourceName: 'encabezado_codigoProducto',
        label: 'Código de Producto',
        type: 'text',
        prefillKey: 'encabezado.codigoProducto',
        options: null,
    },
    {
        sourceName: 'encabezado_descripcionProducto',
        label: 'Descripción del Producto',
        type: 'text',
        prefillKey: 'encabezado.descripcionProducto',
        options: null,
    },
    {
        sourceName: 'encabezado_nombreCompletoCliente',
        label: 'Nombre Completo del Cliente',
        type: 'text',
        prefillKey: 'encabezado.nombreCompletoCliente',
        options: null,
    },
    {
        sourceName: 'encabezado_identificadorArchivo',
        label: 'Identificador de Archivo',
        type: 'text',
        prefillKey: 'encabezado.identificadorArchivo',
        options: null,
    },
];

function buildEncabezadoSection() {
    const fields = ENCABEZADO_FIELDS.map((def, idx) => ({
        id: 'field_' + def.sourceName,
        type: def.type,
        label: def.label,
        required: true,
        readOnly: true,
        defaultValue: null,
        order: idx + 1,
        options: def.options || [],
        sourceMeta: {
            sourceName: def.sourceName,
            page: null,
            nativeType: null,
            rect: { X: 0, Y: 0, Width: 0, Height: 0 },
        },
        prefillKey: def.prefillKey,
        prefillMode: 'mandatory',
        salidaJSON: def.prefillKey,
        jsonOutputPath: def.prefillKey,
        conditionalVisibility: null,
        helpText: null,
        placeholder: null,
    }));

    return {
        id: 'section_encabezado',
        title: 'Encabezado (oculto)',
        description: null,
        instructions: 'Esta sección NO se muestra al usuario. Contiene los datos del encabezado que vienen del INS y deben devolverse tal cual.',
        conditionalVisibility: NEVER_VISIBLE,
        order: 1,
        fields,
    };
}

module.exports = { buildEncabezadoSection, ENCABEZADO_FIELDS, NEVER_VISIBLE };
