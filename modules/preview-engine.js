/**
 * Preview Engine Module
 * Manages the iframe preview and code views
 */
const PreviewEngine = (() => {
    'use strict';

    let _iframe = null;
    let _generatedHtml = '';
    let _generatedJson = '';

    function init(iframeEl) {
        _iframe = iframeEl;
    }

    /**
     * Render the form preview in the iframe
     */
    function render(fields, options = {}) {
        const conditionals = FieldManager.detectConditionals();

        _generatedHtml = HtmlGenerator.generate(fields, {
            title: options.title || 'Formulario INS',
            conditionals
        });

        _generatedJson = JsonGenerator.generateString(fields);

        // Write to iframe
        if (_iframe) {
            const doc = _iframe.contentDocument || _iframe.contentWindow.document;
            doc.open();
            doc.write(_generatedHtml);
            doc.close();
        }

        // Update code views
        const jsonView = document.getElementById('jsonView');
        const htmlView = document.getElementById('htmlView');

        if (jsonView) {
            jsonView.textContent = _generatedJson;
        }
        if (htmlView) {
            htmlView.textContent = _generatedHtml;
        }
    }

    function getHtml() {
        return _generatedHtml;
    }

    function getJson() {
        return _generatedJson;
    }

    /**
     * Download generated HTML as file
     */
    function downloadHtml(fileName) {
        const blob = new Blob([_generatedHtml], { type: 'text/html;charset=utf-8' });
        downloadBlob(blob, fileName || 'formulario.html');
    }

    /**
     * Download generated JSON as file
     */
    function downloadJson(fileName) {
        const blob = new Blob([_generatedJson], { type: 'application/json;charset=utf-8' });
        downloadBlob(blob, fileName || 'schema.json');
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return {
        init,
        render,
        getHtml,
        getJson,
        downloadHtml,
        downloadJson
    };
})();
