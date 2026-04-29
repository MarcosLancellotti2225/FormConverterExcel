/**
 * @file json-enricher.test.js
 * @version 1.2.1
 */
'use strict';

const assert = require('assert');
const { buildEnrichedJson, _internal } = require('../lib/json-enricher');
const { readMappingExcel } = require('../lib/excel-reader');
const { determinePrefillMode } = require('../lib/prefill-mode-rules');
const { getDateOptions } = require('../lib/precharged-lists');
const { getHelpText } = require('../lib/help-texts');
const { resolveCatalog } = require('../lib/catalogos');
const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        const p = fn();
        if (p && typeof p.then === 'function') {
            return p
                .then(() => { console.log('  ✔ ' + name); passed++; })
                .catch(err => { console.error('  ✘ ' + name + '\n    ' + err.message); failed++; });
        }
        console.log('  ✔ ' + name);
        passed++;
    } catch (err) {
        console.error('  ✘ ' + name + '\n    ' + err.message);
        failed++;
    }
}

function mkRow(overrides) {
    return {
        rowNum: 1,
        seccionPdf: 'DATOS DEL SOLICITANTE',
        acroFormActual: 'Text3.0.0',
        acroFormPropuesto: 'asegurado_test',
        etiqueta: 'Test',
        sourceName: 'asegurado_test',
        tipo: 'Tx',
        grupo: '',
        pagina: 1,
        pathPrincipal: '',
        pathsSecundarios: '',
        preRellenado: false,
        obligatorio: true,
        maxLength: null,
        patron: '',
        formato: '',
        visibilidadCondicional: '',
        catalogoNombre: '',
        opcionesLovable: null,
        opcionesRaw: '',
        tipoDatoMatriz: '',
        reglaOriginal: '',
        hojaExcelCatalogo: '',
        ...overrides,
    };
}

