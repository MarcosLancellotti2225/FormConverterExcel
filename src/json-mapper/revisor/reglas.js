// ---------------------------------------------------------------------------
// Las reglas del Revisor (v4.0.0).
//
// Cada regla es un hallazgo que ya costó caro alguna vez. El criterio para que
// algo entre acá no es "podría estar mal", es "esto rompió y el síntoma no
// apuntaba a la causa": un campo que sale como string, una sección que se abre
// vacía, una casilla que nunca se marca. Ninguno de esos da error al guardar en
// Signaframe —el form-def se guarda tal cual, sin validar (§P19)—, así que el
// chequeo tiene que correr acá afuera o no corre.
//
// Severidades:
//   error  rompe el entregable. No se sube así.
//   aviso  probablemente esté mal, pero puede ser intencional. Se explica.
//   nota   diferencia con la convención o con el contrato; decide una persona.
//
// Las reglas NO corrigen. Un fix automático sobre 400 campos es exactamente la
// clase de cambio que después nadie audita.
// ---------------------------------------------------------------------------
const {parseCondicion} = require('./tipos.js');
const {corregirTerminos, corregirTildes, GRUPOS_PERSONA, normalizarCodigoPersona, ORDEN_SECCIONES, sinAcentos, comoId} = require('./catalogos.js');
const etiqueta = (c) => c.label ?? c.id;
// --- R01 · id == "field_" + sourceName -------------------------------------
// Se compara contra las tres formas del id: literal, sin acentos y slugificado.
// Las dos últimas son tolerancia, no laxitud: Signaframe deriva el id bajando a
// minúsculas y reemplazando lo no alfanumérico por `_`, así que un sourceName
// indexado (`depGeneroFem[0]`) llega como `field_depgenerofem_0`. Comparar solo
// contra el crudo marcaba error en todos los campos de un repeater del PDF.
const rIdSourceName = (m) => m.campos
    .filter((cp) => cp.campo.sourceMeta?.sourceName)
    .filter((cp) => {
    const esperado = `field_${cp.campo.sourceMeta.sourceName.toLowerCase()}`;
    const real = cp.campo.id.toLowerCase();
    return real !== esperado && sinAcentos(real) !== sinAcentos(esperado) && comoId(real) !== comoId(esperado);
})
    .map((cp) => ({
    regla: 'R01',
    severidad: 'error',
    titulo: 'El id no coincide con su sourceName',
    detalle: `\`${cp.campo.id}\` debería ser \`field_${cp.campo.sourceMeta.sourceName.toLowerCase()}\`. El render mapea por id → sourceName → sourceMeta: si no coinciden, el campo no pinta.`,
    campoIds: [cp.campo.id],
}));
// --- R02 · ids duplicados ---------------------------------------------------
const rIdsDuplicados = (m) => {
    const cuenta = new Map();
    for (const cp of m.campos) {
        if (cp.dentroDeRepeater)
            continue;
        cuenta.set(cp.campo.id, (cuenta.get(cp.campo.id) ?? 0) + 1);
    }
    return [...cuenta.entries()]
        .filter(([, n]) => n > 1)
        .map(([id, n]) => ({
        regla: 'R02',
        severidad: 'error',
        titulo: 'id duplicado',
        detalle: `\`${id}\` aparece ${n} veces. Las referencias por id se vuelven ambiguas.`,
        campoIds: [id],
    }));
};
// --- R03 · condición apuntando a un id que no existe (§P8) ------------------
const rCondicionRota = (m) => {
    const out = [];
    for (const cp of m.campos) {
        if (cp.dentroDeRepeater)
            continue; // dentro de un repeater va el id pelado del hermano
        for (const clave of ['conditionalVisibility', 'conditionalRequired']) {
            for (const cond of parseCondicion(cp.campo[clave])?.conditions ?? []) {
                if (!cond.fieldId || cond.fieldId === 'field_NEVER_EXISTS')
                    continue;
                if (m.porId.has(cond.fieldId))
                    continue;
                out.push({
                    regla: 'R03',
                    severidad: 'error',
                    titulo: 'Condición apuntando a un campo inexistente',
                    detalle: `\`${etiqueta(cp.campo)}\` condiciona contra \`${cond.fieldId}\`, que no existe. Una condición que no matchea no falla: se ignora en silencio y el campo aparece donde no debería.`,
                    campoIds: [cp.campo.id],
                    ref: '§P8',
                });
            }
        }
    }
    return out;
};
// --- R04 · salidaJSON != jsonOutputPath ------------------------------------
const rSalidaDesalineada = (m) => m.campos
    .filter((cp) => {
    const a = cp.campo.salidaJSON ?? null;
    const b = cp.campo.jsonOutputPath ?? null;
    return a !== b && (a != null || b != null);
})
    .map((cp) => ({
    regla: 'R04',
    severidad: 'error',
    titulo: 'salidaJSON y jsonOutputPath no coinciden',
    detalle: `\`${etiqueta(cp.campo)}\`: salidaJSON = ${cp.campo.salidaJSON ?? 'null'}, jsonOutputPath = ${cp.campo.jsonOutputPath ?? 'null'}.`,
    campoIds: [cp.campo.id],
}));
// --- R05/R06/R07 · repeaters (§P4) -----------------------------------------
const rRepeaters = (m) => {
    const out = [];
    for (const cp of m.campos) {
        const rc = cp.campo.repeaterConfig;
        if (!rc)
            continue;
        if (cp.campo.jsonOutputPath || cp.campo.salidaJSON) {
            out.push({
                regla: 'R05',
                severidad: 'error',
                titulo: 'Repeater con jsonOutputPath',
                detalle: `\`${etiqueta(cp.campo)}\` es un repeater y tiene ruta de salida propia. El bucle de campos normales escribe el valor interno crudo ahí y sale "[object Object]". Los repeaters van con jsonOutputPath y salidaJSON en null.`,
                campoIds: [cp.campo.id],
                ref: '§P4',
            });
        }
        if (!rc.jsonSlotPattern) {
            out.push({
                regla: 'R06',
                severidad: 'error',
                titulo: 'Repeater sin jsonSlotPattern',
                detalle: `\`${etiqueta(cp.campo)}\` no tiene patrón de salida, así que va a colgar una clave con su id crudo de la raíz del JSON. Ojo: excludeFromJson NO apaga un repeater.`,
                campoIds: [cp.campo.id],
                ref: '§P4',
            });
        }
        else if (rc.jsonSlotPattern.includes('{i1}')) {
            out.push({
                regla: 'R07',
                severidad: 'error',
                titulo: 'Patrón de repeater 1-based',
                detalle: `\`${etiqueta(cp.campo)}\` usa {i1}: la posición 0 del array queda en null. Para arrays JSON siempre {i} o {i0}.`,
                campoIds: [cp.campo.id],
                ref: '§P4',
            });
        }
    }
    return out;
};
// --- R08 · autoFillConcat con condición fuera de sourceFieldIds (§P13) -----
const rSourceFieldIds = (m) => {
    const out = [];
    for (const cp of m.campos) {
        const afc = cp.campo.autoFillConcat;
        if (!afc?.parts)
            continue;
        const declarados = new Set(afc.sourceFieldIds ?? []);
        const faltantes = new Set();
        for (const p of afc.parts) {
            const fid = p.condition?.fieldId;
            if (fid && !declarados.has(fid))
                faltantes.add(fid);
        }
        if (faltantes.size) {
            out.push({
                regla: 'R08',
                severidad: 'error',
                titulo: 'Helper que escribe siempre',
                detalle: `\`${etiqueta(cp.campo)}\` condiciona contra ${[...faltantes].map((f) => `\`${f}\``).join(', ')}, pero no está en sourceFieldIds. El autoFillConcat solo se re-evalúa con los ids declarados ahí: sin eso, el helper escribe siempre, sin importar la condición.`,
                campoIds: [cp.campo.id],
                ref: '§P13',
            });
        }
    }
    return out;
};
// --- R09 · casilla del PDF que pinta con "X" (§E2) --------------------------
const rCasillaX = (m) => {
    const out = [];
    for (const cp of m.campos) {
        const nativo = cp.campo.sourceMeta?.nativeType;
        if (nativo !== 'Checkbox')
            continue;
        for (const p of cp.campo.autoFillConcat?.parts ?? []) {
            if (p.kind === 'text' && p.value === 'X') {
                out.push({
                    regla: 'R09',
                    severidad: 'error',
                    titulo: 'Casilla que pinta con "X"',
                    detalle: `\`${etiqueta(cp.campo)}\` es /Btn en el PDF y se marca con la cadena "X". Un checkbox se marca con true; con "X" puede no pintarse nunca.`,
                    campoIds: [cp.campo.id],
                    ref: '§E2',
                });
                break;
            }
        }
    }
    return out;
};
// --- R10 · select prellenado comparado solo por etiqueta (§P18) -------------
const rDosFormas = (m) => {
    const out = [];
    // Por cada campo con opciones y prefillKey, saber qué valores se comparan.
    const conOpciones = m.campos.filter((cp) => (cp.campo.options?.length ?? 0) > 0 && cp.campo.prefillKey);
    for (const origen of conOpciones) {
        const labels = new Map(); // label -> jsonValue
        for (const o of origen.campo.options ?? []) {
            if (o.label && o.jsonValue && o.label !== o.jsonValue)
                labels.set(o.label, o.jsonValue);
        }
        if (!labels.size)
            continue;
        const comparados = new Set();
        const culpables = new Set();
        for (const cp of m.campos) {
            for (const clave of ['conditionalVisibility', 'conditionalRequired']) {
                for (const cond of parseCondicion(cp.campo[clave])?.conditions ?? []) {
                    if (cond.fieldId === origen.campo.id && cond.operator === 'equals' && cond.value) {
                        comparados.add(cond.value);
                        culpables.add(cp.campo.id);
                    }
                }
            }
            for (const p of cp.campo.autoFillConcat?.parts ?? []) {
                const c = p.condition;
                if (c?.fieldId === origen.campo.id && c.op === 'equals' && c.values) {
                    comparados.add(c.values);
                    culpables.add(cp.campo.id);
                }
            }
        }
        const soloEtiqueta = [...labels.entries()].filter(([l, v]) => comparados.has(l) && !comparados.has(v));
        if (soloEtiqueta.length) {
            out.push({
                regla: 'R10',
                severidad: 'error',
                titulo: 'Condición comparada solo por etiqueta',
                detalle: `\`${etiqueta(origen.campo)}\` se prellena del payload, así que llega el jsonValue, no la etiqueta. Se compara ${soloEtiqueta
                    .map(([l, v]) => `"${l}" pero no "${v}"`)
                    .join(', ')}. Síntoma: la sección se abre vacía y el PDF sale en blanco ahí, sin ningún error.`,
                campoIds: [origen.campo.id, ...culpables].slice(0, 12),
                ref: '§P18',
            });
        }
    }
    return out;
};
// --- R11 · helper oculto con defaultValue fijo (§P14) -----------------------
const rFantasma = (m) => m.campos
    .filter((cp) => {
    const c = cp.campo;
    if (!c.hidden || c.autoFillConcat)
        return false;
    if (c.defaultValue == null || c.defaultValue === '')
        return false;
    const ruta = c.jsonOutputPath ?? c.salidaJSON ?? '';
    // Solo preocupa dentro de arrays de personas con índice > 0: [0] existe siempre.
    const mth = /personas\[(\d+)\]/.exec(ruta);
    return Boolean(mth) && Number(mth[1]) > 0;
})
    .map((cp) => ({
    regla: 'R11',
    severidad: 'aviso',
    titulo: 'Puede generar una persona fantasma',
    detalle: `\`${etiqueta(cp.campo)}\` está oculto con defaultValue fijo. Un campo oculto escribe siempre, aunque tenga conditionalVisibility: si esa persona no se cargó, va a salir una entrada suelta en el array. Se arregla sacando el defaultValue y condicionando por autoFillConcat contra el nombre.`,
    campoIds: [cp.campo.id],
    ruta: cp.campo.jsonOutputPath ?? undefined,
    ref: '§P14',
}));
// --- R12 · dos campos escribiendo la misma ruta -----------------------------
/**
 * Un grupo de radios compartiendo ruta es el patrón correcto, no un conflicto:
 * Colones y Dólares escriben los dos `codigoMoneda` y solo aporta el marcado.
 * Se reconoce porque cada uno lleva su propio `jsonValue` distinto.
 */
