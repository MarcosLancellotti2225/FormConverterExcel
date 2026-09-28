'use strict';

/**
 * Ficha sintética para los tests del lector.
 *
 * Se arma por código y no como .xlsx commiteado a propósito: así los casos
 * borde que cubre se leen acá, en el diff, y nadie tiene que abrir Excel para
 * saber qué está probado. Además no hay riesgo de subir una ficha de cliente.
 *
 * Casos que cubre, a propósito:
 *   - header de la fila 1 escrito distinto en cada hoja (mayúsculas, variantes)
 *   - 2 filas Sí/No con la MISMA ruta → 1 campo con 2 opciones
 *   - combo de 3 filas con la misma ruta → 1 campo con 3 opciones
 *   - misma ruta con sourceNames DISTINTOS → 1 campo, lista de sourceNames
 *   - fila sin ruta → label
 *   - Obligatorio = JSON → soloJSON
 *   - Paso = JSON → soloJSON (por la otra columna)
 *   - Visualización "No Aplica" / "Disabled" / "Dato Prellenado"
 *   - Regla "No aplica Formulario D0873" → excluido
 *   - hoja "NO APLICA PARA ESTE FORMULARIO" → 0 filas
 *   - hoja "No posee campos propios" → 0 filas
 *   - espacios de más ("Both ") que hay que normalizar
 *   - dos rutas separadas por coma (código + descripción)
 */

const XLSX = require('xlsx');

// Los headers se escriben distinto en cada hoja A PROPÓSITO: el lector tiene
// que mapear por posición y no por texto.
const HEADER_A = ['Pasos Formulario', 'Sección', 'Nombre en PDF', 'Nombre del campo en formulario',
    'Tipo de dato', 'Valor', 'Regla', 'Obligatorio', 'Formulario a visualizar',
    'Visualización en Formularios', 'Observaciones', 'Nombre de la sección del JSON',
    'Nombre del campo en el JSON', 'Nombre interno del campo en PDF'];

const HEADER_B = ['PASOS FORMULARIO', 'SECCIÓN', 'Nombre en pdf', 'Nombre del Campo en Formulario',
    'TIPO DE DATO', 'VALOR', 'REGLA', 'OBLIGATORIO', 'Formulario a Visualizar',
    'Visualizacion en formularios', 'OBSERVACIONES', 'Nombre de la Seccion del Json',
    'Nombre del Campo en Json', 'Nombre Interno del Campo en PDF'];

/** fila(paso, seccion, nombrePdf, label, tipo, valor, regla, oblig, form, visual, obs, secJson, ruta, sourceName) */
const f = (...c) => { const r = new Array(14).fill(''); c.forEach((v, i) => { r[i] = v; }); return r; };

const INDICE = [
    ['Estructura del JSON', 'Pasos del formulario WEB', 'Secciones del Formulario WEB'],
    ['encabezado', 'No aplica', 'No aplica'],
    ['datosFormulario.datosGenerales', 'Datos Generales', 'Información de la solicitud'],
    ['datosFormulario.personas[]', 'Datos del Tomador', 'Datos Tomador'],
    ['', 'Datos del Asegurado', 'Datos Asegurado'],  // instancia extra del mismo nodo
];

const DATOS_GENERALES = [
    HEADER_A,
    // campo normal
    f('Datos Generales', 'Información de la solicitud', 'N° de solicitud', 'Número de solicitud',
        'Texto', '', '', 'Both ', 'TODOS', 'editable / visible', '', 'datosGenerales',
        'datosFormulario.datosGenerales.numeroSolicitud', 'numeroSolicitud'),
    // soloJSON por la columna Obligatorio
    f('Datos Generales', 'Información de la solicitud', '', 'Código de oficina',
        'Texto', '', '', 'JSON', 'TODOS', '', '', 'datosGenerales',
        'datosFormulario.datosGenerales.codigoOficina', ''),
    // soloJSON por la columna Paso
    f('JSON', 'JSON', '', 'Canal de venta',
        'Texto', '', '', '', 'TODOS', '', '', 'datosGenerales',
        'datosFormulario.datosGenerales.canalVenta', ''),
    // oculto
    f('Datos Generales', 'Información de la solicitud', '', 'Identificador interno',
        'Texto', '', '', 'Both', 'TODOS', 'No Aplica', '', 'datosGenerales',
        'datosFormulario.datosGenerales.idInterno', 'idInterno'),
    // readOnly
    f('Datos Generales', 'Información de la solicitud', 'Fecha', 'Fecha de solicitud',
        'Fecha', '', '', 'Both', 'TODOS', 'Disabled / Visible', '', 'datosGenerales',
        'datosFormulario.datosGenerales.fechaSolicitud', 'fechaSolicitud'),
    // prefill
    f('Datos Generales', 'Información de la solicitud', '', 'Número de póliza',
        'Texto', '', '', 'Both', 'TODOS', 'editable / Dato Prellenado / visible', '', 'datosGenerales',
        'datosFormulario.datosGenerales.numeroPoliza', 'numeroPoliza'),
    // excluido por regla
    f('Datos Generales', 'Información adicional', '', 'Ramo comercial',
        'Texto', '', 'No aplica Formulario D0873', 'Both', 'D0772', 'editable / visible', '', 'datosGenerales',
        'datosFormulario.datosGenerales.ramoComercial', 'ramoComercial'),
    // label: fila sin ruta
    f('Datos Generales', 'Información adicional', '', 'PREGUNTA ADICIONAL PARA LAS MUJERES',
        'Comentario Informativo', '', '', '', 'TODOS', 'editable / visible', '', '', '', ''),
    // combo con dos rutas separadas por coma (código + descripción)
    f('Datos Generales', 'Información de la solicitud', '', 'Moneda',
        'Combo', 'Ver Catálogo', '', 'Both', 'TODOS', 'editable / visible', '', 'datosGenerales',
        'datosFormulario.datosGenerales.codigoMoneda, datosFormulario.datosGenerales.descripcionMoneda', 'codigoMoneda'),
];

