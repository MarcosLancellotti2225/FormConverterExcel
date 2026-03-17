/**
 * PDF Analyzer Module
 * Extracts form structure from a PDF — both AcroForm fields and text-based field detection
 * Produces spec-compatible data so FieldManager can consume it directly
 */
const PdfAnalyzer = (() => {
    'use strict';

    /**
     * Analyze a PDF file and extract form field definitions
     * @param {File} file - PDF file object
     * @returns {Object} spec-compatible data { sheetName, totalRawRows, fields, columnMap }
     */
    async function analyze(file) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Extract both AcroForm fields and text-layout fields
        const acroFields = await extractAcroFormFields(pdf);
        const textFields = await extractTextFields(pdf);

        // Merge: AcroForm fields take priority, text fills gaps
        const merged = mergeFields(acroFields, textFields);

        // Organize into steps/sections
        const organized = organizeIntoSteps(merged);

        return {
            sheetName: file.name,
            totalRawRows: organized.length,
            fields: organized,
            columnMap: {},
            _source: 'pdf'
        };
    }

    /**
     * Extract native AcroForm fields from the PDF
     */
    async function extractAcroFormFields(pdf) {
        const fields = [];

        try {
            // pdf.js exposes form fields via getFieldObjects()
            const fieldObjects = await pdf.getFieldObjects();
            if (!fieldObjects) return fields;

            for (const [name, fieldList] of Object.entries(fieldObjects)) {
                if (!fieldList || fieldList.length === 0) continue;
                const f = fieldList[0]; // first instance

                const field = {
                    fieldName: cleanFieldName(name),
                    pdfField: name,
                    dataType: mapPdfFieldType(f.type),
                    value: f.value || '',
                    options: [],
                    required: f.required || false,
                    _source: 'acroform',
                    _page: f.page != null ? f.page + 1 : 1,
                    _rect: f.rect || null
                };

                // Extract options for combo/list fields
                if (f.options && f.options.length > 0) {
                    field.options = f.options.map(o =>
                        typeof o === 'object' ? (o.displayValue || o.exportValue || '') : String(o)
                    ).filter(Boolean);
                    if (field.dataType === 'text') {
                        field.dataType = 'select';
                    }
                }

                // Radio/checkbox special handling
                if (f.type === 'radiobutton') {
                    field.dataType = 'radio';
                    // Collect all export values for this radio group
                    const opts = fieldList.map(ff => ff.exportValue || ff.buttonValue || '').filter(Boolean);
                    if (opts.length > 0) field.options = [...new Set(opts)];
                }

                if (f.type === 'checkbox') {
                    field.dataType = 'checkbox';
                    field.value = f.exportValue || 'on';
                }

                fields.push(field);
            }
        } catch (e) {
            console.warn('Could not extract AcroForm fields:', e);
        }

        return fields;
    }

    /**
     * Extract fields by analyzing text layout on each page
     */
    async function extractTextFields(pdf) {
        const fields = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            const annotations = await page.getAnnotations();
            const viewport = page.getViewport({ scale: 1.0 });
            const pageHeight = viewport.height;

            // Sort items by Y position (top to bottom), then X (left to right)
            const items = content.items
                .filter(item => item.str && item.str.trim())
                .map(item => ({
                    text: item.str.trim(),
                    x: item.transform[4],
                    y: pageHeight - item.transform[5], // flip Y
                    width: item.width,
                    height: item.height,
                    fontSize: Math.abs(item.transform[0]) || 12,
                    page: pageNum
                }))
                .sort((a, b) => a.y - b.y || a.x - b.x);

            // Detect sections (large/bold text) and fields (label patterns)
            let currentSection = '';

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const text = item.text;

                // Section headers: larger font or all caps or ending with ":"
                if (isSectionHeader(item, items)) {
                    currentSection = text.replace(/:$/, '').trim();
                    continue;
                }

                // Field labels: text followed by a colon, or short text near a form annotation
                if (isFieldLabel(item, items, annotations, i)) {
                    const label = text.replace(/:$/, '').trim();
                    if (label.length < 3 || label.length > 120) continue;

                    // Try to determine type from context
                    const inferredType = inferFieldType(label, items, i);

                    fields.push({
                        fieldName: label,
                        pdfField: '',
                        dataType: inferredType.type,
                        value: '',
                        options: inferredType.options || [],
                        required: false,
                        section: currentSection,
                        _source: 'text',
                        _page: pageNum,
                        _y: item.y
                    });
                }
            }
        }

        return fields;
    }

    /**
     * Detect if a text item is a section header
     */
    function isSectionHeader(item, allItems) {
        // Significantly larger font than average
        const avgFontSize = allItems.reduce((s, i) => s + i.fontSize, 0) / allItems.length;
        if (item.fontSize > avgFontSize * 1.3) return true;

        // All uppercase and short
        const text = item.text;
        if (text.length < 50 && text === text.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3,}/.test(text)) return true;

        // Numbered section pattern: "1.", "I.", "A."
        if (/^\d+\.\s+\w/.test(text) || /^[IVX]+\.\s+\w/.test(text)) return true;

        return false;
    }

    /**
     * Detect if a text item is a field label
     */
    function isFieldLabel(item, allItems, annotations, idx) {
        const text = item.text;

        // Ends with colon → very likely a label
        if (text.endsWith(':')) return true;

        // Short text that looks like a label (Title Case or specific patterns)
        if (text.length < 60 && text.length > 2) {
            // Check if there's a form annotation nearby
            const hasNearbyAnnotation = annotations.some(ann => {
                if (!ann.rect) return false;
                const annY = ann.rect[1];
                return Math.abs(annY - item.y) < 30;
            });
            if (hasNearbyAnnotation) return true;

            // Common field label patterns
            const labelPatterns = [
                /^(nombre|apellido|fecha|direcci[oó]n|tel[eé]fono|correo|email|c[eé]dula|n[uú]mero)/i,
                /^(provincia|cant[oó]n|distrito|pa[ií]s|sexo|g[eé]nero|estado|tipo)/i,
                /^(observacion|comentario|nota|descripci[oó]n)/i,
                /^(monto|salario|prima|deducible|cobertura|p[oó]liza)/i,
                /^(ocupaci[oó]n|profesi[oó]n|actividad|empresa|patrono)/i,
                /\?$/ // Questions
            ];
            if (labelPatterns.some(p => p.test(text))) return true;

            // Text followed by underscores or dots on the same line
            const nextItem = allItems[idx + 1];
            if (nextItem && Math.abs(nextItem.y - item.y) < 5) {
                if (/^[_\.]{3,}/.test(nextItem.text)) return true;
            }
        }

        return false;
    }

    /**
     * Infer field type from its label text
     */
    function inferFieldType(label, items, idx) {
        const lower = label.toLowerCase();

        // Date fields
        if (/fecha|nacimiento|vencimiento|emisi[oó]n|ingreso/.test(lower)) {
            return { type: 'date' };
        }

        // Email
        if (/correo|email|e-mail/.test(lower)) {
            return { type: 'text' }; // format email handled by validation
        }

        // Yes/No fields
        if (/\?$/.test(label) || /padece|tiene|posee|consume|practica|ha sido|ha tenido/.test(lower)) {
            return { type: 'radio', options: ['Si', 'No'] };
        }

        // Select fields (common dropdowns)
        if (/^(provincia|cant[oó]n|distrito|pa[ií]s|estado civil|sexo|g[eé]nero|tipo de|moneda|parentesco)/.test(lower)) {
            return { type: 'select', options: [] };
        }

        // Numeric fields
        if (/^(n[uú]mero|c[eé]dula|tel[eé]fono|monto|salario|peso|estatura|edad|a[nñ]os)/.test(lower)) {
            return { type: 'text' }; // with numeric rule
        }

        return { type: 'text' };
    }

    /**
     * Merge AcroForm fields with text-detected fields
     * AcroForm takes priority; text fields fill gaps
     */
    function mergeFields(acroFields, textFields) {
        if (acroFields.length === 0) return textFields;
        if (textFields.length === 0) return acroFields;

        const merged = [...acroFields];
        const acroNames = new Set(acroFields.map(f => normalize(f.fieldName)));

        for (const tf of textFields) {
            const tfNorm = normalize(tf.fieldName);
            // Only add text fields that don't overlap with AcroForm fields
            const isDuplicate = acroNames.has(tfNorm) ||
                [...acroNames].some(an => similarity(an, tfNorm) > 0.7);

            if (!isDuplicate) {
                merged.push(tf);
            } else {
                // Enrich the AcroForm field with section info from text
                if (tf.section) {
                    const acro = merged.find(f => similarity(normalize(f.fieldName), tfNorm) > 0.7);
                    if (acro && !acro.section) {
                        acro.section = tf.section;
                    }
                }
            }
        }

        // Sort by page then Y position
        merged.sort((a, b) => (a._page || 1) - (b._page || 1) || (a._y || 0) - (b._y || 0));

        return merged;
    }

    /**
     * Organize flat fields into step/section structure
     */
    function organizeIntoSteps(fields) {
        // Group by page → step
        const pageGroups = new Map();
        for (const f of fields) {
            const page = f._page || 1;
            if (!pageGroups.has(page)) pageGroups.set(page, []);
            pageGroups.get(page).push(f);
        }

        const organized = [];
        let stepNum = 0;

        for (const [page, pageFields] of pageGroups) {
            stepNum++;
            const stepName = pageFields.length > 0 && pageFields[0].section
                ? pageFields[0].section
                : `Página ${page}`;

            let currentSection = '';

            for (const f of pageFields) {
                const section = f.section || currentSection || 'Datos';
                if (f.section) currentSection = f.section;

                organized.push({
                    step: stepName,
                    section: section,
                    fieldName: f.fieldName,
                    dataType: f.dataType || 'text',
                    value: f.value || '',
                    rule: '',
                    required: f.required ? 'Si' : '',
                    variant: '',
                    obs: f._source === 'acroform' ? 'Campo PDF nativo' : 'Detectado del texto',
                    jsonPath: '',
                    pdfField: f.pdfField || '',
                    notes: '',
                    options: f.options || [],
                    _rowIndex: organized.length
                });
            }
        }

        return organized;
    }

    // === Helpers ===

    function cleanFieldName(pdfName) {
        // PDF field names often look like "form1[0].page1[0].nombre_asegurado[0]"
        // Extract the meaningful part
        let name = pdfName;

        // Remove XFA-style paths
        const lastDot = name.lastIndexOf('.');
        if (lastDot >= 0) name = name.substring(lastDot + 1);

        // Remove array indices
        name = name.replace(/\[\d+\]/g, '');

        // Convert underscores/camelCase to spaces
        name = name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

        // Title case
        name = name.replace(/\b\w/g, c => c.toUpperCase()).trim();

        return name || pdfName;
    }

    function mapPdfFieldType(pdfType) {
        const map = {
            'text': 'text',
            'combobox': 'select',
            'listbox': 'select',
            'radiobutton': 'radio',
            'checkbox': 'checkbox',
            'pushbutton': null,
            'signature': null
        };
        return map[pdfType] || 'text';
    }

    function normalize(str) {
        if (!str) return '';
        return String(str).toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function similarity(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        const biA = bigrams(a);
        const biB = bigrams(b);
        let intersection = 0;
        for (const [bi, count] of biA) {
            if (biB.has(bi)) intersection += Math.min(count, biB.get(bi));
        }
        const total = (a.length - 1) + (b.length - 1);
        return total === 0 ? 0 : (2 * intersection) / total;
    }

    function bigrams(str) {
        const set = new Map();
        for (let i = 0; i < str.length - 1; i++) {
            const bi = str.substring(i, i + 2);
            set.set(bi, (set.get(bi) || 0) + 1);
        }
        return set;
    }

    return { analyze };
})();
