#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { detectFields } = require('../index');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log('  ✔ ' + msg);
        passed++;
    } else {
        console.log('  ✘ ' + msg);
        failed++;
    }
}

async function run() {
    // Try to find a test PDF
    const candidates = [
        path.resolve(__dirname, '../../../input.pdf'),
        path.resolve(__dirname, 'fixtures/1009052/input.pdf'),
    ];
    const pdfPath = candidates.find(p => fs.existsSync(p));

    if (!pdfPath) {
        console.log('\n── pdf-detect: no test PDF found, skipping ──\n');
        return;
    }

    const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));

    console.log('\n── pdf-detect: detectFields ──');
    const result = await detectFields(pdfBytes);

    assert(result.fields.length > 0, 'detectFields returns fields (got ' + result.fields.length + ')');
    assert(result.stats.total === result.fields.length, 'stats.total matches fields.length');
    assert(result.stats.pages >= 1, 'at least 1 page detected');

    // All fields have required properties
    const first = result.fields[0];
    assert(typeof first.name === 'string' && first.name.length > 0, 'first field has a name: "' + first.name + '"');
    assert(typeof first.type === 'string', 'first field has a type: "' + first.type + '"');
    assert(typeof first.page === 'number' && first.page >= 1, 'first field has page >= 1');
    assert(typeof first.x === 'number', 'first field has x coordinate');
    assert(typeof first.y === 'number', 'first field has y coordinate');

    // Visual sort: pages should be ascending
    let pagesAsc = true;
    for (let i = 1; i < result.fields.length; i++) {
        if (result.fields[i].page < result.fields[i - 1].page) {
            pagesAsc = false;
            break;
        }
    }
    assert(pagesAsc, 'fields are sorted by page ascending');

    // Within same page, Y should be generally descending (top to bottom)
    let page1Fields = result.fields.filter(f => f.page === 1);
    if (page1Fields.length >= 2) {
        assert(page1Fields[0].y >= page1Fields[page1Fields.length - 1].y,
            'page 1: first field Y (' + page1Fields[0].y + ') >= last field Y (' +
            page1Fields[page1Fields.length - 1].y + ')');
    }

    // Print first 10 fields for inspection
    console.log('\n  First 10 fields:');
    for (let i = 0; i < Math.min(10, result.fields.length); i++) {
        const f = result.fields[i];
        console.log('    ' + (i + 1) + '. ' + f.name + ' [' + f.type + '] p' + f.page +
            ' (' + f.x + ',' + f.y + ') ' + f.width + 'x' + f.height);
    }

    console.log('\n── Results: ' + passed + ' passed, ' + failed + ' failed ──\n');
    if (failed > 0) process.exit(1);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