const PERSONAS = [
    HEADER_B,
    // Sí/No: 2 filas, misma ruta, sourceNames DISTINTOS (radio de dos widgets)
    f('Datos del Asegurado', 'Datos Asegurado', '¿Fuma?', '¿Fuma?',
        'Radio/Combo', 'Sí', 'Sí → Despliega todas las preguntas de fumado', 'Both', 'TODOS',
        'editable / visible', '', 'personas', 'datosFormulario.personas[].indicadorFuma', 'fumaSi'),
    f('Datos del Asegurado', 'Datos Asegurado', '¿Fuma?', '¿Fuma?',
        'Radio/Combo', 'No', 'No → Oculta las preguntas de fumado', 'Both', 'TODOS',
        'editable / visible', '', 'personas', 'datosFormulario.personas[].indicadorFuma', 'fumaNo'),
    // combo de 3 opciones, misma ruta, MISMO sourceName
    f('Datos del Asegurado', 'Datos Asegurado', 'Estado civil', 'Estado civil',
        'Combo', 'Soltero (a)', '', 'Both', 'TODOS', 'editable / visible', '', 'personas',
        'datosFormulario.personas[].codigoEstadoCivil', 'estadoCivil'),
    f('Datos del Asegurado', 'Datos Asegurado', 'Estado civil', 'Estado civil',
        'Combo', 'Casado (a)', '', 'Both', 'TODOS', 'editable / visible', '', 'personas',
        'datosFormulario.personas[].codigoEstadoCivil', 'estadoCivil'),
    f('Datos del Asegurado', 'Datos Asegurado', 'Estado civil', 'Estado civil',
        'Combo', 'Unión libre', '', 'Both', 'TODOS', 'editable / visible', '', 'personas',
        'datosFormulario.personas[].codigoEstadoCivil', 'estadoCivil'),
    // campo simple con typo respecto del JSON de ejemplo (drograMedicamento)
    f('Datos del Asegurado', 'Datos Asegurado', '', '¿Toma medicamentos?',
        'Texto', '', '', 'Both', 'TODOS', 'editable / visible', '', 'personas',
        'datosFormulario.personas[].drograMedicamento', 'drogaMedicamento'),
];

const NO_APLICA = [
    HEADER_A,
    f('NO APLICA PARA ESTE FORMULARIO'),
];

const SIN_PROPIOS = [
    HEADER_A,
    f('', '', '', 'No posee campos propios'),
];

// El JSON de ejemplo, escrito una línea por celda como en las fichas reales.
const EJEMPLO_OBJ = {
    encabezado: { codigoProducto: '5919' },
    datosFormulario: {
        datosGenerales: {
            numeroSolicitud: '', codigoOficina: '', canalVenta: '', idInterno: '',
            fechaSolicitud: '', numeroPoliza: '', ramoComercial: '',
            codigoMoneda: '', descripcionMoneda: '',
        },
        personas: [{
            indicadorFuma: false, codigoEstadoCivil: '',
            drogaMedicamento: '',   // la ficha lo escribe "drograMedicamento"
        }],
    },
};

function hojaEjemplo() {
    // Una línea del JSON por fila, en la primera columna.
    return JSON.stringify(EJEMPLO_OBJ, null, 2).split('\n').map(function (linea) { return [linea]; });
}

/** Devuelve el xlsx como Uint8Array, listo para pasarle a leerFicha(). */
function construirFichaSintetica() {
    const wb = XLSX.utils.book_new();
    const agregar = (nombre, filas) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre);
    };
    agregar('Estructura base JSON', INDICE);
    agregar('datosGenerales', DATOS_GENERALES);
    agregar('personas', PERSONAS);
    agregar('polizaMadre', NO_APLICA);
    agregar('intermediario', SIN_PROPIOS);
    agregar('JSON Generado', hojaEjemplo());
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

module.exports = { construirFichaSintetica, EJEMPLO_OBJ };