function esGrupoDeOpciones(escriben) {
    const valores = new Set();
    for (const { campo } of escriben) {
        if (campo.type !== 'radio' && campo.type !== 'checkbox')
            return false;
        if (!campo.jsonValue)
            return false;
        valores.add(campo.jsonValue);
    }
    return valores.size === escriben.length;
}
const rRutaCompartida = (m) => [...m.porRuta.values()]
    .filter((h) => h.escriben.length > 1 && !esGrupoDeOpciones(h.escriben))
    .map((h) => ({
    regla: 'R12',
    severidad: 'aviso',
    titulo: 'Dos campos escriben la misma ruta',
    detalle: `${h.escriben.map((cp) => `\`${etiqueta(cp.campo)}\``).join(' y ')} escriben \`${h.ruta}\`. El último gana; si es a propósito (un select visible y su casilla oculta), el que no manda debería ir con excludeFromJson.`,
    campoIds: h.escriben.map((cp) => cp.campo.id),
    ruta: h.ruta,
}));
// --- R13 · campo del PDF que no pinta nada ---------------------------------
const rNoPinta = (m) => m.campos
    .filter((cp) => {
    const c = cp.campo;
    if (!c.sourceMeta?.sourceName)
        return false;
    if (c.type === 'signature')
        return false;
    return !c.autoFillConcat && !c.prefillKey && !c.jsonOutputPath && c.hidden === true;
})
    .map((cp) => ({
    regla: 'R13',
    severidad: 'nota',
    titulo: 'Casillero del PDF que queda vacío',
    detalle: `\`${etiqueta(cp.campo)}\` está oculto y no recibe valor de ningún lado, así que su casillero sale en blanco. Es correcto si el campo no está en la ficha o es de uso interno del INS.`,
    campoIds: [cp.campo.id],
}));
// --- R14 · prefillMode api --------------------------------------------------
const rPrefillApi = (m) => m.campos
    .filter((cp) => cp.campo.prefillMode === 'api')
    .map((cp) => ({
    regla: 'R14',
    severidad: 'aviso',
    titulo: 'prefillMode "api"',
    detalle: `\`${etiqueta(cp.campo)}\` usa prefillMode "api". La convención es "optional" siempre; "api" suele ser resto de una versión vieja.`,
    campoIds: [cp.campo.id],
}));
// --- R15 · labels sin tildes ------------------------------------------------
const rTildes = (m) => {
    const out = [];
    for (const cp of m.campos) {
        // Solo lo que el usuario llega a leer. Los slots ocultos del PDF llevan un
        // label autogenerado ("Tom Tipo Id Cedula") que no se muestra en ningún
        // lado: marcarlos sería ruido que tapa las tildes que sí importan.
        if (cp.ocultoEfectivo || cp.campo.hidden)
            continue;
        const lbl = cp.campo.label;
        if (!lbl)
            continue;
        const fix = corregirTildes(lbl);
        if (fix) {
            out.push({
                regla: 'R15',
                severidad: 'nota',
                titulo: 'Label sin tildes',
                detalle: `"${lbl}" → "${fix}". Corregir también las opciones y las condiciones que comparan ese texto, todo junto.`,
                campoIds: [cp.campo.id],
            });
        }
    }
    return out;
};
// --- R16 · descripcionX sin fórmula (§P11) ---------------------------------
const rDescripcionVacia = (m) => m.campos
    .filter((cp) => {
    const ruta = cp.campo.jsonOutputPath ?? cp.campo.salidaJSON ?? '';
    if (!/\.descripcion[A-Z]/.test(ruta))
        return false;
    return !cp.campo.autoFillConcat && !cp.campo.prefillKey && cp.campo.defaultValue == null;
})
    .map((cp) => ({
    regla: 'R16',
    severidad: 'aviso',
    titulo: 'Descripción que nunca se llena',
    detalle: `\`${etiqueta(cp.campo)}\` escribe una ruta de descripción pero no tiene de dónde sacar el valor. Va con autoFillConcat sobre su select, con valueSource "visible".`,
    campoIds: [cp.campo.id],
    ruta: cp.campo.jsonOutputPath ?? undefined,
    ref: '§P11',
}));
// --- R17 · edad sin cálculo (§P16) -----------------------------------------
const rEdad = (m) => m.campos
    .filter((cp) => {
    const ruta = cp.campo.jsonOutputPath ?? '';
    return /\.edad$/.test(ruta) && !cp.campo.autoFillConcat;
})
    .map((cp) => ({
    regla: 'R17',
    severidad: 'aviso',
    titulo: 'Edad sin calcular',
    detalle: `\`${etiqueta(cp.campo)}\` es de solo lectura pero no tiene la fórmula, así que queda siempre vacío. Va con autoFillConcat: dateRef "today" + el campo de fecha de nacimiento, con op "diffYears".`,
    campoIds: [cp.campo.id],
    ref: '§P16',
}));
// --- R18 · cascada apuntando a otra persona (§P17) --------------------------
const rCascada = (m) => {
    const out = [];
    const prefijo = (id) => id.replace(/^field_/, '').split('_')[0];
    for (const cp of m.campos) {
        for (const clave of ['parentFieldId', 'grandParentFieldId']) {
            const padre = cp.campo[clave];
            if (!padre)
                continue;
            if (prefijo(cp.campo.id) !== prefijo(padre)) {
                out.push({
                    regla: 'R18',
                    severidad: 'aviso',
                    titulo: 'Cascada apuntando a otra persona',
                    detalle: `\`${etiqueta(cp.campo)}\` filtra contra \`${padre}\`, que parece de otro bloque. Cantón y distrito tienen que colgar de la provincia de la MISMA persona o el filtro no corresponde.`,
                    campoIds: [cp.campo.id, padre],
                    ref: '§P17',
                });
            }
        }
    }
    return out;
};
// --- R19 · substring de fecha en formato ISO (§M9) -------------------------
const rFechaIso = (m) => {
    const out = [];
    for (const cp of m.campos) {
        const id = cp.campo.id.toLowerCase();
        const esDia = /_dia$/.test(id);
        const esMes = /_mes$/.test(id);
        if (!esDia && !esMes)
            continue;
        for (const p of cp.campo.autoFillConcat?.parts ?? []) {
            for (const t of p.transforms ?? []) {
                if (t.kind !== 'substring')
                    continue;
                const malDia = esDia && t.start === 8;
                const malMes = esMes && t.start === 5;
                if (malDia || malMes) {
                    out.push({
                        regla: 'R19',
                        severidad: 'error',
                        titulo: 'Fecha cortada en formato ISO',
                        detalle: `\`${etiqueta(cp.campo)}\` corta desde ${t.start}, que es la posición en AAAA-MM-DD. Sobre una fecha DD/MM/AAAA el día va 0-2, el mes 3-5 y el año 6-10: así como está, el PDF sale con el día y el mes cambiados.`,
                        campoIds: [cp.campo.id],
                        ref: '§M9',
                    });
                }
            }
        }
    }
    return out;
};
// --- R20 · nombre completo editable ----------------------------------------
const rNombreCompleto = (m) => m.campos
    .filter((cp) => {
    const ruta = cp.campo.jsonOutputPath ?? '';
    if (!/\.nombreCompleto$/.test(ruta))
        return false;
    return Boolean(cp.campo.autoFillConcat) && (!cp.campo.readOnly || Boolean(cp.campo.prefillKey));
})
    .map((cp) => ({
    regla: 'R20',
    severidad: 'aviso',
    titulo: 'Nombre completo desbloqueado',
    detalle: `\`${etiqueta(cp.campo)}\` se arma por concatenación pero sigue editable o prellenado. Para que quede bloqueado va readOnly true, sin prefillKey y sin prefillMode. Excepción: si esa persona no tiene los 4 nombres en la ficha (el Tomador), queda editable a propósito.`,
    campoIds: [cp.campo.id],
}));
// --- R21 · radioGroupFields roto -------------------------------------------
const rRadioGroup = (m) => {
    const out = [];
    for (const cp of m.campos) {
        for (const ref of cp.campo.radioGroupFields ?? []) {
            if (!m.porId.has(ref)) {
                out.push({
                    regla: 'R21',
                    severidad: 'error',
                    titulo: 'Grupo de radios roto',
                    detalle: `\`${etiqueta(cp.campo)}\` agrupa con \`${ref}\`, que no existe. El grupo no se forma y los radios se ven como texto suelto, sin casillas.`,
                    campoIds: [cp.campo.id],
                });
            }
        }
    }
    return out;
};
// --- R22 · falta la firma ---------------------------------------------------
const rFirma = (m) => {
    const hay = m.campos.some((cp) => cp.campo.type === 'signature');
    if (hay)
        return [];
    return [
        {
            regla: 'R22',
            severidad: 'aviso',
            titulo: 'No hay campo de firma',
            detalle: 'El form-def no tiene ningún campo type "signature". Va en la sección Firmas, oculto, con el correo y el nombre del firmante precargados del encabezado y copia al intermediario.',
            campoIds: [],
            ref: '§P20',
        },
    ];
};
// --- R23 · orden de secciones ----------------------------------------------
const rOrdenSecciones = (m) => {
    const titulos = m.secciones.map((s) => s.title ?? s.id);
    const decl = titulos.findIndex((t) => /declaracion/i.test(t));
    if (decl >= 0 && decl !== titulos.length - 1) {
        return [
            {
                regla: 'R23',
                severidad: 'nota',
                titulo: 'Declaraciones no está al final',
                detalle: `"${titulos[decl]}" está en la posición ${decl + 1} de ${titulos.length}. La convención las pone al final aunque la ficha las liste dentro de Datos Generales: el usuario acepta después de revisar todo. Orden canónico: ${ORDEN_SECCIONES.join(' · ')}.`,
                campoIds: [],
            },
        ];
    }
    return [];
};
// --- R24 · grupo de codigoTipo incompleto (§P18 + §P8) ---------------------
const rGrupoPersona = (m) => {
    const out = [];
    const todos = Object.values(GRUPOS_PERSONA).flat();
    // Los códigos se normalizan por alias antes de comparar: JRD y PJR son el
    // mismo concepto y cubrir uno ya cubre el otro.
    // La condición por tipo de persona casi siempre vive en la SECCIÓN, no en el
    // campo: el bloque entero del Tomador se muestra o no. Mirar solo los campos
    // dejaba afuera justo el caso que la regla existe para atrapar.
    const revisarCondicion = (raw, donde, campoId) => {
        const cond = parseCondicion(raw);
        if (!cond?.conditions?.length || cond.logic !== 'or')
            return;
        const codigos = cond.conditions
            .map((c) => c.value)
            .filter((v) => Boolean(v))
            .map(normalizarCodigoPersona)
            .filter((v) => todos.includes(v));
        if (!codigos.length)
            return;
        for (const [nombre, grupo] of Object.entries(GRUPOS_PERSONA)) {
            const presentes = grupo.filter((g) => codigos.includes(g));
            if (!presentes.length || presentes.length === grupo.length)
                continue;
            const faltan = grupo.filter((g) => !codigos.includes(g));
            out.push({
                regla: 'R24',
                severidad: 'aviso',
                titulo: 'Grupo de tipo de persona incompleto',
                detalle: `"${donde}" se muestra para ${presentes.join(', ')} pero no para ${faltan.join(', ')}, que son del mismo grupo (${nombre}). Si el request trae uno de los que faltan, el bloque no aparece y el PDF sale en blanco ahí.`,
                campoIds: campoId ? [campoId] : [],
                ref: '§P18',
            });
        }
    };
    const recorrer = (sec) => {
        revisarCondicion(sec.conditionalVisibility, sec.title ?? sec.id, null);
        for (const f of sec.fields ?? [])
            revisarCondicion(f.conditionalVisibility, f.label ?? f.id, f.id);
        for (const s of sec.subsections ?? [])
            recorrer(s);
    };
    for (const sec of m.secciones)
        recorrer(sec);
    return out;
};
// --- R25 · sourceName del PDF sin usar --------------------------------------
const rPdfSinUsar = (m) => {
    if (!m.sourceNamesPdf.length)
        return [];
    return [
        {
            regla: 'R25',
            severidad: 'nota',
            titulo: `${m.sourceNamesPdf.length} campos del PDF sin usar`,
            detalle: `El PDF trae casilleros que ningún campo del form-def escribe: ${m.sourceNamesPdf.slice(0, 8).join(', ')}${m.sourceNamesPdf.length > 8 ? '…' : ''}. Van a salir en blanco.`,
            campoIds: [],
        },
    ];
};
// --- R26 · término acordado (Sexo, no Género) ------------------------------
const rTerminos = (m) => {
    const out = [];
    for (const cp of m.campos) {
        if (cp.ocultoEfectivo || cp.campo.hidden)
            continue;
        for (const texto of [cp.campo.label, cp.campo.radioGroupLabel]) {
            if (!texto)
                continue;
            const fix = corregirTerminos(texto);
            if (!fix)
                continue;
            out.push({
                regla: 'R26',
                severidad: 'nota',
                titulo: 'Término distinto al acordado',
                detalle: `"${texto}" → "${fix}". Es una decisión de vocabulario, no una tilde. Solo cambia lo visible: las rutas \`codigoGenero\` y \`descripcionGenero\` las define el INS y no se tocan.`,
                campoIds: [cp.campo.id],
            });
        }
    }
    return out;
};
const REGLAS = [
    rIdSourceName,
    rIdsDuplicados,
    rCondicionRota,
    rSalidaDesalineada,
    rRepeaters,
    rSourceFieldIds,
    rCasillaX,
    rDosFormas,
    rFantasma,
    rRutaCompartida,
    rNoPinta,
    rPrefillApi,
    rTildes,
    rTerminos,
    rDescripcionVacia,
    rEdad,
    rCascada,
    rFechaIso,
    rNombreCompleto,
    rRadioGroup,
    rFirma,
    rOrdenSecciones,
    rGrupoPersona,
    rPdfSinUsar,
];
const PESO = { error: 0, aviso: 1, nota: 2 };
function revisar(m) {
    const out = [];
    for (const regla of REGLAS) {
        try {
            out.push(...regla(m));
        }
        catch {
            // Una regla que explota no puede tumbar el diagnóstico entero: el resto
            // sigue valiendo y el usuario necesita ver algo, no una pantalla vacía.
        }
    }
    return out.sort((a, b) => PESO[a.severidad] - PESO[b.severidad] || a.regla.localeCompare(b.regla));
}
/** Cobertura contra el JSON de ejemplo del cliente: qué rutas del contrato no escribe nadie. */
function cobertura(m, ejemplo) {
    const rutas = new Set();
    const recorrer = (nodo, prefijo) => {
        if (Array.isArray(nodo)) {
            // El índice del ejemplo no importa: lo que se compara es la forma.
            nodo.forEach((x) => recorrer(x, `${prefijo}[]`));
        }
        else if (nodo && typeof nodo === 'object') {
            for (const [k, v] of Object.entries(nodo))
                recorrer(v, prefijo ? `${prefijo}.${k}` : k);
        }
        else if (prefijo) {
            rutas.add(prefijo);
        }
    };
    recorrer(ejemplo, '');
    const nuestras = new Set([...m.porRuta.keys()].map((r) => r.replace(/\[\d+\]/g, '[]')));
    const faltan = [...rutas].filter((r) => !nuestras.has(r)).sort();
    return { total: rutas.size, cubiertas: rutas.size - faltan.length, faltan };
}

module.exports = { revisar, cobertura };
