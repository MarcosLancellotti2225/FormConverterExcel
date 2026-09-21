// ---------------------------------------------------------------------------
// El modelo unificado: un form-def visto como formulario Y como JSON (v4.0.0).
//
// Es la pieza que hace posible el switch entre las dos vistas. El form-def
// mezcla los dos contratos en un mismo archivo —cada campo lleva a la vez su
// presentación, su ruta de entrada y su ruta de salida—, así que leerlo de un
// solo lado siempre deja la mitad afuera. Acá se aplana una vez y se indexa por
// las dos claves: por sección (lo que ve el usuario) y por ruta JSON (lo que
// recibe el INS). Las dos vistas y el diagnóstico leen de este mismo modelo, y
// por eso seleccionar en una ilumina en la otra.
//
// El hallazgo que justifica la vista JSON: los errores caros no se ven mirando
// campos de a uno. Se ven cuando dos campos escriben la misma ruta, cuando una
// ruta del contrato no la escribe nadie, o cuando una ruta sale con el tipo
// equivocado. Eso es una propiedad del árbol, no de un campo.
// ---------------------------------------------------------------------------
const {parseCondicion} = require('./tipos.js');
function esOculto(x) {
    return x.hidden === true;
}
/** El tipo que la plataforma va a emitir para este campo (§P2, §P3). */
function tipoEmitido(c) {
    switch (c.type) {
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'number';
        case 'date':
            return 'string (fecha)';
        case 'select':
            return c.selectJsonValueType === 'number' ? 'number' : 'string';
        case 'radio':
        case 'checkbox':
            // Un radio nunca emite false nativo: con jsonValue sale string, vacío sale true.
            return c.jsonValue != null ? 'string' : 'boolean (solo true)';
        default:
            return 'string';
    }
}
function origenDe(c) {
    if (c.autoFillConcat)
        return 'concat';
    if (c.defaultValue != null && c.defaultValue !== '')
        return 'default';
    if (c.prefillKey)
        return 'prefill';
    return 'usuario';
}
/** Ruta de salida efectiva. `salidaJSON` y `jsonOutputPath` deberían coincidir. */
function rutaDe(c) {
    if (c.excludeFromJson === true)
        return null;
    const r = c.jsonOutputPath ?? c.salidaJSON;
    return typeof r === 'string' && r.length > 0 ? r : null;
}
function insertar(arbol, hoja) {
    // `personas[0].direccion.pais` -> ['personas[0]', 'direccion', 'pais']
    const partes = hoja.ruta.split('.').filter(Boolean);
    let nodo = arbol;
    let acum = '';
    partes.forEach((p, i) => {
        acum = acum ? `${acum}.${p}` : p;
        let hijo = nodo.hijos.find((h) => h.nombre === p);
        if (!hijo) {
            hijo = { nombre: p, ruta: acum, hijos: [] };
            nodo.hijos.push(hijo);
        }
        if (i === partes.length - 1)
            hijo.hoja = hoja;
        nodo = hijo;
    });
}
function construirModelo(def) {
    const campos = [];
    const recorrer = (sec, ruta, ocultoPadre) => {
        const rutaAqui = [...ruta, sec.title ?? sec.id];
        const oculto = ocultoPadre || esOculto(sec) || Boolean(sec.conditionalVisibility?.includes('NEVER_EXISTS'));
        for (const campo of sec.fields ?? []) {
            campos.push({
                campo,
                ruta: rutaAqui,
                seccionId: sec.id,
                ocultoEfectivo: oculto || esOculto(campo),
            });
            // Los subcampos de un repeater no son campos sueltos: no pasan por el
            // mapeo de tipos ni por las condiciones de arriba (§P6), así que se
            // registran aparte para poder marcarlos en el diagnóstico.
            for (const sub of campo.repeaterConfig?.fields ?? []) {
                campos.push({
                    campo: sub,
                    ruta: [...rutaAqui, campo.label ?? campo.id],
                    seccionId: sec.id,
                    ocultoEfectivo: oculto,
                    dentroDeRepeater: campo.id,
                });
            }
        }
        for (const sub of sec.subsections ?? [])
            recorrer(sub, rutaAqui, oculto);
    };
    for (const sec of def.sections ?? [])
        recorrer(sec, [], false);
    const porId = new Map();
    for (const cp of campos)
        if (!cp.dentroDeRepeater)
            porId.set(cp.campo.id, cp);
    const porSourceName = new Map();
    for (const cp of campos) {
        const sn = cp.campo.sourceMeta?.sourceName;
        if (sn)
            porSourceName.set(sn, cp);
    }
    const porRuta = new Map();
    for (const cp of campos) {
        if (cp.dentroDeRepeater)
            continue;
        const ruta = rutaDe(cp.campo);
        if (!ruta)
            continue;
        const ya = porRuta.get(ruta);
        if (ya)
            ya.escriben.push(cp);
        else
            porRuta.set(ruta, {
                ruta,
                escriben: [cp],
                tipoEmitido: tipoEmitido(cp.campo),
                origen: origenDe(cp.campo),
            });
    }
    // Los repeaters no escriben por `jsonOutputPath` sino por su patrón (§P4).
    for (const cp of campos) {
        const rc = cp.campo.repeaterConfig;
        if (!rc?.jsonSlotPattern)
            continue;
        for (const sub of rc.fields ?? []) {
            const ruta = rc.jsonSlotPattern.replace('{sub}', sub.id);
            const ya = porRuta.get(ruta);
            if (ya)
                ya.escriben.push(cp);
            else
                porRuta.set(ruta, {
                    ruta,
                    escriben: [cp],
                    tipoEmitido: tipoEmitido(sub),
                    origen: 'repeater',
                });
        }
    }
    const arbol = { nombre: '', ruta: '', hijos: [] };
    for (const hoja of porRuta.values())
        insertar(arbol, hoja);
    const sourceNamesPdf = (def._sourcePdf?.fieldPositions ?? [])
        .map((p) => p.sourceName)
        .filter((sn) => sn && !porSourceName.has(sn));
    return {
        def,
        secciones: def.sections ?? [],
        campos,
        porId,
        porRuta,
        arbol,
        porSourceName,
        sourceNamesPdf,
    };
}
/** Los fieldId a los que apunta un campo por cualquier vía. Sirve para el resaltado. */
function referenciasDe(c) {
    const out = new Set();
    for (const raw of [c.conditionalVisibility, c.conditionalRequired]) {
        for (const cond of parseCondicion(raw)?.conditions ?? []) {
            if (cond.fieldId)
                out.add(cond.fieldId);
        }
    }
    for (const id of c.autoFillConcat?.sourceFieldIds ?? [])
        out.add(id);
    for (const p of c.autoFillConcat?.parts ?? []) {
        if (p.fieldId)
            out.add(p.fieldId);
        if (p.condition?.fieldId)
            out.add(p.condition.fieldId);
    }
    for (const id of c.radioGroupFields ?? [])
        out.add(id);
    if (c.parentFieldId)
        out.add(c.parentFieldId);
    if (c.grandParentFieldId)
        out.add(c.grandParentFieldId);
    return [...out];
}

module.exports = { tipoEmitido, construirModelo, referenciasDe };
