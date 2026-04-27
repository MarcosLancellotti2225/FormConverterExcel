'use strict';

function parseAmbiguous(nombrePDF) {
    const segments = nombrePDF.split(/\s*\/\s*/);
    const result = [];

    for (const segment of segments) {
        const match = segment.match(/^(.+?):\s*(.+)$/);
        if (!match) {
            result.push({ formularios: [], nombrePDF: segment.trim() });
            continue;
        }
        const formsRaw = match[1].trim();
        const name = match[2].trim();
        const forms = parseFormulariosFromText(formsRaw);
        result.push({ formularios: forms, nombrePDF: name });
    }
    return result;
}

function parseFormulariosFromText(text) {
    const forms = [];
    if (/Vida\s+Colectiva/i.test(text)) forms.push('VC');
    if (/Vida\s+Universal/i.test(text)) forms.push('VU');
    if (/Protecci[oó]n\s+Crediticia/i.test(text)) forms.push('PC');
    return forms;
}

module.exports = { parseAmbiguous, parseFormulariosFromText };