async function run() {
    console.log('\n── json-enricher: basic shape ──');

    test('buildEnrichedJson returns sections array with Encabezado first', () => {
        const rows = [mkRow()];
        const { json, warnings, stats } = buildEnrichedJson(rows);
        assert.ok(Array.isArray(json.sections), 'should have sections array');
        assert.ok(json.sections.length >= 2, 'should have at least 2 sections (encabezado + 1)');
        assert.strictEqual(json.sections[0].id, 'section_encabezado');
        assert.strictEqual(json.sections[0].title, 'Encabezado (oculto)');
        assert.strictEqual(json.sections[0].fields.length, 10);
    });

    test('Encabezado fields are readOnly + mandatory', () => {
        const { json } = buildEnrichedJson([mkRow()]);
        const enc = json.sections[0];
        for (const f of enc.fields) {
            assert.strictEqual(f.readOnly, true, f.id + ' should be readOnly');
            assert.strictEqual(f.required, true, f.id + ' should be required');
            assert.strictEqual(f.prefillMode, 'mandatory', f.id + ' should be mandatory');
        }
    });

    test('Encabezado has never-visible conditional', () => {
        const { json } = buildEnrichedJson([mkRow()]);
        const enc = json.sections[0];
        assert.ok(enc.conditionalVisibility.includes('NEVER_EXISTS'));
    });

    console.log('\n── json-enricher: field types ──');

    test('text field from Tx tipo', () => {
        const { json } = buildEnrichedJson([mkRow({ tipo: 'Tx', formato: '' })]);
        const field = json.sections[1].fields[0];
        assert.strictEqual(field.type, 'text');
    });

    test('date field from formato "fecha"', () => {
        const { json } = buildEnrichedJson([mkRow({ formato: 'fecha' })]);
        const field = json.sections[1].fields[0];
        assert.strictEqual(field.type, 'date');
    });

    test('number field from formato "numérico"', () => {
        const { json } = buildEnrichedJson([mkRow({ formato: 'numérico' })]);
        const field = json.sections[1].fields[0];
        assert.strictEqual(field.type, 'number');
    });

    test('radio field from Btn + grupo', () => {
        const { json } = buildEnrichedJson([
            mkRow({ tipo: 'Btn', grupo: 'sexo', sourceName: 'asegurado_sexo_masculino', etiqueta: 'Masculino' }),
            mkRow({ tipo: 'Btn', grupo: 'sexo', sourceName: 'asegurado_sexo_femenino', etiqueta: 'Femenino' }),
        ]);
        const fields = json.sections[1].fields;
        assert.strictEqual(fields[0].type, 'radio');
        assert.strictEqual(fields[1].type, 'radio');
    });

    test('select field for day/month/year sourceNames', () => {
        const { json } = buildEnrichedJson([
            mkRow({ sourceName: 'solicitud_fecha_dia', etiqueta: 'Día' }),
        ]);
        const field = json.sections[1].fields[0];
        assert.strictEqual(field.type, 'select');
        assert.ok(field.options.length === 31, 'should have 31 days');
    });

    console.log('\n── json-enricher: radio groups ──');

    test('radio group fields have radioGroupFields cross-references', () => {
        const { json } = buildEnrichedJson([
            mkRow({ tipo: 'Btn', grupo: 'sexo', sourceName: 'asegurado_sexo_masculino', etiqueta: 'Masculino' }),
            mkRow({ tipo: 'Btn', grupo: 'sexo', sourceName: 'asegurado_sexo_femenino', etiqueta: 'Femenino' }),
        ]);
        const fields = json.sections[1].fields;
        assert.ok(Array.isArray(fields[0].radioGroupFields));
        assert.strictEqual(fields[0].radioGroupFields.length, 1);
        assert.strictEqual(fields[0].radioGroupFields[0], 'field_asegurado_sexo_femenino');
        assert.strictEqual(fields[1].radioGroupFields[0], 'field_asegurado_sexo_masculino');
    });

    console.log('\n── json-enricher: beneficiary cascade ──');

    test('Beneficiario 2 section has conditional visibility', () => {
        const { json } = buildEnrichedJson([
            mkRow({ seccionPdf: 'BENEFICIARIO 1', sourceName: 'beneficiario_1_nombre' }),
            mkRow({ seccionPdf: 'BENEFICIARIO 2', sourceName: 'beneficiario_2_nombre' }),
        ]);
        const bene2 = json.sections.find(s => s.id === 'section_beneficiario_2');
        assert.ok(bene2, 'should have beneficiario 2 section');
        assert.ok(bene2.conditionalVisibility, 'should have conditional visibility');
        const cv = JSON.parse(bene2.conditionalVisibility);
        assert.strictEqual(cv.conditions[0].fieldId, 'field_beneficiario_1_nombre');
        assert.strictEqual(cv.conditions[0].operator, 'not_empty');
    });

    test('Beneficiario 1 section has NO conditional visibility', () => {
        const { json } = buildEnrichedJson([
            mkRow({ seccionPdf: 'BENEFICIARIO 1', sourceName: 'beneficiario_1_nombre' }),
        ]);
        const bene1 = json.sections.find(s => s.id === 'section_beneficiario_1');
        assert.ok(bene1);
        assert.strictEqual(bene1.conditionalVisibility, null);
    });

    console.log('\n── json-enricher: beneficiario_N_numero defaults ──');

    test('beneficiario_N_numero gets defaultValue=N and readOnly=true', () => {
        const { json } = buildEnrichedJson([
            mkRow({ seccionPdf: 'BENEFICIARIO 1', sourceName: 'beneficiario_1_numero' }),
            mkRow({ seccionPdf: 'BENEFICIARIO 2', sourceName: 'beneficiario_2_numero' }),
        ]);
        const b1 = json.sections.find(s => s.title === 'BENEFICIARIO 1');
        const b2 = json.sections.find(s => s.title === 'BENEFICIARIO 2');
        assert.strictEqual(b1.fields[0].defaultValue, 1);
        assert.strictEqual(b1.fields[0].readOnly, true);
        assert.strictEqual(b2.fields[0].defaultValue, 2);
        assert.strictEqual(b2.fields[0].readOnly, true);
    });

    console.log('\n── prefill-mode-rules ──');

    test('asegurado basic data is mandatory', () => {
        assert.strictEqual(determinePrefillMode('asegurado_primer_apellido', '', ''), 'mandatory');
        assert.strictEqual(determinePrefillMode('asegurado_nombre_completo', '', ''), 'mandatory');
        assert.strictEqual(determinePrefillMode('asegurado_numero_identificacion', '', ''), 'mandatory');
    });

    test('asegurado contact data is optional', () => {
        assert.strictEqual(determinePrefillMode('asegurado_correo', '', ''), 'optional');
        assert.strictEqual(determinePrefillMode('asegurado_telefono_movil', '', ''), 'optional');
        assert.strictEqual(determinePrefillMode('asegurado_direccion_exacta', '', ''), 'optional');
    });

    test('vigencia fields are mandatory', () => {
        assert.strictEqual(determinePrefillMode('vigencia_desde', '', ''), 'mandatory');
        assert.strictEqual(determinePrefillMode('vigencia_hasta', '', ''), 'mandatory');
    });

    test('beneficiario fields are optional', () => {
        assert.strictEqual(determinePrefillMode('beneficiario_1_nombre', '', ''), 'optional');
    });

    test('encabezado paths are mandatory', () => {
        assert.strictEqual(determinePrefillMode('', 'encabezado.codigoProducto', ''), 'mandatory');
    });

    console.log('\n── precharged-lists ──');

    test('getDateOptions returns DIAS for _dia suffix', () => {
        const opts = getDateOptions('solicitud_fecha_dia');
        assert.ok(opts);
        assert.strictEqual(opts.length, 31);
        assert.strictEqual(opts[0].value, '1');
    });

    test('getDateOptions returns MESES for _mes suffix', () => {
        const opts = getDateOptions('solicitud_fecha_mes');
        assert.ok(opts);
        assert.strictEqual(opts.length, 12);
        assert.strictEqual(opts[0].label, 'Enero');
    });

    test('getDateOptions returns null for non-date', () => {
        assert.strictEqual(getDateOptions('asegurado_nombre'), null);
    });

    console.log('\n── help-texts ──');

    test('getHelpText returns text for known fields', () => {
        assert.ok(getHelpText('solicitud_lugar'));
        assert.ok(getHelpText('asegurado_primer_apellido'));
        assert.ok(getHelpText('beneficiario_1_nombre'));
    });

    test('getHelpText returns null for unknown fields', () => {
        assert.strictEqual(getHelpText('xyz_unknown'), null);
    });

    console.log('\n── catalogos ──');

    test('resolveCatalog finds tipo identificacion', () => {
        const cat = resolveCatalog('Tipo Identificación', '');
        assert.ok(cat);
        assert.ok(cat.length >= 7);
        assert.strictEqual(cat[0].value, '0');
    });

    test('resolveCatalog finds by grupo', () => {
        const cat = resolveCatalog('', 'sexo');
        assert.ok(cat);
        assert.strictEqual(cat.length, 2);
    });

    test('resolveCatalog returns null for unknown', () => {
        assert.strictEqual(resolveCatalog('Desconocido', ''), null);
    });

    console.log('\n── json-enricher: solicitud_lugar has no pattern ──');

    test('solicitud_lugar field should not have validationPattern', () => {
        const { json } = buildEnrichedJson([
            mkRow({ sourceName: 'solicitud_lugar', patron: '^[A-Z].*', etiqueta: 'Lugar' }),
        ]);
        const field = json.sections[1].fields[0];
        assert.strictEqual(field.validationPattern, undefined, 'solicitud_lugar should not have pattern');
    });

    console.log('\n── json-enricher: with real 1009052 Excel ──');

    const excelPath = path.join(__dirname, '..', '..', '..', 'PDF_1009052_Mapeo_Completo_v2 (1).xlsx');
    if (fs.existsSync(excelPath)) {
        test('1009052 Excel produces correct section count', () => {
            const bytes = fs.readFileSync(excelPath);
            const { rows } = readMappingExcel(new Uint8Array(bytes));
            const { json, stats } = buildEnrichedJson(rows);

            assert.ok(json.sections.length >= 10, 'should have at least 10 sections, got ' + json.sections.length);
            assert.strictEqual(json.sections[0].id, 'section_encabezado');

            const fieldCount = json.sections.reduce((sum, s) => sum + s.fields.length, 0);
            assert.ok(fieldCount >= 60, 'should have 60+ fields (52 Excel + 10 encabezado), got ' + fieldCount);
        });

        test('1009052 has beneficiary cascade', () => {
            const bytes = fs.readFileSync(excelPath);
            const { rows } = readMappingExcel(new Uint8Array(bytes));
            const { json } = buildEnrichedJson(rows);

            const bene2 = json.sections.find(s => s.title && s.title.match(/BENEFICIARIO\s*2/i));
            assert.ok(bene2, 'should have Beneficiario 2 section');
            assert.ok(bene2.conditionalVisibility, 'Beneficiario 2 should have conditional');
            const cv = JSON.parse(bene2.conditionalVisibility);
            assert.strictEqual(cv.conditions[0].fieldId, 'field_beneficiario_1_nombre');
        });

        test('1009052 has radio groups for sexo and tipo_id', () => {
            const bytes = fs.readFileSync(excelPath);
            const { rows } = readMappingExcel(new Uint8Array(bytes));
            const { json } = buildEnrichedJson(rows);

            const allFields = json.sections.flatMap(s => s.fields);
            const radioFields = allFields.filter(f => f.radioGroupFields && f.radioGroupFields.length > 0);
            assert.ok(radioFields.length >= 4, 'should have at least 4 radio fields (sexo + tipo_id), got ' + radioFields.length);
        });

        test('1009052 date fields have pre-charged options', () => {
            const bytes = fs.readFileSync(excelPath);
            const { rows } = readMappingExcel(new Uint8Array(bytes));
            const { json } = buildEnrichedJson(rows);

            const allFields = json.sections.flatMap(s => s.fields);
            const dateSelects = allFields.filter(f =>
                f.sourceMeta && f.sourceMeta.sourceName &&
                (f.sourceMeta.sourceName.endsWith('_dia') || f.sourceMeta.sourceName.endsWith('_mes') || f.sourceMeta.sourceName.endsWith('_ano'))
            );
            assert.ok(dateSelects.length >= 6, 'should have 6+ date selects, got ' + dateSelects.length);
            for (const ds of dateSelects) {
                assert.ok(ds.options.length > 0, ds.id + ' should have options');
            }
        });
    } else {
        console.log('  ⊘ Skipping 1009052 integration tests (Excel not found at ' + excelPath + ')');
    }

    console.log('\n── Results: ' + passed + ' passed, ' + failed + ' failed ──\n');
    process.exit(failed > 0 ? 1 : 0);
}

run();
