#!/usr/bin/env node
/**
 * Humo del Visor de Fichas (visor/index.html).
 *
 * La lógica del visor vive adentro de un IIFE en un <script> inline, así que
 * no se puede importar ni testear pieza por pieza desde acá. Lo que sí se
 * puede verificar es lo que rompería la integración sin avisar: que el archivo
 * esté, que su script compile, y que el hub lo enlace.
 *
 * `new Function` COMPILA sin ejecutar: detecta un error de sintaxis —que es lo
 * que dejaría la pantalla en blanco— sin correr el visor ni tocar el DOM.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const VISOR = path.join(ROOT, 'visor', 'index.html');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✔ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✘ ${name}\n    ${err.message}`);
        failed++;
    }
}

/** El <script> grande: el inline sin atributos, no el de type="application/json". */
function scriptDelVisor(html) {
    const re = /<script>([\s\S]*?)<\/script>/g;
    let mejor = '';
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1].length > mejor.length) mejor = m[1];
    }
    return mejor;
}

console.log('\n── visor 2.0 ────────────────────────────');

test('visor/index.html existe y no está vacío', () => {
    assert.ok(fs.existsSync(VISOR), 'falta visor/index.html');
    assert.ok(fs.statSync(VISOR).size > 50000, 'el archivo quedó truncado');
});

const html = fs.existsSync(VISOR) ? fs.readFileSync(VISOR, 'utf8') : '';

test('el script inline compila', () => {
    const code = scriptDelVisor(html);
    assert.ok(code.length > 10000, 'no se encontró el script del visor');
    // Tira SyntaxError si está roto; no ejecuta nada.
    new Function(code);   // eslint-disable-line no-new-func
});

test('arranca vacío: el sample es null', () => {
    assert.match(html, /<script id="sample" type="application\/json">null<\/script>/);
});

test('trae los dos links de vuelta al hub', () => {
    assert.match(html, /href="\.\.\/index\.html"[^>]*>← Form Tools</);
    assert.match(html, /href="\.\.\/index\.html#v2-circuito"/);
});

test('sigue siendo autónomo: sin URLs relativas propias', () => {
    // Todo lo externo sale de CDN. Una ruta relativa nueva significa que el
    // visor dejó de andar como archivo suelto.
    const refs = html.match(/(?:src|href)="(?!https?:|#|\.\.\/)[^"]+"/g) || [];
    assert.deepStrictEqual(refs, [], 'aparecieron rutas relativas: ' + refs.join(', '));
});

test('no se le quitó el soporte de claude.ai', () => {
    // Es el mismo archivo que corre adentro de claude.ai: window.claude tiene
    // que seguir estando o allá deja de guardar.
    assert.match(html, /window\.claude/);
});

const hub = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

test('el hub enlaza el visor desde la tarjeta 2.0', () => {
    assert.match(hub, /data-mode="v2"\s+data-href="visor\/index\.html"/);
});

test('#v2 redirige al visor', () => {
    assert.match(app, /m === 'v2'.*location\.replace\(VISOR_URL\)/s);
    assert.match(app, /VISOR_URL = 'visor\/index\.html'/);
});

test('el circuito anterior sigue en #v2-circuito', () => {
    assert.match(hub, /data-mode="v2-circuito"/);
    assert.match(hub, /<div id="v2Flow"/);
    assert.match(app, /\$\('#v2Flow'\)\.hidden = mode !== 'v2-circuito'/);
});

console.log(`\n── Summary ──────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
