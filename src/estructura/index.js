'use strict';

/**
 * @file index.js
 * @description Modo "Estructura": lee la ficha del INS y arma la vista única.
 *
 * En v1.0.0 la vista es solo la ficha aplanada. El cruce contra el form-def
 * llega en v1.1.0, así que acá se deja la tabla ya con las columnas del lado
 * FORM-DEF vacías: cuando se enganche el cruce, se llenan sin mover el resto.
 */

const XLSX = require('xlsx');
const { leerFicha, typosContraEjemplo } = require('./ficha-reader');

/**
 * Agrupa los campos por Paso → Sección respetando el orden en que aparecen en
 * la ficha. No se reordena nada: el orden de la ficha ES la referencia contra
 * la que después se compara el form-def.
 */
function agrupar(campos) {
    const grupos = [];
    const porClave = Object.create(null);

    campos.forEach(function (c) {
        const paso = c.paso || '(sin paso)';
        const seccion = c.seccion || '(sin sección)';
        const k = paso + ' ▸ ' + seccion;
        if (!porClave[k]) {
            porClave[k] = { paso: paso, seccion: seccion, clave: k, campos: [] };
            grupos.push(porClave[k]);
        }
        porClave[k].campos.push(c);
    });

    return grupos;
}

/** Una fila de la tabla: el lado ficha lleno, el lado form-def por llenar. */
function aFila(c) {
    return {
        n: 0,                 // se numera en analizarEstructura, ya aplanado
        hoja: c.hoja,
        paso: c.paso,
        seccion: c.seccion,
        label: c.label,
        nombrePdf: c.nombrePdf,
        tipoFicha: c.tipoFicha,
        tipo: c.tipo,
        opciones: c.opciones,
        reglas: c.reglas,
        obligatorio: c.obligatorio,
        visualizacion: c.visualizacion,
        observaciones: c.observaciones,
        formularios: c.formularios,
        ruta: c.ruta,
        rutas: c.rutas,
        rutaCorta: c.ruta.replace(/^datosFormulario\./, ''),
        hojaRuta: c.hojaRuta,
        sourceNames: c.sourceNames,
        destino: c.destino,
        flags: c.flags,
        // Lado form-def — se llena en v1.1.0 con el cruce.
        formDef: null,
        estado: 'sin-cruzar',
        motivo: '',
    };
}

/**
 * @param {Buffer|Uint8Array} fichaBytes
 * @param {Object|null} formDef - reservado para v1.1.0
 */
function analizarEstructura(fichaBytes, formDef) {
    const ficha = leerFicha(fichaBytes);
    const filas = ficha.campos.map(aFila);
    // El número es el orden de la ficha leída de arriba a abajo, y es la
    // referencia contra la que después se compara el orden del form-def.
    filas.forEach(function (f, i) { f.n = i + 1; });
    const grupos = agrupar(filas);

    return {
        filas: filas,
        grupos: grupos,
        indice: ficha.indice,
        hojas: ficha.hojas,
        ejemplo: { ok: !ficha.ejemplo.error, error: ficha.ejemplo.error },
        typos: typosContraEjemplo(ficha.campos, ficha.ejemplo),
        stats: ficha.stats,
        conFormDef: Boolean(formDef),
    };
}

const COLUMNAS = [
    ['#', function (f) { return f.n; }],
    ['Hoja', function (f) { return f.hoja; }],
    ['Paso', function (f) { return f.paso; }],
    ['Sección', function (f) { return f.seccion; }],
    ['Label (ficha)', function (f) { return f.label; }],
    ['Nombre en PDF', function (f) { return f.nombrePdf; }],
    ['Tipo (ficha)', function (f) { return f.tipoFicha; }],
    ['Tipo (form-def)', function (f) { return f.tipo || ''; }],
    ['Opciones', function (f) { return f.opciones.map(function (o) { return o.valor; }).join(' | '); }],
    ['Regla', function (f) { return f.reglas.join(' | '); }],
    ['Obligatorio', function (f) { return f.obligatorio; }],
    ['Visualización', function (f) { return f.visualizacion; }],
    ['Observaciones', function (f) { return f.observaciones; }],
    ['Formulario', function (f) { return f.formularios; }],
    ['Ruta JSON', function (f) { return f.rutas.join(', '); }],
    ['sourceName', function (f) { return f.sourceNames.join(' | '); }],
    ['Destino', function (f) { return f.destino; }],
    ['Estado', function (f) { return f.estado; }],
    ['Motivo', function (f) { return f.motivo; }],
];

/** La tabla de la pantalla, como xlsx. */
function exportarVistaUnica(analisis) {
    const aoa = [COLUMNAS.map(function (c) { return c[0]; })];
    analisis.filas.forEach(function (f) {
        aoa.push(COLUMNAS.map(function (c) { return c[1](f); }));
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 5 }, { wch: 16 }, { wch: 20 }, { wch: 22 }, { wch: 34 }, { wch: 24 },
        { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 40 }, { wch: 12 }, { wch: 26 },
        { wch: 26 }, { wch: 12 }, { wch: 46 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 34 },
    ];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: COLUMNAS.length - 1 } }) };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vista única');

    // Segunda hoja: el resumen, para no tener que contar a mano.
    const resumen = [['Métrica', 'Valor']];
    Object.keys(analisis.stats).forEach(function (k) {
        const v = analisis.stats[k];
        if (v !== null && typeof v === 'object') return;
        resumen.push([k, v]);
    });
    if (analisis.typos.length) {
        resumen.push([], ['Typos contra el JSON de ejemplo (no corregidos)', '']);
        analisis.typos.forEach(function (t) { resumen.push([t.escrito, 'ejemplo: ' + t.enEjemplo]); });
    }
    const wsR = XLSX.utils.aoa_to_sheet(resumen);
    wsR['!cols'] = [{ wch: 44 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

module.exports = { analizarEstructura, exportarVistaUnica, agrupar, COLUMNAS };
