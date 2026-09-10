'use strict';

/**
 * Reporte comercial en Word (.docx real, no HTML renombrado).
 *
 * Arma el OOXML mínimo a mano con JSZip: un docx válido necesita
 * [Content_Types].xml, _rels/.rels, word/document.xml y las relaciones del
 * documento. Se genera así — en vez de un .doc con HTML adentro — para que
 * Word lo abra sin el aviso de "formato distinto" y quede editable.
 *
 * Unidades OOXML: las medidas van en twips (1/20 de punto, 1440 = 1 pulgada)
 * y los tamaños de fuente en medios puntos (28 = 14pt).
 */

var JSZip = require('jszip');

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function semanas(n) { return n === 1 ? '1 semana' : n + ' semanas'; }

var COLORS = {
    baja:  { text: '15803D', bg: 'DCFCE7' },
    media: { text: 'B45309', bg: 'FEF3C7' },
    alta:  { text: 'B91C1C', bg: 'FEE2E2' },
    muted: '64748B',
    dark:  '0F172A',
    line:  'E2E8F0',
    accent:'6366F1',
};

/** Un run de texto con formato. */
function run(text, o) {
    o = o || {};
    var props = '<w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/>';
    if (o.bold) props += '<w:b/>';
    if (o.color) props += '<w:color w:val="' + o.color + '"/>';
    if (o.size) props += '<w:sz w:val="' + o.size + '"/>';
    return '<w:r><w:rPr>' + props + '</w:rPr><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
}

/** Un párrafo con uno o varios runs. */
function para(runs, o) {
    o = o || {};
    var props = '';
    var spacing = '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 120 : o.after) + '"/>';
    props += spacing;
    if (o.align) props += '<w:jc w:val="' + o.align + '"/>';
    if (o.bullet) props += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
    if (o.border) {
        props += '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="2" w:color="' + COLORS.line + '"/></w:pBdr>';
    }
    if (o.shade) props += '<w:shd w:val="clear" w:fill="' + o.shade + '"/>';
    if (o.indent) props += '<w:ind w:left="' + o.indent + '"/>';
    return '<w:p><w:pPr>' + props + '</w:pPr>' + (Array.isArray(runs) ? runs.join('') : runs) + '</w:p>';
}

/** Celda de tabla. */
function cell(content, o) {
    o = o || {};
    var props = '<w:tcW w:w="' + (o.width || 0) + '" w:type="dxa"/>';
    if (o.shade) props += '<w:shd w:val="clear" w:fill="' + o.shade + '"/>';
    props += '<w:vAlign w:val="center"/>';
    props += '<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>' +
             '<w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>';
    return '<w:tc><w:tcPr>' + props + '</w:tcPr>' + content + '</w:tc>';
}

function table(rows, o) {
    o = o || {};
    var borders = o.noBorders
        ? '<w:tblBorders>' +
          '<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>' +
          '<w:right w:val="none"/><w:insideH w:val="single" w:sz="4" w:color="' + COLORS.line + '"/>' +
          '<w:insideV w:val="none"/></w:tblBorders>'
        : '<w:tblBorders>' +
          ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
              return '<w:' + s + ' w:val="single" w:sz="4" w:color="' + COLORS.line + '"/>';
          }).join('') + '</w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + (o.width || 9360) + '" w:type="dxa"/>' +
        borders + '</w:tblPr>' + rows.join('') + '</w:tbl>';
}

var LEVEL_TEXT = {
    baja: 'Formulario acotado. Se resuelve con el circuito estándar, sin desarrollos a medida.',
    media: 'Formulario con volumen de reglas de negocio que requiere configuración y validación cuidadosa.',
    alta: 'Formulario extenso, con muchas reglas y estructuras repetidas. Requiere planificación y pruebas dedicadas.',
};

