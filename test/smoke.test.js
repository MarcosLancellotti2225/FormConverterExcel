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

    console.log('\n── propose-name ─────────────────────────');
    const proposeNameMod = require('../src/matrix-editor/propose-name');

    test('proposeName: solicitud_lugar (no sub-heading, no date)', () => {
        const r = proposeNameMod.proposeName(
            { name: 'Text1', type: 'text', detectedLabel: 'Lugar' },
            { sectionPrefix: 'solicitud_', sectionName: 'Lugar y Fecha de Solicitud', subHeadingPrefix: '', group: null },
            null
        );
        assert.strictEqual(r.acroFormPropuesto, 'solicitud_lugar');
    });

    test('proposeName: asegurado_primer_apellido', () => {
        const r = proposeNameMod.proposeName(
            { name: 'Text2', type: 'text', detectedLabel: 'Primer Apellido' },
            { sectionPrefix: 'asegurado_', sectionName: 'Datos del Solicitante', subHeadingPrefix: '', group: null },
            null
        );
        assert.strictEqual(r.acroFormPropuesto, 'asegurado_primer_apellido');
    });

    test('proposeName: asegurado_tipo_id_cedula (radio sub-heading)', () => {
        const r = proposeNameMod.proposeName(
            { name: 'CheckBox1', type: 'checkbox', detectedLabel: 'Cédula' },
            { sectionPrefix: 'asegurado_', sectionName: 'Datos del Solicitante', subHeadingPrefix: 'tipo_id_', group: 'tipo_identificacion' },
            null
        );
        assert.strictEqual(r.acroFormPropuesto, 'asegurado_tipo_id_cedula');
        assert.strictEqual(r.group, 'tipo_identificacion');
    });

    test('proposeName: asegurado_sexo_masculino', () => {
        const r = proposeNameMod.proposeName(
            { name: 'CheckBox2', type: 'checkbox', detectedLabel: 'Masculino' },
            { sectionPrefix: 'asegurado_', sectionName: 'Datos del Solicitante', subHeadingPrefix: 'sexo_', group: 'sexo' },
            null
        );
        assert.strictEqual(r.acroFormPropuesto, 'asegurado_sexo_masculino');
    });

    test('proposeName: solicitud_fecha_dia (date group)', () => {
        const r = proposeNameMod.proposeName(
            { name: 'Text3', type: 'text', detectedLabel: 'Día' },
            { sectionPrefix: 'solicitud_', sectionName: 'Lugar y Fecha de Solicitud', subHeadingPrefix: '', group: null },
            { subHeadingPrefix: 'fecha_', part: 'dia', groupKey: 'fecha_solicitud' }
        );
        assert.strictEqual(r.acroFormPropuesto, 'solicitud_fecha_dia');
        assert.strictEqual(r.group, 'fecha_solicitud');
    });

    test('proposeName: asegurado_fecha_nacimiento_dia', () => {
        const r = proposeNameMod.proposeName(
            { name: 'Text4', type: 'text', detectedLabel: 'Día' },
            { sectionPrefix: 'asegurado_', sectionName: 'Datos del Solicitante', subHeadingPrefix: '', group: null },
            { subHeadingPrefix: 'fecha_nacimiento_', part: 'dia', groupKey: 'fecha_nacimiento' }
        );
        assert.strictEqual(r.acroFormPropuesto, 'asegurado_fecha_nacimiento_dia');
    });

    test('proposeName: beneficiario_1_nombre (repeatable Row1)', () => {
        const r = proposeNameMod.proposeName(
            { name: 'NombreRow1', type: 'text', detectedLabel: 'Nombre' },
            { sectionPrefix: 'beneficiario_', sectionName: 'Beneficiarios', sectionRepeatable: true, beneficiarioN: null },
            null
        );
        assert.strictEqual(r.acroFormPropuesto, 'beneficiario_1_nombre');
    });

    test('proposeName: beneficiario_3_porcentaje', () => {
        const r = proposeNameMod.proposeName(
            { name: 'PorcentajeRow3', type: 'text', detectedLabel: 'Porcentaje' },
            { sectionPrefix: 'beneficiario_', sectionName: 'Beneficiarios', sectionRepeatable: true },
            null
        );
        assert.strictEqual(r.acroFormPropuesto, 'beneficiario_3_porcentaje');
    });

    test('detectRepeatableRow: NombreRow2 → beneficiario_2_', () => {
        const r = proposeNameMod.detectRepeatableRow('NombreRow2', { sectionRepeatable: true, beneficiarioN: 2 });
        assert.ok(r);
        assert.strictEqual(r.rowN, 2);
        assert.strictEqual(r.rowPrefix, 'beneficiario_2_');
    });

    test('detectRepeatableRow: no Row suffix → null', () => {
        assert.strictEqual(proposeNameMod.detectRepeatableRow('Text3.0.0', { sectionName: 'Datos del Solicitante' }), null);
    });

    test('resolveCollisions: text+checkbox same name → text gets _texto', () => {
        const rows = [
            { acroFormPropuesto: 'asegurado_tipo_id_otro', _typeNative: 'checkbox' },
            { acroFormPropuesto: 'asegurado_tipo_id_otro', _typeNative: 'text' },
        ];
        const renamed = proposeNameMod.resolveCollisions(rows);
        assert.strictEqual(renamed, 1);
        assert.strictEqual(rows[0].acroFormPropuesto, 'asegurado_tipo_id_otro');
        assert.strictEqual(rows[1].acroFormPropuesto, 'asegurado_tipo_id_otro_texto');
    });

    test('resolveCollisions: same-type duplicates get _2, _3', () => {
        const rows = [
            { acroFormPropuesto: 'asegurado_telefono', _typeNative: 'text' },
            { acroFormPropuesto: 'asegurado_telefono', _typeNative: 'text' },
            { acroFormPropuesto: 'asegurado_telefono', _typeNative: 'text' },
        ];
        proposeNameMod.resolveCollisions(rows);
        assert.strictEqual(rows[0].acroFormPropuesto, 'asegurado_telefono');
        assert.strictEqual(rows[1].acroFormPropuesto, 'asegurado_telefono_2');
        assert.strictEqual(rows[2].acroFormPropuesto, 'asegurado_telefono_3');
    });

    test('addContextIfDuplicate: Día appearing 3x gets context suffixes', () => {
        const rows = [
            { etiquetaPublico: 'Día', _dateGroupKey: 'fecha_solicitud' },
            { etiquetaPublico: 'Día', _dateGroupKey: 'fecha_nacimiento' },
            { etiquetaPublico: 'Día', _dateGroupKey: 'vigencia_desde' },
            { etiquetaPublico: 'Lugar', _dateGroupKey: null },
        ];
        proposeNameMod.addContextIfDuplicate(rows);
        assert.strictEqual(rows[0].etiquetaPublico, 'Día (Solicitud)');
        assert.strictEqual(rows[1].etiquetaPublico, 'Día (Nacimiento)');
        assert.strictEqual(rows[2].etiquetaPublico, 'Día (Vigencia Desde)');
        assert.strictEqual(rows[3].etiquetaPublico, 'Lugar');
    });

    test('addContextIfDuplicate: unique label is left alone', () => {
        const rows = [
            { etiquetaPublico: 'Cédula', group: 'tipo_identificacion' },
        ];
        proposeNameMod.addContextIfDuplicate(rows);
        assert.strictEqual(rows[0].etiquetaPublico, 'Cédula');
    });

    test('addContextIfDuplicate: falls back to sectionName for non-date groups', () => {
        const rows = [
            { etiquetaPublico: 'Nombre', _sectionName: 'Beneficiario 1' },
            { etiquetaPublico: 'Nombre', _sectionName: 'Beneficiario 2' },
        ];
        proposeNameMod.addContextIfDuplicate(rows);
        assert.strictEqual(rows[0].etiquetaPublico, 'Nombre (Beneficiario 1)');
        assert.strictEqual(rows[1].etiquetaPublico, 'Nombre (Beneficiario 2)');
    });

    console.log('\n── build-pdf-rows ───────────────────────');
    const { _internal: bpr } = require('../src/matrix-editor/build-pdf-rows');

    test('appliesToFormulario: "Todos" applies to any code', () => {
        assert.strictEqual(bpr.appliesToFormulario('Todos', '1009052'), true);
        assert.strictEqual(bpr.appliesToFormulario('TODOS', 'D0306'), true);
    });

    test('appliesToFormulario: empty applies to any code', () => {
        assert.strictEqual(bpr.appliesToFormulario('', '1009052'), true);
    });

    test('appliesToFormulario: "Vida Colectiva" matches 1009052 only', () => {
        assert.strictEqual(bpr.appliesToFormulario('Vida Colectiva', '1009052'), true);
        assert.strictEqual(bpr.appliesToFormulario('Vida Colectiva', 'D0306'), false);
    });

    test('appliesToFormulario: "Crediticia" matches D0309', () => {
        assert.strictEqual(bpr.appliesToFormulario('Protección Crediticia', 'D0309'), true);
    });

    test('mapFormato: Fecha → fecha', () => {
        assert.strictEqual(bpr.mapFormato('Fecha'), 'fecha');
    });

    test('mapFormato: Numérico → numérico', () => {
        assert.strictEqual(bpr.mapFormato('Numérico'), 'numérico');
    });

    test('mapFormato: Combo → empty (no format applies)', () => {
        assert.strictEqual(bpr.mapFormato('Combo'), '');
    });

    test('normalizeYesNo: Sí variants → Sí', () => {
        assert.strictEqual(bpr.normalizeYesNo('SI'), 'Sí');
        assert.strictEqual(bpr.normalizeYesNo('si'), 'Sí');
        assert.strictEqual(bpr.normalizeYesNo('Sí'), 'Sí');
    });

    test('normalizeYesNo: NO → No', () => {
        assert.strictEqual(bpr.normalizeYesNo('NO'), 'No');
        assert.strictEqual(bpr.normalizeYesNo('no'), 'No');
    });

    test('parseConditionalText: trigger pattern', () => {
        const r = bpr.parseConditionalText('Si se selecciona Otro se debe habilitar el campo Especificar', '');
        assert.ok(r.includes('Otro'));
        assert.ok(r.includes('mostrar'));
    });

    test('parseConditionalText: no rule → empty', () => {
        assert.strictEqual(bpr.parseConditionalText('', ''), '');
    });

    test('inferSectionFromPath: datosAsegurado → DATOS DEL SOLICITANTE', () => {
        assert.strictEqual(bpr.inferSectionFromPath('datosAsegurado.primerApellido'), 'DATOS DEL SOLICITANTE');
    });

    test('inferSectionFromPath: unknown root → empty', () => {
        assert.strictEqual(bpr.inferSectionFromPath('weirdRoot.field'), '');
    });

    test('buildMatrixIndex: filters by formulario', () => {
        const rows = [
            { 'Formulario a visualizar': 'Vida Colectiva', 'Nombre del campo en formulario': 'Cédula', 'Nombre en PDF': 'Text1' },
            { 'Formulario a visualizar': 'Vida Universal', 'Nombre del campo en formulario': 'Otro', 'Nombre en PDF': 'Text2' },
            { 'Formulario a visualizar': 'Todos', 'Nombre del campo en formulario': 'Lugar', 'Nombre en PDF': 'Text3' },
        ];
        const idx = bpr.buildMatrixIndex(rows, '1009052');
        assert.strictEqual(idx.length, 2);
        assert.strictEqual(idx[0].row['Nombre del campo en formulario'], 'Cédula');
        assert.strictEqual(idx[1].row['Nombre del campo en formulario'], 'Lugar');
    });

    test('matchMatrixRow: exact label match', () => {
        const rows = [
            { 'Formulario a visualizar': 'Todos', 'Nombre del campo en formulario': 'Primer Apellido', 'Nombre en PDF': 'Text1' },
        ];
        const idx = bpr.buildMatrixIndex(rows, '1009052');
        const used = new Set();
        const im = { field: { name: 'Text1', detectedLabel: 'Primer Apellido' } };
        const matched = bpr.matchMatrixRow(im, idx, used);
        assert.ok(matched);
        assert.strictEqual(matched['Nombre del campo en formulario'], 'Primer Apellido');
        assert.strictEqual(used.size, 1);
    });

    test('matchMatrixRow: same field cannot be matched twice', () => {
        const rows = [
            { 'Formulario a visualizar': 'Todos', 'Nombre del campo en formulario': 'Cédula', 'Nombre en PDF': 'Check1' },
        ];
        const idx = bpr.buildMatrixIndex(rows, '1009052');
        const used = new Set();
        const im = { field: { name: 'Check1', detectedLabel: 'Cédula' } };
        assert.ok(bpr.matchMatrixRow(im, idx, used));
        assert.strictEqual(bpr.matchMatrixRow(im, idx, used), null);
    });

    test('extractFromMatrix: parses validation, formato, jsonPath', () => {
        const matrixRow = {
            'Nombre del Campo en Json': 'datosAsegurado.numeroIdentificacion, datosAsegurado.tipoIdentificacion',
            'Regla': '16 caracteres, sólo números',
            'Observaciones': '',
            'Tipo de dato': 'Numérico',
            'Obligatorio': 'SI',
        };
        const e = bpr.extractFromMatrix(matrixRow, null, []);
        assert.strictEqual(e.pathPrincipal, 'datosAsegurado.numeroIdentificacion');
        assert.ok(e.pathsSecundarios.includes('tipoIdentificacion'));
        assert.strictEqual(e.maxLength, '16');
        assert.ok(e.patron.includes('\\d'));
        assert.strictEqual(e.formato, 'numérico');
        assert.strictEqual(e.obligatorio, 'Sí');
    });

    test('collectPrefilledMatrixRows: only "no se llena en PDF" rows', () => {
        const rows = [
            { 'Formulario a visualizar': 'Todos', 'Nombre en PDF': 'Text1', 'Nombre del campo en formulario': 'Lugar', 'Nombre del Campo en Json': 'datosGenerales.lugar' },
            { 'Formulario a visualizar': 'Todos', 'Nombre en PDF': 'No se llena en PDF', 'Nombre del campo en formulario': 'Código Tomador', 'Nombre del Campo en Json': 'datosTomador.codigo' },
            { 'Formulario a visualizar': 'Todos', 'Nombre en PDF': 'N/A', 'Nombre del campo en formulario': 'IdSolicitud', 'Nombre del Campo en Json': 'datosGenerales.idSolicitud' },
        ];
        const used = new Set([0]);
        const pf = bpr.collectPrefilledMatrixRows(rows, '1009052', used, null);
        assert.strictEqual(pf.length, 2);
        assert.strictEqual(pf[0].label, 'Código Tomador');
        assert.strictEqual(pf[1].label, 'IdSolicitud');
    });

    test('interleavePrefilled: inserts prefilled row when section ends', () => {
        const pdfRows = [
            [1, 'DATOS DEL SOLICITANTE', 'Text1', 'asegurado_lugar', 'Lugar', 'asegurado_lugar', 'Tx', '', 1, '', '', 'No', '', '', '', '', '', '', '', ''],
            [2, 'BENEFICIARIO 1',         'Text2', 'beneficiario_1_nombre', 'Nombre', 'beneficiario_1_nombre', 'Tx', '', 1, '', '', 'No', '', '', '', '', '', '', '', ''],
        ];
        const prefilled = [
            { sectionPdf: 'DATOS DEL SOLICITANTE', label: 'Código', tipoDatoMatriz: 'Texto',
              enrich: { pathPrincipal: 'datosAsegurado.codigo', pathsSecundarios: '', obligatorio: 'No', maxLength: '', patron: '', formato: '', condicional: '', catalogo: '', tipoDatoMatriz: 'Texto', reglaOriginal: '' } },
        ];
        const out = bpr.interleavePrefilled(pdfRows, prefilled);
        assert.strictEqual(out.length, 3);
        assert.strictEqual(out[0][1], 'DATOS DEL SOLICITANTE');
        assert.strictEqual(out[1][1], 'DATOS DEL SOLICITANTE');
        assert.strictEqual(out[1][11], 'Sí');                  // pre-rellenado
        assert.strictEqual(out[1][2], '');                      // AcroForm Actual vacío
        assert.strictEqual(out[2][1], 'BENEFICIARIO 1');
        assert.deepStrictEqual([out[0][0], out[1][0], out[2][0]], [1, 2, 3]);
    });

    console.log('\n── export-by-formulario ─────────────────');
    const exportMod = require('../src/matrix-editor/export-by-formulario');

    test('identifyPdfCode: detects 1009052 from filename', () => {
        assert.strictEqual(exportMod.identifyPdfCode('1009052_Solicitud_Vida_Colectiva.pdf'), '1009052');
    });

    test('identifyPdfCode: detects D0306', () => {
        assert.strictEqual(exportMod.identifyPdfCode('D0306_Solicitud_Vida_Universal.pdf'), 'D0306');
    });

    test('identifyPdfCode: detects D0309', () => {
        assert.strictEqual(exportMod.identifyPdfCode('D0309_Crediticia.pdf'), 'D0309');
    });

    test('identifyPdfCode: unknown returns null', () => {
        assert.strictEqual(exportMod.identifyPdfCode('OtroFormulario.pdf'), null);
    });

    test('filenameFor: 1009052 → Mapeo_1009052_Vida_Colectiva.xlsx', () => {
        assert.strictEqual(exportMod.filenameFor('1009052'), 'Mapeo_1009052_Vida_Colectiva.xlsx');
    });

    test('filenameFor: D0306 → Mapeo_D0306_Vida_Universal_Plus.xlsx', () => {
        assert.strictEqual(exportMod.filenameFor('D0306'), 'Mapeo_D0306_Vida_Universal_Plus.xlsx');
    });

    test('filenameFor: D0309 → Mapeo_D0309_Proteccion_Crediticia.xlsx', () => {
        assert.strictEqual(exportMod.filenameFor('D0309'), 'Mapeo_D0309_Proteccion_Crediticia.xlsx');
    });

    test('filenameFor: unknown code falls back to sanitized PDF name', () => {
        assert.strictEqual(
            exportMod.filenameFor(null, 'Custom_Form.pdf'),
            'Mapeo_Custom_Form.xlsx'
        );
    });

    test('buildWorkbook: contains "Mapeo de campos" sheet with HEADERS', () => {
        const wb = exportMod.buildWorkbook([], '1009052', null);
        assert.ok(wb.SheetNames.includes('Mapeo de campos'));
        const ws = wb.Sheets['Mapeo de campos'];
        assert.strictEqual(ws['A1'].v, '#');
        assert.strictEqual(ws['B1'].v, 'Sección del PDF');
        assert.strictEqual(ws['C1'].v, 'AcroForm Actual');
        assert.strictEqual(ws['D1'].v, 'AcroForm Propuesto');
        assert.strictEqual(ws['T1'].v, 'Regla original');
    });

    test('buildWorkbook: appends Catálogos sheet when catalogos provided', () => {
        const wb = exportMod.buildWorkbook([], '1009052', { 'Tipo Identificacion': [{ code: '1', label: 'Cédula' }] });
        assert.ok(wb.SheetNames.includes('Catálogos de opciones'));
    });

    test('exportPerFormularioZip: rejects when no PDFs', () => {
        const p = exportMod.exportPerFormularioZip([], [], null);
        return p.then(
            () => { throw new Error('should have rejected'); },
            err => { assert.match(err.message, /al menos un PDF/i); }
        );
    });

    console.log('\n── path-indexer ─────────────────────────');
    const pathIndexer = require('../src/matrix-editor/path-indexer');

    test('addPathIndex: asegurado_ → personas[0]', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas.primerApellido', 'asegurado_');
        assert.strictEqual(r.path, 'datosFormulario.personas[0].primerApellido');
        assert.strictEqual(r.warning, false);
    });

    test('addPathIndex: beneficiario_1_ → personas[1]', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas.nombreCompleto', 'beneficiario_1_');
        assert.strictEqual(r.path, 'datosFormulario.personas[1].nombreCompleto');
    });

    test('addPathIndex: beneficiario_2_ → personas[2]', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas.descripcionParentesco', 'beneficiario_2_');
        assert.strictEqual(r.path, 'datosFormulario.personas[2].descripcionParentesco');
    });

    test('addPathIndex: beneficiario_3_ → personas[3]', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas.porcentaje', 'beneficiario_3_');
        assert.strictEqual(r.path, 'datosFormulario.personas[3].porcentaje');
    });

    test('addPathIndex: solicitud_ → unchanged (no personas)', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.datosGenerales.lugar', 'solicitud_');
        assert.strictEqual(r.path, 'datosFormulario.datosGenerales.lugar');
        assert.strictEqual(r.warning, false);
    });

    test('addPathIndex: poliza_ + non-personas path → unchanged', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.polizaMadre.numero', 'poliza_');
        assert.strictEqual(r.path, 'datosFormulario.polizaMadre.numero');
    });

    test('addPathIndex: empty path → empty result', () => {
        const r = pathIndexer.addPathIndex('', 'asegurado_');
        assert.strictEqual(r.path, '');
    });

    test('addPathIndex: path already indexed → leave alone', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas[0].primerApellido', 'asegurado_');
        assert.strictEqual(r.path, 'datosFormulario.personas[0].primerApellido');
    });

    test('addPathIndex: future section dme_ → warning, path unchanged', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas.nombre', 'dme_');
        assert.strictEqual(r.path, 'datosFormulario.personas.nombre');
        assert.strictEqual(r.warning, true);
    });

    test('addPathIndex: unknown prefix on personas path → warning', () => {
        const r = pathIndexer.addPathIndex('datosFormulario.personas.primerApellido', 'whatever_');
        assert.strictEqual(r.warning, true);
    });

    test('indexPaths: principal + secundarios both rewritten', () => {
        const r = pathIndexer.indexPaths(
            'datosFormulario.personas.codigoTipoIdentificacion',
            'datosFormulario.personas.descripcionTipoIdentificacion',
            'asegurado_'
        );
        assert.strictEqual(r.principal, 'datosFormulario.personas[0].codigoTipoIdentificacion');
        assert.ok(r.secundarios.includes('personas[0].descripcionTipoIdentificacion'));
        assert.strictEqual(r.warning, false);
    });

    test('indexPaths: empty secundarios → empty string back', () => {
        const r = pathIndexer.indexPaths('datosFormulario.personas.x', '', 'asegurado_');
        assert.strictEqual(r.principal, 'datosFormulario.personas[0].x');
        assert.strictEqual(r.secundarios, '');
    });

    test('indexPaths: warning propagates from any path', () => {
        const r = pathIndexer.indexPaths(
            'datosFormulario.datosGenerales.lugar',
            'datosFormulario.personas.x',
            'dme_'
        );
        assert.strictEqual(r.warning, true);
    });

    console.log('\n── catalogs-formatter ───────────────────');
    const catFmt = require('../src/matrix-editor/catalogs-formatter');

    test('findCatalog: group "sexo" → synthetic Sexo', () => {
        const r = catFmt.findCatalog('sexo', 'Sexo', null);
        assert.strictEqual(r.isSynthetic, true);
        assert.strictEqual(r.sheetName, 'Sexo (sintético)');
        assert.strictEqual(r.options.length, 2);
        assert.strictEqual(r.options[0].code, 'M');
    });

    test('findCatalog: group "tipo_identificacion" → catalog by group whitelist', () => {
        const fakeCatalogos = {
            'tipo identificación': [
                { code: '0', label: 'Cédula Física Nacional' },
                { code: '2', label: 'DIMEX' },
            ],
        };
        const r = catFmt.findCatalog('tipo_identificacion', 'Cédula', fakeCatalogos);
        assert.strictEqual(r.isSynthetic, false);
        assert.strictEqual(r.options.length, 2);
        assert.strictEqual(r.options[0].label, 'Cédula Física Nacional');
    });

    test('findCatalog: by label "Parentesco" → parentesco sheet', () => {
        const fakeCatalogos = {
            'parentesco': [
                { code: '', label: 'Madre' },
                { code: '', label: 'Padre' },
            ],
        };
        const r = catFmt.findCatalog('', 'Parentesco', fakeCatalogos);
        assert.strictEqual(r.options.length, 2);
        assert.strictEqual(r.options[0].label, 'Madre');
    });

    test('findCatalog: no match → null sheetName, empty options', () => {
        const r = catFmt.findCatalog('', 'Algo Random', { 'parentesco': [{ label: 'x' }] });
        assert.strictEqual(r.sheetName, null);
        assert.strictEqual(r.options.length, 0);
    });

    test('formatCatalogOptionsJson: code present → value=code', () => {
        const json = catFmt.formatCatalogOptionsJson([
            { code: '0', label: 'Cédula' },
            { code: '2', label: 'DIMEX' },
        ]);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed[0].value, '0');
        assert.strictEqual(parsed[0].label, 'Cédula');
        assert.strictEqual(parsed[1].value, '2');
    });

    test('formatCatalogOptionsJson: empty code → value=label (Parentesco case)', () => {
        const json = catFmt.formatCatalogOptionsJson([
            { code: '', label: 'Madre' },
            { code: '', label: 'Padre' },
        ]);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed[0].value, 'Madre');
        assert.strictEqual(parsed[0].label, 'Madre');
    });

    test('formatCatalogOptionsJson: empty options → empty string', () => {
        assert.strictEqual(catFmt.formatCatalogOptionsJson([]), '');
        assert.strictEqual(catFmt.formatCatalogOptionsJson(null), '');
    });

    test('formatCatalogOptionsJson: synthetic Sexo round-trip', () => {
        const r = catFmt.findCatalog('sexo', 'Sexo', null);
        const json = catFmt.formatCatalogOptionsJson(r.options);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed[0].value, 'M');
        assert.strictEqual(parsed[1].value, 'F');
    });

    test('lookupCatalog: fuzzy partial match', () => {
        const cats = { 'tipo identificación': [{ code: '0', label: 'X' }] };
        const found = catFmt.lookupCatalog(cats, 'identificación');
        assert.ok(found);
        assert.strictEqual(found[0].code, '0');
    });

    test('parseCatalogos result keeps sheetName as non-enumerable', () => {
        const arr = [{ code: '0', label: 'X' }];
        Object.defineProperty(arr, 'sheetName', { value: 'Tipo Identificación', enumerable: false });
        const cats = { 'tipo identificación': arr };
        const r = catFmt.findCatalog('tipo_identificacion', '', cats);
        assert.strictEqual(r.sheetName, 'Tipo Identificación');
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
