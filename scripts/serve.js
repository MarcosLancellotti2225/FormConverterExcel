#!/usr/bin/env node
/**
 * Minimal static file server for local development of the web UI.
 * No external deps — just uses Node's http and fs.
 *
 * Usage: npm run serve  (then open http://localhost:3000)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');

// Only serve these files — everything else in the repo stays private locally.
const ALLOWED = new Set([
    '/',
    '/index.html',
    '/app.js',
    '/bundle.js',
    '/styles.css',
    '/src/pdf-converter-v2/ui/styles.css',
    '/favicon.ico',
    '/pdf.worker.min.mjs'
]);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon'
};

const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (!ALLOWED.has(reqPath)) {
        res.writeHead(404); return res.end('not found');
    }
    if (reqPath === '/') reqPath = '/index.html';

    const filePath = path.join(ROOT, reqPath);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404); return res.end('not found');
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  ▶ http://localhost:${PORT}\n  serving ${ROOT}\n`);
});