function buildDocxReport(result, opts) {
    opts = opts || {};
    var t = result.totals || {};
    var score = result.score || {};
    var lk = score.levelKey || 'media';
    var col = COLORS[lk] || COLORS.media;
    var nombre = opts.proyecto || (opts.archivo || 'Formulario')
        .replace(/\.zip$/i, '').replace(/[_-]+/g, ' ');

    var body = '';

    // ── Encabezado ────────────────────────────────────────────────────────────
    body += para(run(nombre, { bold: true, size: 40, color: COLORS.dark }), { after: 40 });
    body += para(run('Estimación de digitalización' + (opts.fecha ? ' · ' + opts.fecha : ''),
        { color: COLORS.muted, size: 18 }), { after: 240 });

    // ── Veredicto ─────────────────────────────────────────────────────────────
    body += table([
        '<w:tr>' +
        cell(para(run('Complejidad ' + (score.level || '').toLowerCase(),
                { bold: true, size: 32, color: col.text }), { after: 0 }),
            { width: 3000, shade: col.bg }) +
        cell(para(run(LEVEL_TEXT[lk] || '', { size: 19, color: '334155' }), { after: 0 }),
            { width: 4400, shade: col.bg }) +
        cell(para(run(semanas(score.weeks != null ? score.weeks : 2),
                { bold: true, size: 24, color: COLORS.dark }), { after: 0, align: 'right' }),
            { width: 1960, shade: col.bg }) +
        '</w:tr>',
    ], { noBorders: true });
    body += para('', { after: 240 });

    // ── Números clave ─────────────────────────────────────────────────────────
    var cards = [
        [String(t.pdfFields || 0), 'Espacios a completar'],
        [String(t.businessRules || 0), 'Reglas de negocio'],
        [String(t.pdfs || 0), 'Documentos'],
        [String(t.catalogs || 0), 'Catálogos'],
    ];
    body += table([
        '<w:tr>' + cards.map(function (c) {
            return cell(
                para(run(c[0], { bold: true, size: 32, color: COLORS.dark }), { after: 0, align: 'center' }) +
                para(run(c[1], { size: 16, color: COLORS.muted }), { after: 0, align: 'center' }),
                { width: 2340, shade: 'F8FAFC' });
        }).join('') + '</w:tr>',
    ]);
    body += para('', { after: 240 });

    // ── Complejidad por formulario ────────────────────────────────────────────
    var documents = result.documents || [];
    if (documents.length) {
        body += para(run('Complejidad por formulario', { bold: true, size: 24, color: COLORS.dark }),
            { before: 120, after: 100, border: true });
        var rows = ['<w:tr>' +
            cell(para(run('Formulario', { bold: true, size: 17, color: COLORS.muted }), { after: 0 }), { width: 4600 }) +
            cell(para(run('Complejidad', { bold: true, size: 17, color: COLORS.muted }), { after: 0, align: 'center' }), { width: 2400 }) +
            cell(para(run('Plazo', { bold: true, size: 17, color: COLORS.muted }), { after: 0, align: 'right' }), { width: 2360 }) +
            '</w:tr>'];
        documents.forEach(function (d) {
            var dc = COLORS[d.levelKey] || COLORS.media;
            rows.push('<w:tr>' +
                cell(para(run(d.file, { bold: true, size: 19, color: COLORS.dark }), { after: 0 }) +
                     para(run(d.fields + ' espacios · ' + plural(d.pages, 'página', 'páginas') +
                        ' · ' + plural(d.businessRules, 'regla', 'reglas'),
                        { size: 15, color: COLORS.muted }), { after: 0 }),
                    { width: 4600 }) +
                cell(para(run(d.level, { bold: true, size: 19, color: dc.text }), { after: 0, align: 'center' }),
                    { width: 2400, shade: dc.bg }) +
                cell(para(run(semanas(d.weeks), { bold: true, size: 19, color: COLORS.dark }), { after: 0, align: 'right' }),
                    { width: 2360 }) +
                '</w:tr>');
        });
        body += table(rows);

        if (documents.length > 1) {
            var suma = documents.reduce(function (s, d) { return s + d.weeks; }, 0);
            body += para('', { after: 120 });
            body += para([
                run('Entrega completa: ', { bold: true, size: 19, color: '78350F' }),
                run('son ' + plural(documents.length, 'formulario', 'formularios') +
                    '. Tomados por separado suman ' + semanas(suma) +
                    ', pero se entregan como un solo paquete: la integración, la consistencia entre versiones y las ' +
                    'pruebas end-to-end hacen que el conjunto se cotice como complejidad ' +
                    (score.level || '').toLowerCase() + ' — ' + semanas(score.weeks) + '.',
                    { size: 19, color: '78350F' }),
            ], { shade: 'FFFBEB', after: 160, indent: 120 });
        }
    }

    // ── Dónde está el esfuerzo ────────────────────────────────────────────────
    var byFile = (result.byFile || []).filter(function (f) { return f.points > 0; }).slice(0, 5);
    if (byFile.length) {
        body += para(run('Dónde está el esfuerzo', { bold: true, size: 24, color: COLORS.dark }),
            { before: 200, after: 100, border: true });
        body += table(byFile.map(function (f) {
            return '<w:tr>' +
                cell(para(run(f.file, { bold: true, size: 18, color: COLORS.dark }), { after: 0 }) +
                     para(run(f.role, { size: 15, color: COLORS.muted }), { after: 0 }), { width: 6000 }) +
                cell(para(run(f.share + '%', { bold: true, size: 20, color: COLORS.accent }), { after: 0, align: 'right' }),
                    { width: 3360 }) +
                '</w:tr>';
        }), { noBorders: true });
    }

    // ── Qué incluye ───────────────────────────────────────────────────────────
    body += para(run('Qué incluye el trabajo', { bold: true, size: 24, color: COLORS.dark }),
        { before: 200, after: 100, border: true });
    var items = [
        'Preparación del PDF: identificación y normalización de los ' + (t.pdfFields || 0) + ' espacios a completar.',
        'Construcción del formulario digital con sus secciones y validaciones.',
        'Implementación de ' + plural(t.businessRules || 0, 'regla de negocio', 'reglas de negocio') +
            (t.conditionalRules ? ', incluidas ' + plural(t.conditionalRules, 'condición de visibilidad', 'condiciones de visibilidad') : '') + '.',
    ];
    if (t.catalogs) items.push('Integración de ' + plural(t.catalogs, 'catálogo', 'catálogos') + ' de datos.');
    if (t.repeaters) items.push('Bloques repetibles (dependientes, beneficiarios y similares).');
    items.push('Pruebas del formulario, del documento generado y del envío de datos.');
    items.forEach(function (it) {
        body += para(run(it, { size: 19, color: '1E293B' }), { bullet: true, after: 60 });
    });

    // ── Reutilización ─────────────────────────────────────────────────────────
    var reuse = result.reuse || {};
    if (reuse.percent > 0) {
        body += para('', { after: 120 });
        body += para([
            run('Aprovechamiento de trabajo previo: ', { bold: true, size: 19, color: '1E3A5F' }),
            run('alrededor del ' + reuse.percent + '% de este formulario ya está resuelto ' +
                '(campos y reglas que se repiten o que comparte con otra versión). Ya está descontado de la estimación.',
                { size: 19, color: '1E3A5F' }),
        ], { shade: 'EFF6FF', after: 160, indent: 120 });
    }

    // ── Pie ───────────────────────────────────────────────────────────────────
    body += para(run('Estimación preliminar basada en el análisis automático de los archivos entregados. ' +
        'Puede ajustarse si cambian los requerimientos o si la documentación se completa.',
        { size: 15, color: '94A3B8' }), { before: 320 });

    var documentXml =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
'<w:body>' + body +
'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
'<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>' +
'</w:sectPr></w:body></w:document>';

    // Numeración para las viñetas.
    var numberingXml =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
'<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
'<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
'<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
'<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>' +
'<w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:hint="default"/></w:rPr>' +
'</w:lvl></w:abstractNum>' +
'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
'</w:numbering>';

    var contentTypes =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
'<Default Extension="xml" ContentType="application/xml"/>' +
'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
'<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
'</Types>';

    var rootRels =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
'</Relationships>';

    var docRels =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
'</Relationships>';

    var zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    var word = zip.folder('word');
    word.file('document.xml', documentXml);
    word.file('numbering.xml', numberingXml);
    word.folder('_rels').file('document.xml.rels', docRels);

    return zip.generateAsync({ type: 'uint8array', mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

module.exports = { buildDocxReport };
