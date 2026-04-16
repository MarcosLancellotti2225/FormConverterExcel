#!/usr/bin/env node
/**
 * CLI — INS Lovable JSON Generator
 *
 * Usage:
 *   node src/index.js --pdf=1009052 --out=outputs/1009052.json
 *   node src/index.js --all
 *   node src/index.js --pdf=D0306 --no-pdf-embed
 *
 * Flags:
 *   --pdf=<id>         generate JSON for a single product (1009052 | D0306 | D0309)
 *   --all              generate JSON for every known PDF
 *   --out=<path>       override output path (only valid when --pdf is used)
 *   --matrix=<path>    override matrix xlsx path
 *   --catalogs=<path>  override catalogs xlsx path
 *   --client=<path>    override client JSON path for prefillKey validation
 *   --no-pdf-embed     omit `_sourcePdf.b64` from the output (smaller files)
 *   --strategy=<s>     section strategy: "logical" (default) or "pdf_page"
 *   --verbose          print all warnings
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { parseMatrix }         = require('./parsers/excel-parser');
const { parseCatalogs }       = require('./parsers/catalogs-parser');
const { parsePdfCoordinates, readPdfAsBase64 } = require('./parsers/pdf-analyzer');
const { applyRules }          = require('./parsers/rule-parser');
const { mergeCatalogs }       = require('./transformers/merge-catalogs');
const { mergePdfCoords }      = require('./transformers/merge-pdf-coords');
const { groupBySections, resolveTriggerConditionals } = require('./transformers/section-grouper');
const { buildLovableJson }    = require('./builders/json-builder');
const { loadClientPaths, validateLovableJson } = require('./validators/prefillkey-validator');

const ROOT = path.resolve(__dirname, '..');

const KNOWN_PRODUCTS = {
    '1009052': { productName: 'Vida Colectiva', pdfFile: '1009052.pdf' },
    'D0306':   { productName: 'Vida Universal Plus', pdfFile: 'D0306.pdf' },
    'D0309':   { productName: 'Protección Crediticia', pdfFile: 'D0309.pdf' }
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

    log(`→ Reading matrix:   ${rel(matrixPath)}`);
    const { fields: baseFields } = parseMatrix(matrixPath);
    log(`  Parsed ${baseFields.length} fields`);

    log(`→ Reading catalogs: ${rel(catalogsPath)}`);
    const catalogs = parseCatalogs(catalogsPath);
    log(`  Found catalogs: ${Object.keys(catalogs).filter(k => !k.includes('_')).join(', ')}`);

    const products = args.all
        ? Object.keys(KNOWN_PRODUCTS)
        : (args.pdf ? [args.pdf] : null);

    if (!products) {
        console.error('✗ Specify --pdf=<id> or --all');
        printUsage();
        process.exit(1);
    }

    const clientPaths = loadClientPaths(clientPath);
    if (clientPaths.size === 0) {
        log(`  (prefillKey validation disabled — no client JSON at ${rel(clientPath)})`);
    } else {
        log(`  Client JSON has ${clientPaths.size} known paths for validation`);
    }

    fs.mkdirSync(DEFAULT_PATHS.outputDir, { recursive: true });

    for (const pdfId of products) {
        await generateForProduct({
            pdfId,
            baseFields,
            catalogs,
            clientPaths,
            outPath: args.out || path.join(DEFAULT_PATHS.outputDir, `${pdfId}.json`),
            embedPdf: !args.noPdfEmbed,
            strategy: args.strategy || 'logical',
            verbose: !!args.verbose
        });
    }
}

async function generateForProduct(opts) {
    const { pdfId, baseFields, catalogs, clientPaths, outPath, embedPdf, strategy, verbose } = opts;
    const meta = KNOWN_PRODUCTS[pdfId];
    if (!meta) {
        console.error(`✗ Unknown product "${pdfId}". Known: ${Object.keys(KNOWN_PRODUCTS).join(', ')}`);
        process.exit(1);
    }

    const pdfPath = path.join(ROOT, 'inputs', meta.pdfFile);
    log(`\n● ${pdfId} (${meta.productName})`);

    // Deep clone to keep base matrix data untouched across products
    let fields = baseFields.map(f => ({
        ...f,
        options: f.options ? f.options.map(o => ({ ...o })) : [],
        productScope: [...f.productScope]
    }));

    // Filter by productScope
    const productKey = {
        '1009052': 'vida_colectiva',
        'D0306':   'vida_universal',
        'D0309':   'proteccion_crediticia'
    }[pdfId];

    fields = fields.filter(f =>
        !productKey || f.productScope.includes('all') || f.productScope.includes(productKey)
    );
    log(`  ${fields.length} fields after productScope filter`);

    // Resolve catalog options
    mergeCatalogs(fields, catalogs);

    // Rule inference
    const ruleResult = applyRules(fields);
    if (verbose && ruleResult.warnings.length) {
        log(`  ⚠ ${ruleResult.warnings.length} rule warnings`);
        for (const w of ruleResult.warnings) {
            console.warn(`    [${w.type}] row ${w.row} (${w.field}): ${w.reason}`);
        }
    } else if (ruleResult.warnings.length) {
        log(`  ⚠ ${ruleResult.warnings.length} rule warnings (use --verbose)`);
    }

    // PDF coordinates
    let pdfBase64;
    if (fs.existsSync(pdfPath)) {
        log(`  Reading PDF: ${rel(pdfPath)}`);
        const pdfData = await parsePdfCoordinates(pdfPath);
        log(`    ${Object.keys(pdfData.fields).length} AcroForm fields, ${pdfData.numPages} pages`);
        const mergeResult = mergePdfCoords(fields, pdfData);
        if (verbose && mergeResult.warnings.length) {
            for (const w of mergeResult.warnings) {
                console.warn(`    [${w.type}] ${w.field}: expected "${w.expectedName}"`);
            }
        }
        if (embedPdf) {
            pdfBase64 = readPdfAsBase64(pdfPath);
        }
    } else {
        log(`  ⚠ PDF not found at ${rel(pdfPath)} — skipping coordinates`);
    }

    // Group into sections and resolve trigger-style conditionals
    const sections = groupBySections(fields, strategy);
    resolveTriggerConditionals(sections);

    // Build final JSON
    const json = buildLovableJson({
        sections,
        pdfId,
        pdfBase64,
        meta,
        catalogs
    });

    // Validate prefill keys
    const issues = validateLovableJson(json, clientPaths);
    if (issues.length) {
        log(`  ⚠ ${issues.length} prefillKey mismatch(es)${verbose ? ':' : ' (use --verbose)'}`);
        if (verbose) {
            for (const i of issues) {
                console.warn(`    • ${i.field} (${i.prefillKey}) — ${i.reason}`);
            }
        }
    }

    // Write output
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
    log(`  ✔ wrote ${rel(outPath)}`);
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

function rel(p) {
    return path.relative(ROOT, p) || p;
}

function log(msg) {
    console.log(msg);
}

if (require.main === module) {
    main().catch(err => {
        console.error('\n✗ Pipeline failed:', err.message);
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
    });
}

module.exports = { main };
