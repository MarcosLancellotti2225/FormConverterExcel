// ---------------------------------------------------------------------------
// Tipos del form-definition de Signaframe, SOLO para leerlo (v4.0.0).
//
// En v3.0.0 estos tipos se borraron porque la app dejó de generar el form-def.
// Vuelven acá con un alcance distinto y mucho más chico: el Revisor **lee** un
// form-def que ya existe para auditarlo. No lo construye ni lo modifica, así que
// todo es opcional y nada se valida al parsear: lo que está mal es justamente lo
// que hay que mostrar, no lo que hay que rechazar al abrir el archivo.
// ---------------------------------------------------------------------------
/** Parsea el string JSON serializado de conditionalVisibility / conditionalRequired. */
function parseCondicion(raw) {
    if (!raw)
        return null;
    try {
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : null;
    }
    catch {
        return null;
    }
}

module.exports = { parseCondicion };
