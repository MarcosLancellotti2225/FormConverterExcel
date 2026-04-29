/**
 * @file prefill-mode-rules.js
 * @version 1.1.0
 * @description Rules for determining prefillMode (mandatory vs optional) per field.
 * @changelog
 *   - v1.1.0: Initial — rules by path prefix and sourceName pattern
 */
'use strict';

const MANDATORY_PATH_PREFIXES = [
    'encabezado.',
    'polizaMadre.',
    'intermediario.',
];

const MANDATORY_ASEGURADO_FIELDS = new Set([
    'primer_apellido', 'segundo_apellido', 'nombre_completo',
    'numero_identificacion', 'fecha_nac_dia', 'fecha_nac_mes', 'fecha_nac_ano',
]);

const MANDATORY_ASEGURADO_GROUPS = new Set([
    'tipo_identificacion', 'sexo',
]);

const MANDATORY_PREFIXES = new Set([
    'vigencia_',
    'tomador_',
]);

const OPTIONAL_PREFIXES = new Set([
    'beneficiario_',
    'solicitud_',
    'monto_',
    'notificacion_',
]);

function determinePrefillMode(sourceName, pathPrincipal, grupo) {
    if (!pathPrincipal && !sourceName) return 'optional';

    const path = String(pathPrincipal || '').toLowerCase();
    for (const prefix of MANDATORY_PATH_PREFIXES) {
        if (path.startsWith(prefix)) return 'mandatory';
    }

    const sn = String(sourceName || '').toLowerCase();

    if (sn.startsWith('asegurado_')) {
        const suffix = sn.replace('asegurado_', '');
        if (MANDATORY_ASEGURADO_FIELDS.has(suffix)) return 'mandatory';

        const g = String(grupo || '').toLowerCase();
        if (MANDATORY_ASEGURADO_GROUPS.has(g)) return 'mandatory';

        if (suffix.startsWith('tipo_id_')) return 'mandatory';
        if (suffix.startsWith('sexo_')) return 'mandatory';
        if (suffix.startsWith('fecha_nac_')) return 'mandatory';

        return 'optional';
    }

    for (const prefix of MANDATORY_PREFIXES) {
        if (sn.startsWith(prefix)) return 'mandatory';
    }

    for (const prefix of OPTIONAL_PREFIXES) {
        if (sn.startsWith(prefix)) return 'optional';
    }

    if (sn.startsWith('poliza_')) return 'mandatory';

    return 'optional';
}

module.exports = { determinePrefillMode };
