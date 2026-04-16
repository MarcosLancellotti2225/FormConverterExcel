#!/usr/bin/env node
/**
 * Smoke tests
 * - Unit tests for the rule-parser (no I/O required)
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
    const { _internal: xlsx } = require('../src/parsers/excel-parser');

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

    test('normalizeProductScope: "Vida Universal Plus" → ["vida_universal"]', () => {
        const r = xlsx.normalizeProductScope('Vida Universal Plus');
        assert.deepStrictEqual(r, ['vida_universal']);
    });

    test('normalizeProductScope: "TODOS" → ["all"]', () => {
        assert.deepStrictEqual(xlsx.normalizeProductScope('TODOS'), ['all']);
    });

    console.log('\n── json-builder shape ───────────────────');
    const { buildLovableJson } = require('../src/builders/json-builder');

    test('buildLovableJson emits the expected top-level keys', () => {
        const json = buildLovableJson({
            sections: [],
            pdfId: '1009052',
            pdfBase64: null,
            meta: { productName: 'Test' },
            catalogs: {}
        });
        assert.ok(json.$schema);
        assert.strictEqual(json.productCode, '1009052');
        assert.deepStrictEqual(json.sections, []);
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

    test('validateLovableJson flags unknown prefillKey', () => {
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

    console.log('\n── end-to-end pipeline (if inputs present) ──');
    const inputsDir = path.join(ROOT, 'inputs');
    const hasMatrix = fs.existsSync(path.join(inputsDir, 'Matriz_Formularios_VidaColectiva_Secciones.xlsx'));
    const hasCatalog = fs.existsSync(path.join(inputsDir, 'Catalogos_Formularios_INS_Namirial_-_Vida.xlsx'));

    if (!hasMatrix || !hasCatalog) {
        console.log('  ↳ skipped (missing files in /inputs)');
    } else {
        await test('full pipeline produces 1009052.json', async () => {
            process.argv = ['node', 'src/index.js', '--pdf=1009052', '--no-pdf-embed'];
            // Re-require CLI fresh
            delete require.cache[require.resolve('../src/index.js')];
            const { main } = require('../src/index');
            await main();
            const outPath = path.join(ROOT, 'outputs', '1009052.json');
            assert.ok(fs.existsSync(outPath), 'output JSON was not written');
            const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
            assert.ok(Array.isArray(parsed.sections), 'sections[] missing');
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
