'use strict';

/**
 * @file ficha-reader.js
 * @description Lee la Ficha de configuración del INS en su formato nuevo (una
 * hoja por nodo del JSON) y la aplana en una sola tabla de campos.
 *
 * El formato está documentado en la skill `signframe-form-def`,
 * references/ficha-nueva.md (§M1 a §M7). Lo que sigue implementa eso.
 *
 * Dos decisiones que se repiten en todo el archivo:
 *
 *  - Las columnas se leen por POSICIÓN, nunca por el texto del header. Las
 *    fichas reales escriben la misma columna de tres maneras ("Nombre del
 *    Campo en Json", "Nombre del campo en el JSON"), y buscar por texto las
 *    pierde en silencio.
 *
 *  - Los typos de la ficha NO se corrigen. `drograMedicamento` se lee y se
 *    muestra tal cual. Corregirlo acá haría que el form-def y la ficha digan
 *    cosas distintas sin que nadie se entere; lo que sí hacemos es marcarlo
 *    cuando la hoja "JSON Generado" escribe la ruta de otra forma.
 */

const XLSX = require('xlsx');

/** Las 14 columnas de una hoja de nodo, por posición (§M2). */
const COL = {
    PASO: 0,
    SECCION: 1,
    NOMBRE_PDF: 2,
    LABEL: 3,
    TIPO: 4,
    VALOR: 5,
    REGLA: 6,
    OBLIGATORIO: 7,
    FORMULARIOS: 8,
    VISUALIZACION: 9,
    OBSERVACIONES: 10,
    SECCION_JSON: 11,
    RUTA: 12,
    SOURCE_NAME: 13,
};

const HOJA_INDICE = 'Estructura base JSON';
const HOJA_EJEMPLO = 'JSON Generado';

/** Hojas que existen pero no aportan campos. */
const SIN_CAMPOS = [
    'NO APLICA PARA ESTE FORMULARIO',
    'NO POSEE CAMPOS PROPIOS',
];

/** Tipo de dato de la ficha → `type` del form-def (§M3). */
const TIPOS = {
    'TEXTO': 'text',
    'NUMERICO': 'number',
    'NUMERICO/PORCENTUAL': 'number',
    'FECHA': 'date',
    'COMBO': 'select',
    'RADIO/COMBO': 'radio',
    'BOOLEAN': 'boolean',
    'CHECKBOX': 'checkbox',
    'CHECK BOX': 'checkbox',
    'TABLA': 'tabla',
    'COMENTARIO INFORMATIVO': 'label',
};

/** trim + colapsa espacios dobles. "Both " y "Both" son lo mismo. */
function norm(v) {
    if (v == null) return '';
    return String(v).replace(/\s+/g, ' ').trim();
}

