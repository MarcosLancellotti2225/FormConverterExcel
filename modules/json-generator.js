/**
 * JSON Schema Generator Module
 * Generates JSON following the Cliente API structure from field definitions
 *
 * Target structure matches the INS Cliente API response/request format:
 * { Cliente: { ..., Direcciones: { Direccion: [...] }, Telefonos: { Telefono: [...] }, ... } }
 */
const JsonGenerator = (() => {
    'use strict';

    /**
     * The canonical Cliente JSON template with all expected fields
     * Values are empty/default — they get populated from form field mappings
     */
    const CLIENTE_TEMPLATE = {
        Cliente: {
            CodigoSistema: "",
            CodigoIdentificacion: "",
            Identificacion: "",
            CodigoTransaccion: "",
            CodigoMensaje: "",
            DescripcionMensaje: "",
            PrimerApellido: "",
            SegundoApellido: "",
            PrimerNombre: "",
            SegundoNombre: "",
            NombreCompleto: "",
            FechaNacimiento: "",
            NombreJuridicoAbrev: "",
            IndicadorDeceso: "",
            FechaDeceso: "",
            CodigoSexo: "",
            CodigoEstadoCivil: "",
            CanSalario: 0,
            CodigoEscolaridad: "",
            CodigoCategCliente: "",
            IndicadorPendVerif: 0,
            IndicadorFechaNacIncorr: 0,
            IndicadorFechaDefunIncorr: 0,
            ConsecutivoCliente: "",
            Direcciones: {
                Direccion: [{
                    ConsecutivoDireccion: 0,
                    TipoDireccion: 0,
                    CodigoPaisAlfa3: "",
                    CodigoPaisAlfa2: "",
                    CodigoPaisNumero: 0,
                    CodigoEstado: 0,
                    CodigoCiudad: 0,
                    CodigoProvincia: 0,
                    CodigoCanton: 0,
                    CodigoDistrito: 0,
                    DireccionCompleta: "",
                    DireccionAbreviada: ""
                }]
            },
            Telefonos: {
                Telefono: [{
                    ConsecutivoTelefono: 0,
                    TipoTelefono: 0,
                    CodigoArea: 0,
                    Numero: ""
                }]
            },
            Ocupaciones: {
                Ocupacion: [{
                    CodigoOcupacion: 0,
                    DescripcionOcupacion: "",
                    DescripcionOcupacionAbrev: "",
                    CodigoOcupacionBUC: 0
                }]
            },
            Actividades: {
                Actividad: [{
                    CodigoActividadEmp: "",
                    DescripcionActividadEmp: "",
                    CodigoActividadPart: "",
                    DescripcionActividadPart: ""
                }]
            },
            Referencias: {
                Referencia: [{
                    CodigoRelacion: "",
                    IdentificacionRef: 0,
                    CodigoIdentificacionRef: 0,
                    PrimerApellidoRef: "",
                    SegundoApellidoRef: "",
                    PrimerNombreRef: "",
                    SegundoNombreRef: "",
                    NombreCompletoRef: ""
                }]
            },
            Cuentas: {
                Cuenta: [{
                    CodigoCuenta: "",
                    CodigoMoneda: ""
                }]
            },
            Nacionalidades: {
                Nacionalidad: [{
                    CodigoPaisAlfa3: "",
                    CodigoPaisAlfa2: "",
                    CodigoPaisNumero: 0,
                    DescripcionPais: ""
                }]
            }
        }
    };

    /**
     * Known JSON path aliases — maps common field names/jsonPaths to
     * the canonical path inside the Cliente structure
     */
    const PATH_ALIASES = {
        // Direct Cliente fields
        'identificacion':           'Cliente.Identificacion',
        'cedula':                   'Cliente.Identificacion',
        'codigo_identificacion':    'Cliente.CodigoIdentificacion',
        'tipo_identificacion':      'Cliente.CodigoIdentificacion',
        'primer_apellido':          'Cliente.PrimerApellido',
        'segundo_apellido':         'Cliente.SegundoApellido',
        'primer_nombre':            'Cliente.PrimerNombre',
        'segundo_nombre':           'Cliente.SegundoNombre',
        'nombre_completo':          'Cliente.NombreCompleto',
        'fecha_nacimiento':         'Cliente.FechaNacimiento',
        'sexo':                     'Cliente.CodigoSexo',
        'codigo_sexo':              'Cliente.CodigoSexo',
        'estado_civil':             'Cliente.CodigoEstadoCivil',
        'codigo_estado_civil':      'Cliente.CodigoEstadoCivil',
        'salario':                  'Cliente.CanSalario',
        'escolaridad':              'Cliente.CodigoEscolaridad',
        'consecutivo_cliente':      'Cliente.ConsecutivoCliente',

        // Direccion
        'provincia':                'Cliente.Direcciones.Direccion[].CodigoProvincia',
        'codigo_provincia':         'Cliente.Direcciones.Direccion[].CodigoProvincia',
        'canton':                   'Cliente.Direcciones.Direccion[].CodigoCanton',
        'codigo_canton':            'Cliente.Direcciones.Direccion[].CodigoCanton',
        'distrito':                 'Cliente.Direcciones.Direccion[].CodigoDistrito',
        'codigo_distrito':          'Cliente.Direcciones.Direccion[].CodigoDistrito',
        'direccion':                'Cliente.Direcciones.Direccion[].DireccionCompleta',
        'direccion_completa':       'Cliente.Direcciones.Direccion[].DireccionCompleta',
        'pais':                     'Cliente.Direcciones.Direccion[].CodigoPaisAlfa3',
        'codigo_pais':              'Cliente.Direcciones.Direccion[].CodigoPaisAlfa3',

        // Telefono
        'telefono':                 'Cliente.Telefonos.Telefono[].Numero',
        'numero_telefono':          'Cliente.Telefonos.Telefono[].Numero',
        'codigo_area':              'Cliente.Telefonos.Telefono[].CodigoArea',
        'tipo_telefono':            'Cliente.Telefonos.Telefono[].TipoTelefono',

        // Ocupacion
        'ocupacion':                'Cliente.Ocupaciones.Ocupacion[].CodigoOcupacion',
        'codigo_ocupacion':         'Cliente.Ocupaciones.Ocupacion[].CodigoOcupacion',
        'descripcion_ocupacion':    'Cliente.Ocupaciones.Ocupacion[].DescripcionOcupacion',

        // Actividad
        'actividad':                'Cliente.Actividades.Actividad[].CodigoActividadEmp',
        'actividad_empresarial':    'Cliente.Actividades.Actividad[].CodigoActividadEmp',
        'actividad_particular':     'Cliente.Actividades.Actividad[].CodigoActividadPart',

        // Cuenta
        'cuenta':                   'Cliente.Cuentas.Cuenta[].CodigoCuenta',
        'numero_cuenta':            'Cliente.Cuentas.Cuenta[].CodigoCuenta',
        'moneda':                   'Cliente.Cuentas.Cuenta[].CodigoMoneda',

        // Nacionalidad
        'nacionalidad':             'Cliente.Nacionalidades.Nacionalidad[].CodigoPaisAlfa3',

        // Referencia
        'referencia':               'Cliente.Referencias.Referencia[].NombreCompletoRef',
        'relacion':                 'Cliente.Referencias.Referencia[].CodigoRelacion'
    };

    /**
     * Generate the complete Cliente JSON from form fields
     * Fields map to the structure via their jsonPath property
     */
    function generate(fields) {
        // Deep clone the template
        const json = JSON.parse(JSON.stringify(CLIENTE_TEMPLATE));

        // Map each field to its place in the JSON
        const mappings = [];

        for (const field of fields) {
            if (!field.visible) continue;

            const resolvedPath = resolveJsonPath(field);
            if (!resolvedPath) continue;

            // Build sample value based on type
            const sampleValue = buildSampleValue(field);

            // Set value at path
            setNestedValue(json, resolvedPath, sampleValue);

            mappings.push({
                fieldId: field.id,
                fieldName: field.fieldName,
                jsonPath: resolvedPath,
                value: sampleValue
            });
        }

        // Attach metadata as a comment-like property
        json._fieldMappings = mappings;

        return json;
    }

    /**
     * Resolve a field's jsonPath to a canonical path in the Cliente structure
     */
    function resolveJsonPath(field) {
        const jp = (field.jsonPath || '').trim();

        // If the field has an explicit jsonPath that looks like a dotted path, use it
        if (jp && jp.includes('.')) {
            // Normalize: ensure it starts with "Cliente."
            if (jp.startsWith('Cliente.')) return jp;
            if (jp.startsWith('cliente.')) return 'Cliente.' + jp.substring(8);
            return 'Cliente.' + jp;
        }

        // If jsonPath is a simple name, look it up in aliases
        if (jp) {
            const normalized = jp.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            if (PATH_ALIASES[normalized]) return PATH_ALIASES[normalized];
        }

        // Try matching by field name
        const fieldNorm = (field.fieldName || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        if (PATH_ALIASES[fieldNorm]) return PATH_ALIASES[fieldNorm];

        // No mapping found — place under Cliente as a custom field
        if (jp) return 'Cliente.' + jp;

        return null;
    }

    /**
     * Build a sample/default value for a field based on its type
     */
    function buildSampleValue(field) {
        switch (field.dataType) {
            case 'number':
                return 0;
            case 'date':
                return '';
            case 'select':
            case 'radio':
                return '';
            case 'checkbox':
                return false;
            default:
                return '';
        }
    }

    /**
     * Set a value at a dotted path in a nested object
     * Handles array notation: "Foo.Bar[].Baz" sets inside the first element of Bar array
     */
    function setNestedValue(obj, path, value) {
        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            let part = parts[i];
            const isArray = part.endsWith('[]');
            if (isArray) part = part.slice(0, -2);

            if (current[part] === undefined) {
                current[part] = isArray ? [{}] : {};
            }

            if (isArray) {
                if (!Array.isArray(current[part])) {
                    current[part] = [current[part]];
                }
                if (current[part].length === 0) current[part].push({});
                current = current[part][0];
            } else if (typeof current[part] === 'object' && !Array.isArray(current[part])) {
                current = current[part];
            } else {
                // It's an array wrapper like Direcciones: { Direccion: [...] }
                // Navigate into the first array element
                const keys = Object.keys(current[part]);
                const arrKey = keys.find(k => Array.isArray(current[part][k]));
                if (arrKey) {
                    if (current[part][arrKey].length === 0) current[part][arrKey].push({});
                    current = current[part][arrKey][0];
                } else {
                    current = current[part];
                }
            }
        }

        let lastPart = parts[parts.length - 1];
        const isLastArray = lastPart.endsWith('[]');
        if (isLastArray) lastPart = lastPart.slice(0, -2);

        current[lastPart] = value;
    }

    /**
     * Generate formatted JSON string
     */
    function generateString(fields) {
        const schema = generate(fields);
        // Remove internal metadata before output
        const output = JSON.parse(JSON.stringify(schema));
        delete output._fieldMappings;
        return JSON.stringify(output, null, 2);
    }

    /**
     * Get the template structure (for reference)
     */
    function getTemplate() {
        return JSON.parse(JSON.stringify(CLIENTE_TEMPLATE));
    }

    return { generate, generateString, getTemplate, PATH_ALIASES };
})();
