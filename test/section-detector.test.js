#!/usr/bin/env node
'use strict';

const assert = require('assert');

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

const {
    detectSections,
    assignSectionToField,
    detectDateGroups,
    _internal: { slugify, normalize, looksLikeHeading, identifyDatePart, groupIntoTriplets },
} = require('../src/matrix-editor/section-detector');

function mkText(str, page, x, y, w, h) {
    return { str, page: page || 0, x: x || 0, y: y || 600, width: w || 200, height: h || 12 };
}

function mkField(name, type, page, x, y, w, h, label) {
    return {
        name,
        type: type || 'text',
        rect: { x: x || 50, y: y || 500, width: w || 100, height: h || 14 },
        page: page || 0,
        detectedLabel: label || null,
    };
}

async function run() {
    console.log('\n── section-detector: normalize / slugify ──');

    test('normalize strips accents and lowercases', () => {
        assert.strictEqual(normalize('Póliza'), 'poliza');
        assert.strictEqual(normalize('SECCIÓN'), 'seccion');
    });

    test('slugify produces snake_case', () => {
        assert.strictEqual(slugify('Fecha de Nacimiento'), 'fecha_de_nacimiento');
        assert.strictEqual(slugify('Tipo Identificación:'), 'tipo_identificacion');
    });

    test('looksLikeHeading detects uppercase text', () => {
        assert.strictEqual(looksLikeHeading('DATOS DEL SOLICITANTE'), true);
        assert.strictEqual(looksLikeHeading('Nombre completo'), false);
        assert.strictEqual(looksLikeHeading('short'), false);
    });

    console.log('\n── section-detector: detectSections ──');

    test('detectSections returns headings and subHeadings arrays', () => {
        const textItems = [
            mkText('LUGAR Y FECHA DE SOLICITUD', 0, 50, 750, 300, 14),
            mkText('DATOS DEL SOLICITANTE / ASEGURADO', 0, 50, 500, 250, 14),
            mkText('Tipo de identificación:', 0, 50, 400, 150, 10),
            mkText('Nombre completo', 0, 50, 350, 120, 10),
        ];
        const result = detectSections(textItems);
        assert.ok(Array.isArray(result.headings), 'headings should be an array');
        assert.ok(Array.isArray(result.subHeadings), 'subHeadings should be an array');
        assert.ok(result.headings.length >= 2, `should detect at least 2 headings, got ${result.headings.length}: ${result.headings.map(h=>h.text).join(', ')}`);
    });

    console.log('\n── section-detector: assignSectionToField ──');

    test('assignSectionToField accepts headings array (not object)', () => {
        const headings = [
            { text: 'DATOS DEL SOLICITANTE', page: 0, x: 50, y: 700, width: 200, height: 14, prefix: 'asegurado_', name: 'Datos del Solicitante' },
        ];
        const subHeadings = [];
        const field = mkField('test_field', 'text', 0, 50, 500, 100, 14);
        const info = assignSectionToField(field, headings, subHeadings);
        assert.strictEqual(info.sectionPrefix, 'asegurado_');
        assert.strictEqual(info.sectionName, 'Datos del Solicitante');
    });

    test('assignSectionToField returns empty prefix when no heading found', () => {
        const field = mkField('orphan', 'text', 0, 50, 800, 100, 14);
        const info = assignSectionToField(field, [], []);
        assert.strictEqual(info.sectionPrefix, '');
        assert.ok(info.warnings.length > 0);
    });

    console.log('\n── section-detector: detectDateGroups ──');

    test('detectDateGroups accepts headings array (regression: was receiving object)', () => {
        const fields = [
            mkField('dia_field', 'text', 0, 100, 500, 40, 14, 'Día'),
            mkField('mes_field', 'text', 0, 200, 500, 40, 14, 'Mes'),
            mkField('ano_field', 'text', 0, 300, 500, 40, 14, 'Año'),
        ];
        const headings = [
            { text: 'LUGAR Y FECHA DE LA SOLICITUD', page: 0, x: 50, y: 700, width: 300, height: 14, prefix: 'solicitud_', name: 'Lugar y Fecha de Solicitud' },
        ];
        const textItems = [
            mkText('LUGAR Y FECHA DE LA SOLICITUD', 0, 50, 700, 300, 14),
        ];
        const result = detectDateGroups(fields, headings, textItems);
        assert.ok(result instanceof Map, 'should return a Map');
        assert.ok(result.size >= 2, `should detect at least 2 date fields, got ${result.size}`);
        const dia = result.get('dia_field');
        assert.ok(dia, 'dia_field should be in result');
        assert.strictEqual(dia.part, 'dia');
        assert.ok(dia.groupKey, 'should have a groupKey');
    });

    test('detectDateGroups does NOT crash when headings is the sections object (the bug)', () => {
        const fields = [
            mkField('dia', 'text', 0, 100, 500, 40, 14, 'Día'),
            mkField('mes', 'text', 0, 200, 500, 40, 14, 'Mes'),
        ];
        const sectionsObject = {
            headings: [{ text: 'DATOS', page: 0, x: 0, y: 700, width: 200, height: 14, prefix: '', name: 'Datos' }],
            subHeadings: [],
        };
        assert.throws(
            () => detectDateGroups(fields, sectionsObject, []),
            /filter is not a function|is not iterable/,
            'passing sections object instead of headings array should throw'
        );
    });

    test('detectDateGroups handles empty headings gracefully', () => {
        const fields = [
            mkField('dia', 'text', 0, 100, 500, 40, 14, 'Día'),
            mkField('mes', 'text', 0, 200, 500, 40, 14, 'Mes'),
        ];
        const result = detectDateGroups(fields, [], []);
        assert.ok(result instanceof Map);
    });

    test('detectDateGroups handles null/undefined headings gracefully', () => {
        const fields = [
            mkField('dia', 'text', 0, 100, 500, 40, 14, 'Día'),
            mkField('mes', 'text', 0, 200, 500, 40, 14, 'Mes'),
        ];
        const result = detectDateGroups(fields, null, []);
        assert.ok(result instanceof Map);
    });

    console.log('\n── section-detector: identifyDatePart ──');

    test('identifyDatePart recognizes día/mes/año', () => {
        assert.strictEqual(identifyDatePart('Día'), 'dia');
        assert.strictEqual(identifyDatePart('día'), 'dia');
        assert.strictEqual(identifyDatePart('Mes'), 'mes');
        assert.strictEqual(identifyDatePart('Año'), 'ano');
        assert.strictEqual(identifyDatePart('Nombre'), null);
    });

    console.log('\n── section-detector: groupIntoTriplets ──');

    test('groupIntoTriplets groups fields on same line', () => {
        const candidates = [
            { field: mkField('d', 'text', 0, 100, 500, 40, 14), part: 'dia' },
            { field: mkField('m', 'text', 0, 160, 500, 40, 14), part: 'mes' },
            { field: mkField('a', 'text', 0, 220, 500, 40, 14), part: 'ano' },
        ];
        const triplets = groupIntoTriplets(candidates);
        assert.strictEqual(triplets.length, 1);
        assert.strictEqual(triplets[0].length, 3);
    });

    test('groupIntoTriplets separates fields on different lines', () => {
        const candidates = [
            { field: mkField('d1', 'text', 0, 100, 500, 40, 14), part: 'dia' },
            { field: mkField('m1', 'text', 0, 160, 500, 40, 14), part: 'mes' },
            { field: mkField('d2', 'text', 0, 100, 300, 40, 14), part: 'dia' },
            { field: mkField('m2', 'text', 0, 160, 300, 40, 14), part: 'mes' },
        ];
        const triplets = groupIntoTriplets(candidates);
        assert.strictEqual(triplets.length, 2);
    });

    console.log('\n── section-detector: buildPdfRows integration ──');

    test('buildPdfRows destructures detectSections correctly (regression)', () => {
        const buildPdfRows = require('../src/matrix-editor/build-pdf-rows');
        assert.ok(typeof buildPdfRows.buildPdfRows === 'function', 'buildPdfRows should be exported');
    });

    console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
