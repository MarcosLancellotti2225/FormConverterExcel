/**
 * Excel Parser Module
 * Parses specification and catalog Excel files for DocPath Form Builder
 */
const ExcelParser = (() => {
    'use strict';

    // Column matchers - resilient to naming variations
    const COLUMN_MATCHERS = {
        step:      ['paso', 'pasos', 'formulario paso', 'pasos formulario'],
        section:   ['sección', 'seccion', 'seccion '],
        fieldName: ['nombre del campo en formulario', 'campo en formulario', 'nombre del campo'],
        dataType:  ['tipo de dato', 'tipo dato', 'tipo'],
        value:     ['valor'],
        rule:      ['regla'],
        required:  ['obligatorio'],
        variant:   ['formulario a visualizar', 'visualizar'],
        obs:       ['observaciones'],
        jsonPath:  ['nombre del campo en json', 'campo en json', 'json'],
        pdfField:  ['nombre del campo en pdf', 'campo en pdf', 'pdf'],
        notes:     ['notas', 'nota']
    };

    /**
     * Detect file type: 'spec', 'catalog', or 'questions'
     */
    function detectFileType(fileName) {
        const lower = fileName.toLowerCase();
        if (lower.includes('catalogo') || lower.includes('catálogo') || lower.includes('catalog')) {
            return 'catalog';
        }
        if (lower.includes('pregunta') || lower.includes('question') || lower.includes('descripci')) {
            return 'questions';
        }
        return 'spec';
    }

    /**
     * Parse an Excel file (ArrayBuffer) and return structured data
     */
    function parseFile(arrayBuffer, fileName) {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const fileType = detectFileType(fileName);

        if (fileType === 'catalog') {
            return { type: 'catalog', data: parseCatalog(workbook), fileName };
        } else if (fileType === 'questions') {
            return { type: 'questions', data: parseQuestions(workbook), fileName };
        } else {
            return { type: 'spec', data: parseSpec(workbook), fileName };
        }
    }

    /**
     * Parse specification Excel
     */
    function parseSpec(workbook) {
        // Find the main sheet (usually the first or largest one)
        const sheetName = findMainSheet(workbook);
        const sheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rawData.length < 2) {
            throw new Error('El Excel de especificación está vacío o no tiene datos suficientes');
        }

        // Find header row and map columns
        const { headerRow, columnMap } = findColumns(rawData);

        if (!columnMap.fieldName) {
            throw new Error('No se encontró la columna "Nombre del campo" en el Excel');
        }

        // Parse rows into raw fields
        const rawFields = [];
        for (let i = headerRow + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || row.every(cell => cell === '' || cell === null || cell === undefined)) continue;

            const field = {
                step: cleanStr(getCellValue(row, columnMap.step)),
                section: cleanStr(getCellValue(row, columnMap.section)),
                fieldName: cleanStr(getCellValue(row, columnMap.fieldName)),
                dataType: cleanStr(getCellValue(row, columnMap.dataType)),
                value: cleanStr(getCellValue(row, columnMap.value)),
                rule: cleanStr(getCellValue(row, columnMap.rule)),
                required: cleanStr(getCellValue(row, columnMap.required)),
                variant: cleanStr(getCellValue(row, columnMap.variant)),
                obs: cleanStr(getCellValue(row, columnMap.obs)),
                jsonPath: cleanStr(getCellValue(row, columnMap.jsonPath)),
                pdfField: cleanStr(getCellValue(row, columnMap.pdfField)),
                notes: cleanStr(getCellValue(row, columnMap.notes)),
                _rowIndex: i
            };

            // Skip completely empty rows
            if (!field.fieldName && !field.step && !field.value) continue;

            rawFields.push(field);
        }

        // Deduplicate combo/radio options
        const fields = deduplicateOptions(rawFields);

        return {
            sheetName,
            totalRawRows: rawFields.length,
            fields,
            columnMap
        };
    }

    /**
     * Find the main data sheet in the workbook
     */
    function findMainSheet(workbook) {
        const names = workbook.SheetNames;

        // Prefer sheets with "formulario" or "form" in the name
        for (const name of names) {
            const lower = name.toLowerCase();
            if (lower.includes('formulario') || lower.includes('form') || lower.includes('optimizado')) {
                return name;
            }
        }

        // Otherwise pick the sheet with the most rows
        let bestSheet = names[0];
        let bestRows = 0;
        for (const name of names) {
            const sheet = workbook.Sheets[name];
            const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
            const rows = range.e.r - range.s.r + 1;
            if (rows > bestRows) {
                bestRows = rows;
                bestSheet = name;
            }
        }
        return bestSheet;
    }

    /**
     * Find header row and create column index map
     */
    function findColumns(rawData) {
        let headerRow = -1;
        let columnMap = {};

        // Search first 10 rows for the header
        for (let i = 0; i < Math.min(10, rawData.length); i++) {
            const row = rawData[i];
            if (!row) continue;

            const tempMap = {};
            let matchCount = 0;

            for (let j = 0; j < row.length; j++) {
                const cellValue = cleanStr(String(row[j] || '')).toLowerCase();
                if (!cellValue) continue;

                for (const [key, matchers] of Object.entries(COLUMN_MATCHERS)) {
                    if (tempMap[key] !== undefined) continue;
                    for (const matcher of matchers) {
                        if (cellValue.includes(matcher) || matcher.includes(cellValue)) {
                            tempMap[key] = j;
                            matchCount++;
                            break;
                        }
                    }
                }
            }

            if (matchCount >= 3 && tempMap.fieldName !== undefined) {
                headerRow = i;
                columnMap = tempMap;
                break;
            }
        }

        // Fallback: assume first row is header with standard ordering
        if (headerRow === -1) {
            headerRow = 0;
            columnMap = {
                step: 0, section: 1, fieldName: 2, dataType: 3,
                value: 4, rule: 5, required: 6, variant: 7,
                obs: 8, jsonPath: 9, pdfField: 10, notes: 11
            };
        }

        return { headerRow, columnMap };
    }

    /**
     * Deduplicate combo/radio fields by collapsing consecutive rows with same name
     */
    function deduplicateOptions(rawFields) {
        const result = [];
        let i = 0;

        while (i < rawFields.length) {
            const current = rawFields[i];

            // Check if this is a combo/radio field
            const dtype = current.dataType.toLowerCase();
            const isCombo = dtype.includes('combo') || dtype.includes('radio') || dtype.includes('select');

            if (isCombo && current.fieldName) {
                const options = [];
                if (current.value) options.push(current.value);

                // Collect consecutive rows with same field name
                let j = i + 1;
                while (j < rawFields.length) {
                    const next = rawFields[j];
                    const sameField = next.fieldName === current.fieldName ||
                        (!next.fieldName && next.value); // Empty name = continuation

                    const nextType = next.dataType.toLowerCase();
                    const compatibleType = !next.dataType ||
                        nextType.includes('combo') || nextType.includes('radio') || nextType.includes('select');

                    if (sameField && compatibleType && next.value) {
                        options.push(next.value);
                        // Inherit jsonPath from first row if later rows are empty
                        if (!current.jsonPath && next.jsonPath) {
                            current.jsonPath = next.jsonPath;
                        }
                        j++;
                    } else {
                        break;
                    }
                }

                current.options = options;
                current._deduplicatedCount = j - i;
                result.push(current);
                i = j;
            } else {
                result.push(current);
                i++;
            }
        }

        return result;
    }

    /**
     * Parse catalog Excel
     */
    function parseCatalog(workbook) {
        const catalogs = {};

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (data.length === 0) continue;

            const entries = data.map(row => {
                const keys = Object.keys(row);
                return {
                    code: String(row[keys.find(k => k.toLowerCase().includes('codigo') || k.toLowerCase().includes('cod')) || keys[0]] || ''),
                    name: String(row[keys.find(k => k.toLowerCase().includes('nombre') || k.toLowerCase().includes('descripcion') || k.toLowerCase().includes('descripción')) || keys[1] || keys[0]] || ''),
                    extra: row
                };
            });

            catalogs[sheetName] = entries;
        }

        return catalogs;
    }

    /**
     * Parse questions/descriptions Excel
     * Flexible: looks for columns like "pregunta", "descripcion", "campo", "label", "texto"
     */
    function parseQuestions(workbook) {
        const questions = [];

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            if (rawData.length < 2) continue;

            // Find header row
            let headerRow = -1;
            let colMap = {};

            const questionMatchers = ['pregunta', 'question', 'descripcion', 'descripción', 'label', 'texto', 'enunciado'];
            const idMatchers = ['campo', 'field', 'id', 'nombre', 'código', 'codigo', 'clave', 'key'];
            const sectionMatchers = ['sección', 'seccion', 'section', 'grupo', 'paso', 'step'];
            const hintMatchers = ['ayuda', 'hint', 'placeholder', 'ejemplo'];

            for (let i = 0; i < Math.min(10, rawData.length); i++) {
                const row = rawData[i];
                if (!row) continue;
                const tempMap = {};
                let matches = 0;

                for (let j = 0; j < row.length; j++) {
                    const cell = cleanStr(String(row[j] || '')).toLowerCase();
                    if (!cell) continue;

                    if (!tempMap.question && questionMatchers.some(m => cell.includes(m))) {
                        tempMap.question = j; matches++;
                    } else if (!tempMap.fieldId && idMatchers.some(m => cell.includes(m))) {
                        tempMap.fieldId = j; matches++;
                    } else if (!tempMap.section && sectionMatchers.some(m => cell.includes(m))) {
                        tempMap.section = j; matches++;
                    } else if (!tempMap.hint && hintMatchers.some(m => cell.includes(m))) {
                        tempMap.hint = j; matches++;
                    }
                }

                if (matches >= 1 && (tempMap.question !== undefined || tempMap.fieldId !== undefined)) {
                    headerRow = i;
                    colMap = tempMap;
                    break;
                }
            }

            if (headerRow === -1) {
                // Fallback: col 0 = id, col 1 = question
                headerRow = 0;
                colMap = { fieldId: 0, question: 1 };
            }

            for (let i = headerRow + 1; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.every(c => c === '' || c == null)) continue;

                const q = {
                    fieldId: cleanStr(getCellValue(row, colMap.fieldId)),
                    question: cleanStr(getCellValue(row, colMap.question)),
                    section: cleanStr(getCellValue(row, colMap.section)),
                    hint: cleanStr(getCellValue(row, colMap.hint)),
                    _sheet: sheetName,
                    _row: i
                };

                if (q.question || q.fieldId) {
                    questions.push(q);
                }
            }
        }

        return { questions };
    }

    /**
     * Extract field names from a PDF text dump (plain text)
     * Used when a PDF is uploaded and converted to text client-side
     */
    function parsePdfFields(textContent) {
        const fields = [];
        const lines = textContent.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Look for patterns like "Campo: xxx" or field-like identifiers
            // Also capture labels followed by underscores/lines (form field patterns)
            const colonMatch = trimmed.match(/^(.+?):\s*(_+|\.+)?\s*$/);
            if (colonMatch) {
                fields.push({ name: colonMatch[1].trim(), raw: trimmed });
                continue;
            }

            // Lines ending with underscores (fill-in fields)
            const underscoreMatch = trimmed.match(/^(.+?)\s*_{3,}\s*$/);
            if (underscoreMatch) {
                fields.push({ name: underscoreMatch[1].trim(), raw: trimmed });
                continue;
            }

            // Short lines that look like field labels
            if (trimmed.length < 80 && trimmed.length > 2 && !trimmed.includes('.') && /^[A-ZÁÉÍÓÚÑ]/.test(trimmed)) {
                fields.push({ name: trimmed, raw: trimmed });
            }
        }

        return fields;
    }

    // Helpers
    function getCellValue(row, colIndex) {
        if (colIndex === undefined || colIndex === null) return '';
        return row[colIndex] !== undefined ? row[colIndex] : '';
    }

    function cleanStr(val) {
        if (val === null || val === undefined) return '';
        return String(val).trim();
    }

    // Public API
    return {
        detectFileType,
        parseFile,
        parseSpec,
        parseCatalog,
        parseQuestions,
        parsePdfFields
    };
})();
