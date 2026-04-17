#!/usr/bin/env node
/**
 * CLI — INS Lovable JSON Generator (Node entry point)
 *
 * Usage:
 *   node src/index.js --pdf=1009052.pdf --out=outputs/1009052.json
 *   node src/index.js --all
 *   node src/index.js --pdf=D0306.pdf --no-pdf-embed --verbose
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { runPipelineAll } = require('./pipeline');

const ROOT = path.resolve(__dirname, '..');

const DEFAULT_PATHS = {
    matrix:    path.join(ROOT, 'inputs', 'Matriz_Formularios_VidaColectiva_Secciones.xlsx'),
    catalogs:  path.join(ROOT, 'inputs', 'Catalogos_Formularios_INS_Namirial_-_Vida.xlsx'),
    client:    path.join(ROOT, 'inputs', 'Json_Formulario_Vida_-_Asegurado.txt'),
    pdfsDir:   path.join(ROOT, 'inputs'),
    outputDir: path.join(ROOT, 'outputs')
};

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const matrixPath   = args.matrix   || DEFAULT_PATHS.matrix;
    const catalogsPath = args.catalogs || DEFAULT_PATHS.catalogs;
    const clientPath   = args.client   || DEFAULT_PATHS.client;
    const pdfsDir      = args.pdfsDir  || DEFAULT_PATHS.pdfsDir;

    if (!fs.existsSync(matrixPath)) throw new Error(`Matrix not found: ${matrixPath}`);

    log(`→ Reading matrix:   ${rel(matrixPath)}`);
    const matrixBuffer = fs.readFileSync(matrixPath);

    let catalogsBuffer = null;
    if (fs.existsSync(catalogsPath)) {
        log(`→ Reading catalogs: ${rel(catalogsPath)}`);
        catalogsBuffer = fs.readFileSync(catalogsPath);
    } else {
        log(`  (catalogs optional — none found at ${rel(catalogsPath)})`);
    }

    const clientJsonText = fs.existsSync(clientPath)
        ? fs.readFileSync(clientPath, 'utf-8')
        : null;
    if (!clientJsonText) {
        log(`  (prefillKey validation disabled — no client JSON at ${rel(clientPath)})`);
    }

    // Build pdfMap from --pdf=<file> or --all (scan inputs/ for *.pdf)
    const pdfMap = {};

    if (args.all) {
        const pdfFiles = fs.readdirSync(pdfsDir).filter(f => /\.pdf$/i.test(f));
        log(`→ Found ${pdfFiles.length} PDF(s) in ${rel(pdfsDir)}`);
        for (const f of pdfFiles) {
            const code = f.replace(/\.pdf$/i, '');
            const fullPath = path.join(pdfsDir, f);
            pdfMap[code] = { buffer: fs.readFileSync(fullPath), fileName: f };
        }
    } else if (args.pdf) {
        const pdfPath = path.isAbsolute(args.pdf) ? args.pdf : path.join(pdfsDir, args.pdf);
        const fileName = path.basename(pdfPath);
        const code = fileName.replace(/\.pdf$/i, '');
        if (fs.existsSync(pdfPath)) {
            log(`→ Reading PDF: ${rel(pdfPath)}`);
            pdfMap[code] = { buffer: fs.readFileSync(pdfPath), fileName };
        } else {
            log(`  ⚠ PDF not found: ${rel(pdfPath)} — running without coordinates`);
            pdfMap[code] = { buffer: null, fileName };
        }
    }

    if (!args.all && !args.pdf) {
        console.error('✗ Specify --pdf=<file> or --all');
        printUsage();
        process.exit(1);
    }

    fs.mkdirSync(DEFAULT_PATHS.outputDir, { recursive: true });

    const options = {
        embedPdf: !args.noPdfEmbed,
        strategy: args.strategy || 'pdf_page'
    };

    const { results, hasFormCodeColumn } = await runPipelineAll({
        matrixBuffer,
        catalogsBuffer,
        pdfMap,
        clientJsonText
    }, options);

    if (!hasFormCodeColumn) {
        log(`  ⚠ No "Código Formulario" column found — all matrix rows used for every PDF.`);
    }

    for (const r of results) {
        const sections = r.json.data?.jsonDefinition?.sections || [];
        const fieldCount = sections.reduce((n, s) => n + s.fields.length, 0);
        log(`\n● ${r.formCode}`);
        log(`  ${fieldCount} fields across ${sections.length} sections`);

        if (r.warnings.length) {
            log(`  ⚠ ${r.warnings.length} warnings${args.verbose ? ':' : ' (use --verbose)'}`);
            if (args.verbose) {
                for (const w of r.warnings) console.warn(`    [${w.stage}:${w.type}]`, w.reason || w);
            }
        }
        if (r.issues.length) {
            log(`  ⚠ ${r.issues.length} prefillKey mismatch(es)${args.verbose ? ':' : ''}`);
            if (args.verbose) {
                for (const i of r.issues) console.warn(`    • ${i.field} (${i.prefillKey}) — ${i.reason}`);
            }
        }

        const outPath = args.out || path.join(DEFAULT_PATHS.outputDir, `${r.formCode}.json`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(r.json, null, 2));
        log(`  ✔ wrote ${rel(outPath)}`);
    }

    log(`\n✔ ${results.length} JSON(s) generated.`);
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
  node src/index.js --pdf=1009052.pdf
  node src/index.js --all
  node src/index.js --pdf=D0306.pdf --no-pdf-embed --verbose

Options:
  --matrix=<path>     Path to matrix xlsx (default: inputs/Matriz_...xlsx)
  --catalogs=<path>   Path to catalogs xlsx (optional)
  --client=<path>     Path to client JSON (optional)
  --pdfs-dir=<path>   Directory containing PDFs (default: inputs/)
  --strategy=<s>      Section strategy: pdf_page (default) | logical
  --verbose           Show detailed warnings
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
