/**
 * @file pdf-renamer.test.js
 * @version 1.2.1
 */
'use strict';

const assert = require('assert');
const { PDFDocument, PDFName, PDFHexString } = require('pdf-lib');
const { renamePdf, _internal: { isDirtyValue, readStringValue } } = require('../lib/pdf-renamer');

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

async function createTestPdf(fields) {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();

    for (const { name, type, value } of fields) {
        if (type === 'checkbox') {
            const cb = form.createCheckBox(name);
            cb.addToPage(page, { x: 50, y: 500, width: 20, height: 20 });
        } else {
            const tf = form.createTextField(name);
            tf.addToPage(page, { x: 50, y: 500, width: 200, height: 20 });
            if (value) tf.setText(value);
        }
    }

    return await doc.save();
}

async function run() {
    console.log('\n── pdf-renamer: isDirtyValue ──');

    test('isDirtyValue detects "undefined"', () => {
        assert.strictEqual(isDirtyValue('undefined', 'test'), true);
        assert.strictEqual(isDirtyValue('NOTIFICACIONES', 'test'), true);
        assert.strictEqual(isDirtyValue('undefine', 'test'), true);
    });

    test('isDirtyValue detects old field name', () => {
        assert.strictEqual(isDirtyValue('Text3.0.0', 'Text3.0.0'), true);
    });

    test('isDirtyValue detects Text/CheckBox patterns', () => {
        assert.strictEqual(isDirtyValue('Text3.1.2', 'other'), true);
        assert.strictEqual(isDirtyValue('Check Box4.0.0', 'other'), true);
    });

    test('isDirtyValue allows clean values', () => {
        assert.strictEqual(isDirtyValue('San José', 'test'), false);
        assert.strictEqual(isDirtyValue('123456', 'test'), false);
        assert.strictEqual(isDirtyValue('', 'test'), false);
    });

    console.log('\n── pdf-renamer: renamePdf ──');

    await test('renamePdf renames simple flat fields', async () => {
        const pdfBytes = await createTestPdf([
            { name: 'field_a', type: 'text' },
            { name: 'field_b', type: 'text' },
        ]);

        const result = await renamePdf(pdfBytes, [
            { oldName: 'field_a', newName: 'nuevo_a' },
            { oldName: 'field_b', newName: 'nuevo_b' },
        ]);

        assert.strictEqual(result.renamedCount, 2);
        assert.ok(result.pdfBytes.length > 0);
        assert.strictEqual(result.summary.renamed, 2);
        assert.strictEqual(result.summary.verifyErrors, 0);
    });

    await test('renamePdf warns about missing fields', async () => {
        const pdfBytes = await createTestPdf([
            { name: 'exists', type: 'text' },
        ]);

        const result = await renamePdf(pdfBytes, [
            { oldName: 'exists', newName: 'new_exists' },
            { oldName: 'does_not_exist', newName: 'new_missing' },
        ]);

        assert.strictEqual(result.renamedCount, 1);
        const missingWarning = result.warnings.find(w => w.type === 'rename_failed');
        assert.ok(missingWarning, 'should warn about missing field');
    });

    await test('renamePdf handles empty mapping gracefully', async () => {
        const pdfBytes = await createTestPdf([
            { name: 'field_a', type: 'text' },
        ]);

        const result = await renamePdf(pdfBytes, []);
        assert.strictEqual(result.renamedCount, 0);
        assert.ok(result.pdfBytes.length > 0);
    });

    await test('renamePdf verifies renamed fields exist in output', async () => {
        const pdfBytes = await createTestPdf([
            { name: 'old_name', type: 'text' },
        ]);

        const result = await renamePdf(pdfBytes, [
            { oldName: 'old_name', newName: 'new_name' },
        ]);

        assert.strictEqual(result.summary.verified.length, 1);
        assert.strictEqual(result.summary.verified[0], 'new_name');
    });

    console.log('\n── Results: ' + passed + ' passed, ' + failed + ' failed ──\n');
    process.exit(failed > 0 ? 1 : 0);
}

run();
