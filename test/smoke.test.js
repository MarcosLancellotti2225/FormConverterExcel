#!/usr/bin/env node
/**
 * Smoke tests
 * - Unit tests for parsers and builder (no I/O required)
 * - End-to-end pipeline test (skipped gracefully if /inputs is empty)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        const p = fn();
        if (p && typeof p.then === 'function') {
            return p
                .then(() => { console.log(`  ✔ ${name}`); passed++; })
                .catch(err => { console.error(`  ✘ ${name}\n    ${err.message}`); failed++; });
        }
        console.log(`  ✔ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✘ ${name}\n    ${err.message}`);
        failed++;
    }
}

async function run() {
    console.log('\n── rule-parser ────────────────────────');
    const { _internal: rule } = require('../src/parsers/rule-parser');

    test('parseValidation: "16 caracteres" → maxLength 16', () => {
        const v = rule.parseValidation ? rule.parseValidation('16 caracteres', 'Texto') : null;
        assert.strictEqual(v.maxLength, 16);
    });

    test('parseValidation: date format', () => {
        const v = rule.parseValidation('Formato dd/mm/aaaa', 'Fecha');
        assert.ok(v.pattern && v.pattern.includes('\\d{2}'));
    });

    test('parseValidation: numeric', () => {
        const v = rule.parseValidation('Sólo números', 'Texto');
        assert.strictEqual(v.pattern, '^\\d+$');
    });

    test('normalize strips accents', () => {
        assert.strictEqual(rule.normalize('Código'), 'codigo');
    });

    console.log('\n── excel-parser internals ───────────────');
    const { _internal: xlsx, groupFieldsByFormCode } = require('../src/parsers/excel-parser');

    test('mapType: Combo → select', () => {
        assert.strictEqual(xlsx.mapType('Combo'), 'select');
    });

    test('mapType: Numérico → number', () => {
        assert.strictEqual(xlsx.mapType('Numérico'), 'number');
    });

    test('normalizeRequired: "Si" → true, "NO" → false', () => {
        assert.strictEqual(xlsx.normalizeRequired('Si'), true);
        assert.strictEqual(xlsx.normalizeRequired('NO'), false);
    });

    test('normalizeProductScope: comma-separated scopes', () => {
        const r = xlsx.normalizeProductScope('vida_universal, proteccion_crediticia');
        assert.deepStrictEqual(r, ['vida_universal', 'proteccion_crediticia']);
    });

    test('normalizeProductScope: "TODOS" → ["all"]', () => {
        assert.deepStrictEqual(xlsx.normalizeProductScope('TODOS'), ['all']);
    });

    console.log('\n── groupFieldsByFormCode ────────────────');

    test('groups fields by formCode and distributes shared fields', () => {
        const fields = [
            { formCode: '',       label: 'shared' },
            { formCode: '1009052', label: 'a' },
            { formCode: '1009052', label: 'b' },
            { formCode: 'D0306',   label: 'c' }
        ];
        const groups = groupFieldsByFormCode(fields);
        assert.strictEqual(groups.size, 2);
        assert.strictEqual(groups.get('1009052').length, 3); // shared + a + b
        assert.strictEqual(groups.get('D0306').length, 2);   // shared + c
    });

    test('returns _all group when no formCode column', () => {
        const fields = [
            { formCode: '', label: 'x' },
            { formCode: '', label: 'y' }
        ];
        const groups = groupFieldsByFormCode(fields);
        assert.ok(groups.has('_all'));
        assert.strictEqual(groups.get('_all').length, 2);
    });

    console.log('\n── json-builder shape ───────────────────');
    const { buildLovableJson, buildField } = require('../src/builders/json-builder');

    test('buildLovableJson emits the expected Lovable shape', () => {
        const json = buildLovableJson({
            sections: [],
            pdfId: '1009052',
            pdfBase64: null,
            pdfData: null,
            meta: { productName: 'Test' },
            catalogs: {}
        });
        assert.ok(json.data, 'data wrapper missing');
        const def = json.data.jsonDefinition;
        assert.ok(def, 'jsonDefinition missing');
        assert.deepStrictEqual(def.sections, []);
        assert.deepStrictEqual(def.validationRules, []);
        assert.deepStrictEqual(def.fieldPositions, []);
        assert.strictEqual(def.sourceType, 'pdf');
        assert.strictEqual(json.data.versionNumber, 1);
    });

    test('buildField emits field_ prefix, stringified conditionalVisibility, and rect object', () => {
        const f = buildField({
            id: 'primer_nombre',
            label: 'Primer Nombre',
            type: 'text',
            required: true,
            readOnly: false,
            jsonName: 'PrimerNombre',
            conditionalVisibility: JSON.stringify({ dependsOn: 'tipo_persona', equals: 'Fisica' }),
            pdfCoords: { page: 0, rect: [10, 20, 100, 15] },
            sourceMeta: { sourceName: 'Cliente/PrimerNombre' }
        });
        assert.strictEqual(f.id, 'field_primer_nombre');
        assert.strictEqual(f.prefillMode, 'required');
        assert.strictEqual(f.prefillKey, 'PrimerNombre');
        const cond = JSON.parse(f.conditionalVisibility);
        assert.strictEqual(cond.logic, 'and');
        assert.strictEqual(cond.conditions[0].fieldId, 'field_tipo_persona');
        assert.strictEqual(cond.conditions[0].operator, 'equals');
        assert.strictEqual(cond.conditions[0].value, 'Fisica');
        assert.deepStrictEqual(f.sourceMeta.rect, { x: 10, y: 20, width: 100, height: 15 });
        assert.strictEqual(f.sourceMeta.kind, 'pdf');
        assert.strictEqual(f.sourceMeta.page, 1); // 1-indexed
    });

    console.log('\n── prefillkey-validator ─────────────────');
    const { loadClientPathsFromText, validateLovableJson } = require('../src/validators/prefillkey-validator');

    test('loadClientPathsFromText walks a nested JSON', () => {
        const raw = JSON.stringify({
            Cliente: {
                PrimerNombre: '',
                Telefonos: { Telefono: [{ Numero: '' }] }
            }
        });
        const paths = loadClientPathsFromText(raw);
        assert.ok(paths.has('Cliente.PrimerNombre'));
        assert.ok(paths.has('Cliente.Telefonos.Telefono[].Numero'));
    });

    test('validateLovableJson flags unknown prefillKey (flat shape)', () => {
        const clientPaths = new Set(['Cliente.PrimerNombre']);
        const lovable = {
            sections: [{
                fields: [
                    { id: 'a', label: 'A', prefillKey: 'Cliente.PrimerNombre' },
                    { id: 'b', label: 'B', prefillKey: 'Cliente.NoExiste' }
                ]
            }]
        };
        const issues = validateLovableJson(lovable, clientPaths);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].field, 'b');
    });

    test('validateLovableJson walks into data.jsonDefinition', () => {
        const clientPaths = new Set(['Cliente.PrimerNombre']);
        const lovable = {
            data: {
                jsonDefinition: {
                    sections: [{
                        fields: [
                            { id: 'b', label: 'B', prefillKey: 'Cliente.NoExiste' }
                        ]
                    }]
                }
            }
        };
        const issues = validateLovableJson(lovable, clientPaths);
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].field, 'b');
    });

    console.log('\n── section-detector ─────────────────────');
    const sectionDetector = require('../src/matrix-editor/section-detector');
    const sd = sectionDetector._internal;

    test('slugify: "Primer Apellido" → "primer_apellido"', () => {
        assert.strictEqual(sd.slugify('Primer Apellido'), 'primer_apellido');
    });

    test('slugify strips accents and punctuation', () => {
        assert.strictEqual(sd.slugify('N° de Identificación:'), 'n_de_identificacion');
    });

    test('looksLikeHeading: "DATOS DEL SOLICITANTE" is heading', () => {
        assert.ok(sd.looksLikeHeading('DATOS DEL SOLICITANTE'));
    });

    test('looksLikeHeading: "Primer Apellido" is NOT heading', () => {
        assert.ok(!sd.looksLikeHeading('Primer Apellido'));
    });

    test('matchSectionWhitelist: "DATOS DEL SOLICITANTE" → asegurado_', () => {
        const m = sd.matchSectionWhitelist('DATOS DEL SOLICITANTE');
        assert.ok(m);
        assert.strictEqual(m.prefix, 'asegurado_');
    });

    test('matchSectionWhitelist: "BENEFICIARIO 1" → beneficiario_, repeatable', () => {
        const m = sd.matchSectionWhitelist('BENEFICIARIO 1');
        assert.ok(m);
        assert.strictEqual(m.prefix, 'beneficiario_');
        assert.strictEqual(m.repeatable, true);
    });

    test('matchSubHeadingWhitelist: "Tipo de Identificación:" → tipo_id_', () => {
        const m = sd.matchSubHeadingWhitelist('Tipo de Identificación:');
        assert.ok(m);
        assert.strictEqual(m.prefix, 'tipo_id_');
        assert.strictEqual(m.group, 'tipo_identificacion');
    });

    test('matchSubHeadingWhitelist: "Sexo:" → sexo_', () => {
        const m = sd.matchSubHeadingWhitelist('Sexo:');
        assert.ok(m);
        assert.strictEqual(m.prefix, 'sexo_');
    });

    test('matchSubHeadingWhitelist: unknown returns null', () => {
        assert.strictEqual(sd.matchSubHeadingWhitelist('Otro Campo:'), null);
    });

    test('identifyDatePart: "Día"/"Mes"/"Año" → dia/mes/ano', () => {
        assert.strictEqual(sd.identifyDatePart('Día'), 'dia');
        assert.strictEqual(sd.identifyDatePart('Mes'), 'mes');
        assert.strictEqual(sd.identifyDatePart('Año'), 'ano');
        assert.strictEqual(sd.identifyDatePart('Año:'), 'ano');
    });

    test('identifyDatePart: non-date returns null', () => {
        assert.strictEqual(sd.identifyDatePart('Lugar'), null);
    });

    test('groupIntoTriplets: 3 same-row date fields → 1 triplet', () => {
        const cands = [
            { field: { rect: { x: 100, y: 500, width: 30, height: 12 } }, part: 'dia' },
            { field: { rect: { x: 140, y: 500, width: 30, height: 12 } }, part: 'mes' },
            { field: { rect: { x: 180, y: 500, width: 40, height: 12 } }, part: 'ano' },
        ];
        const trips = sd.groupIntoTriplets(cands);
        assert.strictEqual(trips.length, 1);
        assert.strictEqual(trips[0].length, 3);
    });

    test('groupIntoTriplets: two date triplets in different rows → 2 triplets', () => {
        const cands = [
            { field: { rect: { x: 100, y: 700, width: 30, height: 12 } }, part: 'dia' },
            { field: { rect: { x: 140, y: 700, width: 30, height: 12 } }, part: 'mes' },
            { field: { rect: { x: 180, y: 700, width: 40, height: 12 } }, part: 'ano' },
            { field: { rect: { x: 100, y: 500, width: 30, height: 12 } }, part: 'dia' },
            { field: { rect: { x: 140, y: 500, width: 30, height: 12 } }, part: 'mes' },
            { field: { rect: { x: 180, y: 500, width: 40, height: 12 } }, part: 'ano' },
        ];
        const trips = sd.groupIntoTriplets(cands);
        assert.strictEqual(trips.length, 2);
    });

    test('detectSections: assigns section by heading above field', () => {
        const textItems = [
            { str: 'DATOS DEL SOLICITANTE', x: 50, y: 700, width: 200, height: 14, page: 0 },
            { str: 'Sexo:', x: 50, y: 600, width: 30, height: 10, page: 0 },
        ];
        const fields = [
            { name: 'CheckMasc', type: 'checkbox', rect: { x: 100, y: 580, width: 10, height: 10 }, page: 0, detectedLabel: 'Masculino' },
            { name: 'CheckFem',  type: 'checkbox', rect: { x: 200, y: 580, width: 10, height: 10 }, page: 0, detectedLabel: 'Femenino' },
        ];
        const { headings, subHeadings } = sectionDetector.detectSections(textItems, fields);
        assert.strictEqual(headings.length, 1);
        assert.strictEqual(headings[0].prefix, 'asegurado_');
        assert.strictEqual(subHeadings.length, 1);
        assert.strictEqual(subHeadings[0].prefix, 'sexo_');

        const assignment = sectionDetector.assignSectionToField(fields[0], headings, subHeadings);
        assert.strictEqual(assignment.sectionPrefix, 'asegurado_');
        assert.strictEqual(assignment.subHeadingPrefix, 'sexo_');
        assert.strictEqual(assignment.group, 'sexo');
    });

    test('detectDateGroups: solicitud date triplet → fecha_ prefix', () => {
        const textItems = [
            { str: 'LUGAR Y FECHA DE SOLICITUD', x: 50, y: 700, width: 250, height: 14, page: 0 },
            { str: 'Día', x: 100, y: 580, width: 20, height: 10, page: 0 },
            { str: 'Mes', x: 140, y: 580, width: 20, height: 10, page: 0 },
            { str: 'Año', x: 180, y: 580, width: 20, height: 10, page: 0 },
        ];
        const fields = [
            { name: 'DiaSol', type: 'text', rect: { x: 100, y: 560, width: 30, height: 12 }, page: 0, detectedLabel: 'Día' },
            { name: 'MesSol', type: 'text', rect: { x: 140, y: 560, width: 30, height: 12 }, page: 0, detectedLabel: 'Mes' },
            { name: 'AnoSol', type: 'text', rect: { x: 180, y: 560, width: 40, height: 12 }, page: 0, detectedLabel: 'Año' },
        ];
        const { headings } = sectionDetector.detectSections(textItems, fields);
        const dateMap = sectionDetector.detectDateGroups(fields, headings, textItems);
        assert.strictEqual(dateMap.size, 3);
        assert.strictEqual(dateMap.get('DiaSol').subHeadingPrefix, 'fecha_');
        assert.strictEqual(dateMap.get('DiaSol').part, 'dia');
        assert.strictEqual(dateMap.get('AnoSol').part, 'ano');
    });

    test('detectDateGroups: nacimiento under Datos del Solicitante → fecha_nacimiento_', () => {
        const textItems = [
            { str: 'DATOS DEL SOLICITANTE', x: 50, y: 750, width: 200, height: 14, page: 0 },
            { str: 'Fecha de Nacimiento:', x: 50, y: 620, width: 120, height: 10, page: 0 },
            { str: 'Día', x: 100, y: 580, width: 20, height: 10, page: 0 },
            { str: 'Mes', x: 140, y: 580, width: 20, height: 10, page: 0 },
            { str: 'Año', x: 180, y: 580, width: 20, height: 10, page: 0 },
        ];
        const fields = [
            { name: 'DiaNac', type: 'text', rect: { x: 100, y: 560, width: 30, height: 12 }, page: 0, detectedLabel: 'Día' },
            { name: 'MesNac', type: 'text', rect: { x: 140, y: 560, width: 30, height: 12 }, page: 0, detectedLabel: 'Mes' },
            { name: 'AnoNac', type: 'text', rect: { x: 180, y: 560, width: 40, height: 12 }, page: 0, detectedLabel: 'Año' },
        ];
        const { headings } = sectionDetector.detectSections(textItems, fields);
        const dateMap = sectionDetector.detectDateGroups(fields, headings, textItems);
        assert.strictEqual(dateMap.size, 3);
        assert.strictEqual(dateMap.get('DiaNac').subHeadingPrefix, 'fecha_nacimiento_');
        assert.strictEqual(dateMap.get('DiaNac').groupKey, 'fecha_nacimiento');
    });

    console.log('\n── end-to-end pipeline ──────────────────');
    const inputsDir = path.join(ROOT, 'inputs');
    const hasMatrix = fs.existsSync(path.join(inputsDir, 'Matriz_Formularios_VidaColectiva_Secciones.xlsx'));

    if (!hasMatrix) {
        console.log('  ↳ skipped (missing matrix in /inputs)');
    } else {
        await test('full pipeline produces output JSON', async () => {
            const { runPipelineAll } = require('../src/pipeline');
            const matrixBuffer = fs.readFileSync(path.join(inputsDir, 'Matriz_Formularios_VidaColectiva_Secciones.xlsx'));
            const { results } = await runPipelineAll({
                matrixBuffer,
                catalogsBuffer: null,
                pdfMap: {},
                clientJsonText: null
            }, { embedPdf: false });

            assert.ok(results.length > 0, 'no results generated');
            for (const r of results) {
                assert.ok(r.json.data, 'data wrapper missing');
                assert.ok(r.json.data.jsonDefinition.sections, 'sections missing');
            }
        });
    }

    console.log(`\n── Summary ──────────────────────────────`);
    console.log(`  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('✗ Test runner crashed:', err);
    process.exit(1);
});
