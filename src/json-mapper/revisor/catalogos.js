// ---------------------------------------------------------------------------
// Catálogos del INS y convenciones de estructura (v4.0.0).
//
// Los códigos salen del xlsx de catálogos del INS, no de la ficha ni del JSON de
// ejemplo, que se contradicen entre sí con frecuencia. Están acá y no repartidos
// por el código para que una corrección del cliente se aplique en un solo lugar
// y el Revisor la tome en todos los formularios a la vez.
// ---------------------------------------------------------------------------
/** Tipo de identificación de persona física. `Otro` existe solo si el PDF trae la casilla. */
const TIPO_ID_FISICA = [
    { label: 'Física', codigo: '0' },
    { label: 'DIMEX', codigo: '6' },
    { label: 'Pasaporte', codigo: '9' },
    { label: 'DIDI', codigo: '12' },
];
/** Tipo de identificación jurídica: tomador de la póliza y beneficiario jurídico. */
const TIPO_ID_JURIDICA = [
    { label: 'Jurídica Nacional', codigo: '3' },
    { label: 'Gobierno', codigo: '2' },
    { label: 'Institución autónoma', codigo: '4' },
    { label: 'Jurídica extranjera', codigo: '7' },
];
const ESTADO_CIVIL = [
    { label: 'Soltero (a)', codigo: '1' },
    { label: 'Casado (a)', codigo: '2' },
    { label: 'Separación judicial', codigo: '3' },
    { label: 'Divorciado (a)', codigo: '4' },
    { label: 'Viudo (a)', codigo: '5' },
    { label: 'Célibe', codigo: '6' },
    { label: 'Reconciliación judicial', codigo: '7' },
    { label: 'Anulado', codigo: '8' },
    { label: 'Unión libre', codigo: '9' },
];
const MONEDA = [
    { label: 'Colones', codigo: 'CRC' },
    { label: 'Dólares', codigo: 'USD' },
];
const FORMA_PAGO = [
    { label: 'Anual', codigo: '1' },
    { label: 'Semestral', codigo: '2' },
    { label: 'Trimestral', codigo: '3' },
    { label: 'Mensual', codigo: '4' },
    { label: 'Deducción Mensual', codigo: '5' },
    { label: 'Cargo Automático', codigo: '6' },
];
const TIPO_TRAMITE = [
    { label: 'Nuevo Seguro', codigo: 'EMI' },
    { label: 'Cambios en tu Seguro', codigo: 'VAR' },
    { label: 'Dar de Baja tu Seguro', codigo: 'CAN' },
    { label: 'Inclusión en póliza', codigo: 'INC' },
];
const TIPO_PERSONA = [
    { label: 'Asegurado Directo', codigo: 'ASG' },
    { label: 'Dependiente Menor de Edad', codigo: 'DME' },
    { label: 'Dependiente Mayor de Edad', codigo: 'DMA' },
    { label: 'Asegurado Nominal', codigo: 'ASN' },
    { label: 'Beneficiario', codigo: 'BNF' },
    { label: 'Tomador de Seguro', codigo: 'TOM' },
    { label: 'Representante Legal', codigo: 'RPL' },
    { label: 'Persona Jurídica', codigo: 'PJR' },
];
/**
 * `JRD` y `PJR` son **el mismo concepto con dos nombres**, no dos miembros de un
 * grupo: la ficha escribe `JRD` y el catálogo `PJR`, y cuál manda sigue abierto
 * con el cliente. Tratarlos como grupo hacía que cualquier form que usara uno
 * solo diera un hallazgo pidiendo el otro, que es ruido garantizado.
 */
const ALIAS_PERSONA = {
    JRD: 'PJR',
};
/** Aplica los alias para poder comparar códigos sin depender de cuál se escribió. */
const normalizarCodigoPersona = (c) => ALIAS_PERSONA[c] ?? c;
/**
 * Grupos de `codigoTipo`. Una condición sobre el tipo de persona tiene que
 * cubrir TODO su grupo, en código y en etiqueta: si un bloque se muestra para
 * ASG pero el request trae DME, la sección se abre vacía y el PDF sale en
 * blanco ahí, sin ningún error (§P18 + §P8).
 *
 * `ASN` y `RPL` quedan fuera a propósito: existen en el catálogo pero no se
 * verificó con qué otros códigos comparten bloque. Un código sin grupo
 * simplemente no dispara la regla, que es el default seguro; meterlo adivinando
 * generaría hallazgos falsos en todos los formularios que lo usen.
 */
