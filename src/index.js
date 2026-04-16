#!/usr/bin/env node
/**
 * CLI — INS Lovable JSON Generator (Node entry point)
 *
 * Usage:
 *   node src/index.js --pdf=1009052 --out=outputs/1009052.json
 *   node src/index.js --all
 *   node src/index.js --pdf=D0306 --no-pdf-embed
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { runPipeline, KNOWN_PRODUCTS } = require('./pipeline');

const ROOT = path.resolve(__dirname, '..');

const PRODUCT_FILES = {
    '1009052': '1009052.pdf',
    'D0306':   'D0306.pdf',
    'D0309':   'D0309.pdf'
};

const DEFAULT_PATHS = {
    matrix:    path.join(ROOT, 'inputs', 'Matriz_Formularios_VidaColectiva_Secciones.xlsx'),
    catalogs:  path.join(ROOT, 'inputs', 'Catalogos_Formularios_INS_Namirial_-_Vida.xlsx'),
    client:    path.join(ROOT, 'inputs', 'Json_Formulario_Vida_-_Asegurado.txt'),
    outputDir: path.join(ROOT, 'outputs')
};

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const matrixPath   = args.matrix   || DEFAULT_PATHS.matrix;
    const catalogsPath = args.catalogs || DEFAULT_PATHS.catalogs;
    const clientPath   = args.client   || DEFAULT_PATHS.client;

    if (!fs.existsSync(matrixPath))   throw new Error(`Matrix not found: ${matrixPath}`);
    if (!fs.existsSync(catalogsPath)) throw new Error(`Catalogs not found: ${catalogsPath}`);

    log(`→ Reading matrix:   ${rel(matrixPath)}`);
    const matrixBuffer = fs.readFileSync(matrixPath);

    log(`→ Reading catalogs: ${rel(catalogsPath)}`);
    const catalogsBuffer = fs.readFileSync(catalogsPath);

    const clientJsonText = fs.existsSync(clientPath)
        ? fs.readFileSync(clientPath, 'utf-8')
        : null;
    if (!clientJsonText) {
        log(`  (prefillKey validation disabled — no client JSON at ${rel(clientPath)})`);
    }

    const products = args.all
        ? Object.keys(KNOWN_PRODUCTS)
        : (args.pdf ? [args.pdf] : null);

    if (!products) {
        console.error('✗ Specify --pdf=<id> or --all');
        printUsage();
        process.exit(1);
    }

    fs.mkdirSync(DEFAULT_PATHS.outputDir, { recursive: true });

    for (const pdfId of products) {
        const meta = KNOWN_PRODUCTS[pdfId];
        if (!meta) {
            console.error(`✗ Unknown product "${pdfId}"`);
            process.exit(1);
        }
        log(`\n● ${pdfId} (${meta.productName})`);

        const pdfFile = PRODUCT_FILES[pdfId];
        const pdfPath = pdfFile ? path.join(ROOT, 'inputs', pdfFile) : null;
        let pdfBuffer = null;
        if (pdfPath && fs.existsSync(pdfPath)) {
            log(`  Reading PDF: ${rel(pdfPath)}`);
            pdfBuffer = fs.readFileSync(pdfPath);
        } else if (pdfPath) {
            log(`  ⚠ PDF not found at ${rel(pdfPath)} — skipping coordinates`);
        }

        const { json, warnings, issues } = await runPipeline({
            matrixBuffer,
            catalogsBuffer,
            pdfBuffer,
            clientJsonText,
            pdfId
        }, {
            embedPdf: !args.noPdfEmbed,
            strategy: args.strategy || 'logical'
        });

        const fieldCount = json.sections.reduce((n, s) => n + s.fields.length, 0);
        log(`  ${fieldCount} fields across ${json.sections.length} sections`);

        if (warnings.length) {
            log(`  ⚠ ${warnings.length} warnings${args.verbose ? ':' : ' (use --verbose)'}`);
            if (args.verbose) {
                for (const w of warnings) console.warn(`    [${w.stage}:${w.type}]`, w.reason || w);
            }
        }
        if (issues.length) {
            log(`  ⚠ ${issues.length} prefillKey mismatch(es)${args.verbose ? ':' : ''}`);
            if (args.verbose) {
                for (const i of issues) console.warn(`    • ${i.field} (${i.prefillKey}) — ${i.reason}`);
            }
        }

        const outPath = args.out || path.join(DEFAULT_PATHS.outputDir, `${pdfId}.json`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
        log(`  ✔ wrote ${rel(outPath)}`);
    }
}

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        const m = a.match(/^--([^=]+)(?:=(.*))?$/);
        if (!m) continue;
        const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out[key] = m[2] === undefined ? true : m[2];
    }
    return out;
}

function printUsage() {
    console.error(`
Usage:
  node src/index.js --pdf=1009052
  node src/index.js --all
  node src/index.js --pdf=D0306 --no-pdf-embed --verbose

Known products: ${Object.keys(KNOWN_PRODUCTS).join(', ')}
`);
}

function rel(p) { return path.relative(ROOT, p) || p; }
function log(msg) { console.log(msg); }

if (require.main === module) {
    main().catch(err => {
        console.error('\n✗ Pipeline failed:', err.message);
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
    });
}

module.exports = { main };