/** Para comparar: sin acentos, en mayúsculas. */
function clave(v) {
    return norm(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function contiene(texto, aguja) {
    return clave(texto).indexOf(clave(aguja)) !== -1;
}

/** El último segmento de una ruta: `personas[].codigoProvincia` → codigoProvincia. */
function hojaRuta(ruta) {
    if (!ruta) return '';
    var partes = String(ruta).split('.');
    return partes[partes.length - 1].replace(/\[\]$/, '');
}

/**
 * ¿Esta hoja declara que no tiene campos? Se mira todo el contenido y no una
 * celda fija, porque la leyenda aparece en posiciones distintas según la ficha.
 */
function hojaVacia(filas) {
    for (var i = 0; i < filas.length; i++) {
        for (var j = 0; j < filas[i].length; j++) {
            var c = clave(filas[i][j]);
            for (var k = 0; k < SIN_CAMPOS.length; k++) {
                if (c.indexOf(SIN_CAMPOS[k]) !== -1) return true;
            }
        }
    }
    return false;
}

/**
 * Clasifica a dónde va el campo. No son excluyentes: un campo puede ser
 * soloJSON y además estar oculto, así que se devuelven banderas y no un enum.
 */
function clasificar(fila) {
    var obligatorio = norm(fila[COL.OBLIGATORIO]);
    var paso = norm(fila[COL.PASO]);
    var visual = norm(fila[COL.VISUALIZACION]);
    var regla = norm(fila[COL.REGLA]);
    var ruta = norm(fila[COL.RUTA]);

    return {
        soloJSON: clave(obligatorio) === 'JSON' || clave(paso) === 'JSON',
        soloWeb: clave(obligatorio) === 'WEB',
        oculto: contiene(visual, 'No Aplica'),
        readOnly: contiene(visual, 'Disabled'),
        prefill: contiene(visual, 'Dato Prellenado'),
        // "No aplica Formulario D0873": la regla excluye el campo de un producto.
        excluido: /no aplica\s+formulario/i.test(regla),
        // Sin ruta de salida no es un campo: es un texto en el formulario.
        esLabel: !ruta,
    };
}

/** El `destino` de una sola palabra, para mostrar en la tabla. */
function destinoDe(flags) {
    if (flags.excluido) return 'excluido';
    if (flags.esLabel) return 'label';
    if (flags.soloJSON) return 'soloJSON';
    if (flags.soloWeb) return 'soloWeb';
    if (flags.oculto) return 'oculto';
    if (flags.readOnly) return 'readOnly';
    return 'normal';
}

/** Hoja 1: el índice de nodo → paso / sección web (§M1). */
function leerIndice(ws) {
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    var nodos = [];
    var ultimoNodo = '';
    for (var i = 1; i < raw.length; i++) {
        var nodo = norm(raw[i][0]);
        var paso = norm(raw[i][1]);
        var seccion = norm(raw[i][2]);
        if (!nodo && !paso && !seccion) continue;
        // Nodo vacío con paso propio = el nodo anterior se instancia otra vez
        // (personas[] sale como Tomador, Asegurado, Dependiente...).
        if (!nodo) nodo = ultimoNodo;
        else ultimoNodo = nodo;
        nodos.push({ nodo: nodo, paso: paso, seccion: seccion, instancia: !norm(raw[i][0]) });
    }
    return nodos;
}

/** Última hoja: el JSON de ejemplo, escrito una línea por celda. */
function leerEjemplo(ws) {
    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    var texto = raw.map(function (fila) {
        return fila.map(function (c) { return c == null ? '' : String(c); }).join('');
    }).join('\n');
    try {
        return { json: JSON.parse(texto), texto: texto, error: null };
    } catch (e) {
        return { json: null, texto: texto, error: e.message };
    }
}

/** Una fila cruda de hoja de nodo → el objeto que vamos a colapsar. */
function leerFila(fila, hoja, numeroFila) {
    var rutaCruda = norm(fila[COL.RUTA]);
    // §M2: dos rutas separadas por coma = par código + descripción.
    var rutas = rutaCruda ? rutaCruda.split(',').map(norm).filter(Boolean) : [];
    var tipoFicha = norm(fila[COL.TIPO]);
    var flags = clasificar(fila);

    return {
        hoja: hoja,
        fila: numeroFila,
        paso: norm(fila[COL.PASO]),
        seccion: norm(fila[COL.SECCION]),
        nombrePdf: norm(fila[COL.NOMBRE_PDF]),
        label: norm(fila[COL.LABEL]),
        tipoFicha: tipoFicha,
        tipo: TIPOS[clave(tipoFicha)] || null,
        valor: norm(fila[COL.VALOR]),
        regla: norm(fila[COL.REGLA]),
        obligatorio: norm(fila[COL.OBLIGATORIO]),
        formularios: norm(fila[COL.FORMULARIOS]),
        visualizacion: norm(fila[COL.VISUALIZACION]),
        observaciones: norm(fila[COL.OBSERVACIONES]),
        seccionJson: norm(fila[COL.SECCION_JSON]),
        ruta: rutas[0] || '',
        rutas: rutas,
        sourceName: norm(fila[COL.SOURCE_NAME]),
        flags: flags,
    };
}

/**
 * Colapsa las filas de una hoja a campos. La ficha escribe una fila POR OPCIÓN
 * —un Sí/No son dos filas, un combo son N— pero eso es un solo campo. Se
 * agrupa por ruta y las opciones se juntan en `opciones[]`, cada una con su
 * regla, porque la regla de la ficha cuelga de la opción y no del campo
 * ("Sí → Despliega todas las preguntas de fumado").
 *
 * Las filas sin ruta no se pueden agrupar por ruta: cada una es su propio
 * texto y queda como campo aparte.
 */
function colapsar(filas) {
    var campos = [];
    var porRuta = Object.create(null);

    filas.forEach(function (f) {
        if (!f.ruta) {
            campos.push(aCampo(f));
            return;
        }
        var previo = porRuta[f.ruta];
        if (!previo) {
            var campo = aCampo(f);
            porRuta[f.ruta] = campo;
            campos.push(campo);
            return;
        }
        previo.filas.push(f.fila);
        // Cada fila extra aporta su opción con la regla que le corresponde.
        if (f.valor) previo.opciones.push({ valor: f.valor, regla: f.regla });
        // Distintos sourceNames para la misma ruta = varios widgets del PDF
        // (el caso de los radios): se guardan todos.
        if (f.sourceName && previo.sourceNames.indexOf(f.sourceName) === -1) {
            previo.sourceNames.push(f.sourceName);
        }
        if (f.regla && previo.reglas.indexOf(f.regla) === -1) previo.reglas.push(f.regla);
    });

    return campos;
}

function aCampo(f) {
    return {
        hoja: f.hoja,
        filas: [f.fila],
        paso: f.paso,
        seccion: f.seccion,
        nombrePdf: f.nombrePdf,
        label: f.label,
        tipoFicha: f.tipoFicha,
        tipo: f.tipo,
        opciones: f.valor ? [{ valor: f.valor, regla: f.regla }] : [],
        reglas: f.regla ? [f.regla] : [],
        obligatorio: f.obligatorio,
        formularios: f.formularios,
        visualizacion: f.visualizacion,
        observaciones: f.observaciones,
        seccionJson: f.seccionJson,
        ruta: f.ruta,
        rutas: f.rutas,
        hojaRuta: hojaRuta(f.ruta),
        sourceNames: f.sourceName ? [f.sourceName] : [],
        flags: f.flags,
        destino: destinoDe(f.flags),
    };
}

/**
 * Lee la ficha entera.
 * @param {Buffer|Uint8Array|ArrayBuffer} bytes - el xlsx
 * @returns {{campos:Array, indice:Array, ejemplo:Object, hojas:Array, stats:Object}}
 */
function leerFicha(bytes) {
    var wb = XLSX.read(bytes, { type: 'array' });
    var nombres = wb.SheetNames;
    if (!nombres.length) throw new Error('La ficha no tiene hojas');

    var indice = [];
    var ejemplo = { json: null, texto: '', error: 'La ficha no trae hoja "' + HOJA_EJEMPLO + '"' };
    var hojas = [];
    var campos = [];

    nombres.forEach(function (nombre) {
        var ws = wb.Sheets[nombre];

        if (clave(nombre) === clave(HOJA_INDICE)) {
            indice = leerIndice(ws);
            hojas.push({ nombre: nombre, rol: 'indice', filas: indice.length, campos: 0 });
            return;
        }
        if (clave(nombre) === clave(HOJA_EJEMPLO)) {
            ejemplo = leerEjemplo(ws);
            hojas.push({ nombre: nombre, rol: 'ejemplo', filas: 0, campos: 0 });
            return;
        }

        var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (hojaVacia(raw)) {
            hojas.push({ nombre: nombre, rol: 'nodo', filas: 0, campos: 0, motivo: 'no aplica' });
            return;
        }

        // Fila 1 es el header; los datos arrancan en la 2.
        var filas = [];
        for (var i = 1; i < raw.length; i++) {
            var fila = raw[i];
            // Una fila que no dice nada útil no es un campo.
            if (!norm(fila[COL.LABEL]) && !norm(fila[COL.RUTA]) && !norm(fila[COL.SOURCE_NAME])) continue;
            filas.push(leerFila(fila, nombre, i + 1));
        }

        var delaHoja = colapsar(filas);
        campos = campos.concat(delaHoja);
        hojas.push({ nombre: nombre, rol: 'nodo', filas: filas.length, campos: delaHoja.length });
    });

    return {
        campos: campos,
        indice: indice,
        ejemplo: ejemplo,
        hojas: hojas,
        stats: estadisticas(campos, hojas),
    };
}

function estadisticas(campos, hojas) {
    var porDestino = Object.create(null);
    var conSourceName = 0;
    campos.forEach(function (c) {
        porDestino[c.destino] = (porDestino[c.destino] || 0) + 1;
        if (c.sourceNames.length) conSourceName++;
    });
    return {
        hojas: hojas.length,
        hojasConCampos: hojas.filter(function (h) { return h.campos > 0; }).length,
        filasConRuta: campos.reduce(function (n, c) { return n + (c.ruta ? c.filas.length : 0); }, 0),
        campos: campos.length,
        soloJSON: campos.filter(function (c) { return c.flags.soloJSON; }).length,
        ocultos: campos.filter(function (c) { return c.flags.oculto; }).length,
        readOnly: campos.filter(function (c) { return c.flags.readOnly; }).length,
        prefill: campos.filter(function (c) { return c.flags.prefill; }).length,
        excluidos: campos.filter(function (c) { return c.flags.excluido; }).length,
        labels: campos.filter(function (c) { return c.flags.esLabel; }).length,
        conSourceName: conSourceName,
        porDestino: porDestino,
    };
}

/**
 * Rutas que la ficha escribe de una forma y el JSON de ejemplo de otra. No se
 * corrige nada: se listan para reportar.
 */
function typosContraEjemplo(campos, ejemplo) {
    if (!ejemplo || !ejemplo.json) return [];

    var delEjemplo = new Set();
    (function recorrer(nodo, prefijo) {
        if (nodo == null || typeof nodo !== 'object') return;
        if (Array.isArray(nodo)) { recorrer(nodo[0], prefijo + '[]'); return; }
        Object.keys(nodo).forEach(function (k) {
            var ruta = prefijo ? prefijo + '.' + k : k;
            delEjemplo.add(k);
            recorrer(nodo[k], ruta);
        });
    })(ejemplo.json, '');

    var hallazgos = [];
    campos.forEach(function (c) {
        if (!c.hojaRuta || delEjemplo.has(c.hojaRuta)) return;
        // ¿Hay algo parecido? Solo se propone si difiere poco: si no se parece
        // a nada, es un campo que el ejemplo no trae y no un typo.
        var parecido = null;
        delEjemplo.forEach(function (k) {
            if (parecido) return;
            if (clave(k) === clave(c.hojaRuta)) { parecido = k; return; }
            if (k.length > 4 && distancia(k.toLowerCase(), c.hojaRuta.toLowerCase()) <= 2) parecido = k;
        });
        if (parecido) {
            hallazgos.push({
                hoja: c.hoja, ruta: c.ruta, escrito: c.hojaRuta, enEjemplo: parecido,
                detalle: 'La ficha escribe `' + c.hojaRuta + '` y el JSON de ejemplo `' + parecido + '`.',
            });
        }
    });
    return hallazgos;
}

/** Levenshtein acotada: solo se usa para sugerir, nunca para cruzar campos. */
function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    var fila = [];
    for (var j = 0; j <= b.length; j++) fila[j] = j;
    for (var i = 1; i <= a.length; i++) {
        var previo = fila[0];
        fila[0] = i;
        for (var k = 1; k <= b.length; k++) {
            var temp = fila[k];
            fila[k] = Math.min(
                fila[k] + 1,
                fila[k - 1] + 1,
                previo + (a[i - 1] === b[k - 1] ? 0 : 1)
            );
            previo = temp;
        }
    }
    return fila[b.length];
}

module.exports = {
    leerFicha, typosContraEjemplo,
    // exportados para los tests
    norm, clave, hojaRuta, clasificar, destinoDe, colapsar, TIPOS, COL,
};