const GRUPOS_PERSONA = {
    asegurado: ['ASG', 'DME', 'DMA'],
    tomador: ['TOM'],
    juridica: ['PJR'],
};
/** Orden canónico de secciones. Todos los productos tienen que verse igual. */
const ORDEN_SECCIONES = [
    'Datos Generales',
    'Datos de la Persona',
    'Dependientes',
    'Información del Riesgo',
    'Beneficiarios',
    'Firmas',
    'Declaraciones y Autorización',
];
/** Anchos por tipo de campo, acordados para que todos los formularios coincidan. */
const ANCHOS_ACORDADOS = [
    { patron: /tipo_id|tipoIdentificacion/i, ancho: 'half', que: 'tipo de identificación' },
    { patron: /_identificacion$|numeroIdentificacion/i, ancho: 'half', que: 'número de identificación' },
    { patron: /primer_?(apellido|nombre)|segundo_?(apellido|nombre)/i, ancho: 'quarter', que: 'los 4 nombres' },
    { patron: /nombre_?completo/i, ancho: 'full', que: 'nombre completo' },
    { patron: /provincia|canton|distrito/i, ancho: 'third', que: 'provincia / cantón / distrito' },
];
/**
 * Palabras que el importador suele dejar sin tilde. Se comparan contra el label
 * visible; las rutas JSON nunca se tocan (`codigoGenero` es correcto así).
 */
const TILDES = {
    Informacion: 'Información',
    informacion: 'información',
    Poliza: 'Póliza',
    poliza: 'póliza',
    Dolares: 'Dólares',
    dolares: 'dólares',
    Cedula: 'Cédula',
    cedula: 'cédula',
    Juridica: 'Jurídica',
    juridica: 'jurídica',
    Institucion: 'Institución',
    autonoma: 'autónoma',
    Emision: 'Emisión',
    Automatico: 'Automático',
    Deduccion: 'Deducción',
    Electronico: 'Electrónico',
    electronico: 'electrónico',
    Fisico: 'Físico',
    Fisica: 'Física',
    Telefono: 'Teléfono',
    telefono: 'teléfono',
    Direccion: 'Dirección',
    direccion: 'dirección',
    Canton: 'Cantón',
    Descripcion: 'Descripción',
    Codigo: 'Código',
    codigo: 'código',
    Identificacion: 'Identificación',
    identificacion: 'identificación',
    Autorizacion: 'Autorización',
    Notificacion: 'Notificación',
    notificacion: 'notificación',
    Numero: 'Número',
    Ano: 'Año',
    Dia: 'Día',
    tramite: 'trámite',
    Tramite: 'Trámite',
    Ubicacion: 'Ubicación',
    razon: 'razón',
};
/**
 * Cambios de TÉRMINO, no de ortografía. Van aparte de `TILDES` porque el
 * hallazgo es distinto: "Género → Sexo" no es un acento que falta, es una
 * decisión de vocabulario acordada con el cliente, y mezclarlos daba un mensaje
 * que se leía mal ("Label sin tildes: Genero → Sexo").
 *
 * Solo afecta lo VISIBLE. Las rutas JSON siguen siendo `codigoGenero` y
 * `descripcionGenero`: esas las define el INS y no se tocan.
 */
const TERMINOS = {
    Genero: 'Sexo',
    Género: 'Sexo',
    genero: 'sexo',
    género: 'sexo',
};
const aplicar = (texto, dicc) => {
    let out = texto;
    for (const [mal, bien] of Object.entries(dicc)) {
        out = out.replace(new RegExp(`\\b${mal}\\b`, 'g'), bien);
    }
    return out === texto ? null : out;
};
/** Devuelve la versión con tildes de un texto, o null si ya está bien. */
const corregirTildes = (texto) => aplicar(texto, TILDES);
/** Devuelve la versión con el término acordado, o null si ya está bien. */
const corregirTerminos = (texto) => aplicar(texto, TERMINOS);
/**
 * Quita acentos para comparar. Hace falta en R01: no está verificado si
 * Signaframe conserva el acento de un sourceName al derivar el id, y la
 * convención de Etapa 0 ya slugifica los nombres, así que un sourceName con
 * acento no debería existir. Ante la duda, no marcar.
 */
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/**
 * El id que Signaframe deriva de un sourceName.
 *
 * No es solo pasar a minúsculas: la plataforma **slugifica**. Un sourceName
 * indexado de repeater, `depGeneroFem[0]`, llega como `field_depgenerofem_0`,
 * no como `field_depgenerofem[0]`. Verificado contra los form-def reales, donde
 * los 118 campos indexados siguen esta forma sin excepción.
 *
 * Comparar contra el sourceName crudo daba 117 falsos positivos en un solo
 * formulario: el 69% de todo el ruido del diagnóstico, tapando los hallazgos
 * de verdad.
 */
const comoId = (sourceName) => sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // corridas de no-alfanuméricos -> un solo _
    .replace(/^_+|_+$/g, '');    //   sin _ colgando: `[0]` da `_0`, no `_0_`

module.exports = { TIPO_ID_FISICA, TIPO_ID_JURIDICA, ESTADO_CIVIL, MONEDA, FORMA_PAGO, TIPO_TRAMITE, TIPO_PERSONA, ALIAS_PERSONA, normalizarCodigoPersona, GRUPOS_PERSONA, ORDEN_SECCIONES, ANCHOS_ACORDADOS, TILDES, TERMINOS, corregirTildes, corregirTerminos, sinAcentos, comoId };
