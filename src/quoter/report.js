'use strict';

/**
 * Reporte comercial de una cotización.
 *
 * Una página, pensada para mandar a alguien que no va a leer puntajes ni pesos:
 * qué es el proyecto, qué complejidad tiene, cuánto lleva y dónde está el
 * esfuerzo. Los números técnicos (score, umbrales, desglose) quedan afuera a
 * propósito — para eso está el informe JSON.
 *
 * Devuelve un HTML autocontenido (sin assets externos) listo para abrir,
 * mandar por mail o imprimir a PDF.
 */

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

// Traduce el nivel a una frase que se entienda sin contexto técnico.
var LEVEL_COPY = {
    baja: {
        titulo: 'Complejidad baja',
        frase: 'Formulario acotado. Se resuelve con el circuito estándar, sin desarrollos a medida.',
        color: '#15803d', bg: '#dcfce7',
    },
    media: {
        titulo: 'Complejidad media',
        frase: 'Formulario con volumen de reglas de negocio que requiere configuración y validación cuidadosa.',
        color: '#b45309', bg: '#fef3c7',
    },
    alta: {
        titulo: 'Complejidad alta',
        frase: 'Formulario extenso, con muchas reglas y estructuras repetidas. Requiere planificación y pruebas dedicadas.',
        color: '#b91c1c', bg: '#fee2e2',
    },
};

function semanas(n) { return n === 1 ? '1 semana' : n + ' semanas'; }

// Pastilla de nivel con el color del nivel.
function pill(levelKey, texto) {
    var c = LEVEL_COPY[levelKey] || LEVEL_COPY.media;
    return '<span class="pill" style="color:' + c.color + ';background:' + c.bg + '">' + esc(texto) + '</span>';
}

function statCard(valor, etiqueta, nota) {
    return '<div class="card">' +
        '<div class="num">' + esc(valor) + '</div>' +
        '<div class="lbl">' + esc(etiqueta) + '</div>' +
        (nota ? '<div class="sub">' + esc(nota) + '</div>' : '') +
        '</div>';
}

/**
 * @param {Object} result - salida de analyzeZip
 * @param {Object} [opts] - { proyecto, archivo, fecha, autor }
 */
