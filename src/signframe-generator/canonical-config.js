'use strict';

/**
 * Configuración del Generador de Matriz Canónica.
 *
 * Todo lo específico de un formulario va acá (NO en el código), para que el
 * mismo generador sirva en cualquier form del INS. Editá este archivo para
 * cada cliente/producto si hace falta.
 */
module.exports = {
    // Sufijos de opción (radios Si/No/NoAplica). Se prueban como sufijo del
    // sourceName, con o sin separador "_". Orden: del más largo al más corto.
    optionSuffixes: ['NoAplica', 'Si', 'No'],

    // Prefijos "lookup": TODOS los sourceNames que empiezan con el prefijo
    // colapsan en UNA sola fila canónica (tipoCampo = repeaterLookup), porque
    // se resuelven contra un catálogo. Ej: las ~106 enfermedades en 1 fila.
    lookupPrefixes: [
        {
            prefix: 'enf',
            catalogo: 'Catálogo Enfermedades',
            seccion: 'Cuestionario de Salud',
            grupo: 'enfermedades',
        },
    ],

    // Derivación de Sección por prefijo del sourceName. Gana el prefijo más
    // largo que matchee (startsWith). Si ninguno matchea -> defaultSection.
    sectionByPrefix: {
        titular: 'Datos del Titular',
        tomador: 'Datos del Tomador',
        dep: 'Dependientes',
        depTit: 'Dependientes',
        benef: 'Beneficiarios',
        benefDep: 'Beneficiarios',
        cuest: 'Cuestionario',
        riesgo: 'Cuestionario de Salud',
        intermediario: 'Datos del Asesor',
        pago: 'Forma de Pago',
        vigencia: 'Vigencia',
        moneda: 'Datos de la Póliza',
        plan: 'Plan / Coberturas',
        firma: 'Firmas',
        decl: 'Declaraciones',
        jurada: 'Declaración Jurada',
    },

    defaultSection: 'General',

    // Prefijos que, además, son "repeaters de entidad" (dependientes,
    // beneficiarios): informativo para el generador de JSON. No cambia el
    // colapso (los [n] ya se agrupan por raíz), pero se marca el grupo.
    entityPrefixes: ['dep', 'depTit', 'benef', 'benefDep'],
};