function buildCommercialReport(result, opts) {
    opts = opts || {};
    var t = result.totals || {};
    var score = result.score || {};
    var copy = LEVEL_COPY[score.levelKey] || LEVEL_COPY.media;

    var nombre = opts.proyecto || (opts.archivo || 'Formulario')
        .replace(/\.zip$/i, '').replace(/[_-]+/g, ' ');
    var fecha = opts.fecha || '';

    // ── Dónde está el esfuerzo: los archivos que más pesan ────────────────────
    var byFile = (result.byFile || []).filter(function (f) { return f.points > 0; });
    var barras = byFile.slice(0, 5).map(function (f) {
        return '<tr>' +
            '<td class="fname">' + esc(f.file) + '<span class="role">' + esc(f.role) + '</span></td>' +
            '<td class="bar-cell">' +
                '<div class="bar"><span style="width:' + Math.max(3, Math.min(100, f.share)) + '%"></span></div>' +
            '</td>' +
            '<td class="pct">' + f.share + '%</td>' +
            '</tr>';
    }).join('');

    // ── Complejidad documento por documento ───────────────────────────────────
    // Cada formulario se evalúa con las reglas de negocio que le corresponden,
    // no con el PDF pelado: la entrega completa puede pesar más que sus partes.
    var documents = result.documents || [];
    var docRows = documents.map(function (d) {
        return '<tr>' +
            '<td class="fname">' + esc(d.file) +
                '<span class="role">' + d.fields + ' espacios · ' + plural(d.pages, 'página', 'páginas') +
                ' · ' + plural(d.businessRules, 'regla', 'reglas') + '</span></td>' +
            '<td class="lvl-cell">' + pill(d.levelKey, d.level) + '</td>' +
            '<td class="wk">' + esc(semanas(d.weeks)) + '</td>' +
            '</tr>';
    }).join('');

    // Frase que explica por qué el conjunto puede subir de nivel.
    var conjunto = '';
    if (documents.length > 1) {
        var suma = documents.reduce(function (s, d) { return s + d.weeks; }, 0);
        var distinto = documents.some(function (d) { return d.levelKey !== score.levelKey; });
        conjunto = '<div class="note ' + (distinto ? 'warn' : 'ok') + '">' +
            '<b>Entrega completa:</b> son ' + plural(documents.length, 'formulario', 'formularios') +
            '. Tomados por separado suman ' + esc(semanas(suma)) + ', pero se entregan como un solo paquete: ' +
            'la integración, la consistencia entre versiones y las pruebas end-to-end hacen que el conjunto se cotice como <b>' +
            esc(copy.titulo.toLowerCase()) + '</b> — <b>' + esc(semanas(score.weeks)) + '</b>.' +
            '</div>';
    }

    // ── Reutilización, solo si hay algo que decir ─────────────────────────────
    var reuse = result.reuse || {};
    var ahorroBloque = '';
    if (reuse.percent > 0) {
        ahorroBloque =
            '<div class="note ok">' +
            '<b>Aprovechamiento de trabajo previo:</b> alrededor del <b>' + reuse.percent + '%</b> ' +
            'de este formulario ya está resuelto (campos y reglas que se repiten o que comparte con otra versión). ' +
            'Eso ya está descontado de la estimación.' +
            '</div>';
    }

    var plazo = semanas(score.weeks != null ? score.weeks : 2);

    return '<!doctype html>\n<html lang="es"><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>' + esc(nombre) + ' — Estimación</title><style>' +
'*{box-sizing:border-box}' +
'body{margin:0;background:#f1f5f9;color:#0f172a;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.6}' +
'.sheet{max-width:820px;margin:32px auto;background:#fff;border-radius:14px;padding:44px 48px;box-shadow:0 4px 24px rgba(15,23,42,.08)}' +
'h1{font-size:1.55rem;margin:0 0 4px;letter-spacing:-.02em}' +
'.meta{color:#64748b;font-size:.86rem;margin-bottom:28px}' +
'.verdict{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:22px 24px;border-radius:12px;background:' + copy.bg + ';margin-bottom:28px}' +
'.verdict .lvl{font-size:1.5rem;font-weight:700;color:' + copy.color + ';white-space:nowrap}' +
'.verdict .txt{flex:1;min-width:240px;font-size:.95rem;color:#334155}' +
'.verdict .hrs{font-size:1.05rem;font-weight:700;color:#0f172a;white-space:nowrap}' +
'.verdict .hrs small{display:block;font-weight:400;font-size:.74rem;color:#64748b;text-align:right}' +
'.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:32px}' +
'@media(max-width:640px){.cards{grid-template-columns:repeat(2,1fr)}}' +
'.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}' +
'.card .num{font-size:1.6rem;font-weight:700;letter-spacing:-.02em}' +
'.card .lbl{font-size:.78rem;color:#475569;margin-top:2px}' +
'.card .sub{font-size:.7rem;color:#94a3b8;margin-top:3px}' +
'h2{font-size:1rem;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0}' +
'ul{margin:0;padding-left:20px;font-size:.92rem}li{margin-bottom:5px}' +
'table{width:100%;border-collapse:collapse;font-size:.88rem}' +
'td{padding:7px 0;vertical-align:middle}' +
'.fname{font-weight:600;width:45%}' +
'.role{display:block;font-weight:400;font-size:.74rem;color:#94a3b8}' +
'.bar{background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden}' +
'.bar span{display:block;height:100%;background:#6366f1;border-radius:4px}' +
'.bar-cell{padding-right:14px}' +
'.pct{text-align:right;width:52px;color:#475569;font-variant-numeric:tabular-nums}' +
'.note{padding:13px 16px;border-radius:9px;font-size:.88rem;margin-top:18px}' +
'.note.ok{background:#eff6ff;border-left:4px solid #3b82f6;color:#1e3a5f}' +
'.note.warn{background:#fffbeb;border-left:4px solid #f59e0b;color:#78350f}' +
'.pill{display:inline-block;padding:2px 11px;border-radius:99px;font-size:.8rem;font-weight:700}' +
'table.docs td{border-bottom:1px solid #f1f5f9;padding:10px 0}' +
'.lvl-cell{text-align:center;width:110px}' +
'.wk{text-align:right;width:110px;font-weight:600;color:#334155}' +
'.foot{margin-top:34px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.76rem;color:#94a3b8}' +
'@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:0}}' +
'</style></head><body><div class="sheet">' +

'<h1>' + esc(nombre) + '</h1>' +
'<div class="meta">Estimación de digitalización' + (fecha ? ' · ' + esc(fecha) : '') + '</div>' +

'<div class="verdict">' +
    '<div class="lvl">' + esc(copy.titulo) + '</div>' +
    '<div class="txt">' + esc(copy.frase) + '</div>' +
    '<div class="hrs">' + esc(plazo) + '<small>estimado</small></div>' +
'</div>' +

'<div class="cards">' +
    statCard(t.pdfFields || 0, 'Espacios a completar', 'en el formulario') +
    statCard(t.businessRules || 0, 'Reglas de negocio', 'validaciones y cálculos') +
    statCard((t.pdfs || 0), 'Documentos', plural(t.pages || 0, 'página', 'páginas')) +
    statCard(t.catalogs || 0, 'Catálogos', 'listas a integrar') +
'</div>' +

(docRows ? '<h2>Complejidad por formulario</h2><table class="docs">' + docRows + '</table>' + conjunto : '') +

(barras ? '<h2>Dónde está el esfuerzo</h2><table>' + barras + '</table>' : '') +

'<h2>Qué incluye el trabajo</h2><ul>' +
    '<li>Preparación del PDF: identificación y normalización de los ' + (t.pdfFields || 0) + ' espacios a completar.</li>' +
    '<li>Construcción del formulario digital con sus secciones y validaciones.</li>' +
    '<li>Implementación de ' + plural(t.businessRules || 0, 'regla de negocio', 'reglas de negocio') +
        (t.conditionalRules ? ', incluidas ' + plural(t.conditionalRules, 'condición de visibilidad', 'condiciones de visibilidad') : '') + '.</li>' +
    (t.catalogs ? '<li>Integración de ' + plural(t.catalogs, 'catálogo', 'catálogos') + ' de datos.</li>' : '') +
    (t.repeaters ? '<li>Bloques repetibles (dependientes, beneficiarios y similares).</li>' : '') +
    '<li>Pruebas del formulario, del documento generado y del envío de datos.</li>' +
'</ul>' +

ahorroBloque +

'<div class="foot">Estimación preliminar basada en el análisis automático de los archivos entregados. ' +
'Puede ajustarse si cambian los requerimientos o si la documentación se completa.</div>' +

'</div></body></html>';
}

module.exports = { buildCommercialReport };
