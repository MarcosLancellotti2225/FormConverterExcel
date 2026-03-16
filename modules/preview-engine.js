/**
 * Preview Engine Module
 * Manages the iframe preview, editable code views, and sync
 */
const PreviewEngine = (() => {
    'use strict';

    let _iframe = null;
    let _generatedHtml = '';
    let _generatedJson = '';
    let _htmlEditor = null;
    let _jsonEditor = null;
    let _htmlDirty = false;
    let _jsonDirty = false;

    function init(iframeEl) {
        _iframe = iframeEl;
        _htmlEditor = document.getElementById('htmlView');
        _jsonEditor = document.getElementById('jsonView');

        // Track modifications
        if (_htmlEditor) {
            _htmlEditor.addEventListener('input', () => {
                _htmlDirty = true;
                _htmlEditor.classList.add('modified');
                _updateStatus('html');
                _showApplyButton('html', true);
                _updateLineNumbers('html');
            });
            _htmlEditor.addEventListener('scroll', () => _syncLineScroll('html'));
            _htmlEditor.addEventListener('keydown', handleEditorKeydown);
        }

        if (_jsonEditor) {
            _jsonEditor.addEventListener('input', () => {
                _jsonDirty = true;
                _jsonEditor.classList.add('modified');
                _updateStatus('json');
                _showApplyButton('json', true);
                _updateLineNumbers('json');
            });
            _jsonEditor.addEventListener('scroll', () => _syncLineScroll('json'));
            _jsonEditor.addEventListener('keydown', handleEditorKeydown);
        }

        // Apply buttons
        const btnApplyHtml = document.getElementById('btnApplyHtml');
        const btnApplyJson = document.getElementById('btnApplyJson');
        if (btnApplyHtml) btnApplyHtml.addEventListener('click', applyHtmlChanges);
        if (btnApplyJson) btnApplyJson.addEventListener('click', applyJsonChanges);
    }

    /**
     * Handle Tab key for indentation in editors
     */
    function handleEditorKeydown(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const textarea = e.target;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            textarea.dispatchEvent(new Event('input'));
        }
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
        _writeToIframe(_generatedHtml);

        // Update editors
        if (_htmlEditor) {
            _htmlEditor.value = _generatedHtml;
            _htmlEditor.classList.remove('modified');
            _htmlDirty = false;
            _updateLineNumbers('html');
        }
        if (_jsonEditor) {
            _jsonEditor.value = _generatedJson;
            _jsonEditor.classList.remove('modified');
            _jsonDirty = false;
            _updateLineNumbers('json');
        }

        _showApplyButton('html', false);
        _showApplyButton('json', false);
        _setStatus('');
    }

    /**
     * Apply edited HTML to the preview iframe
     */
    function applyHtmlChanges() {
        if (!_htmlEditor) return;
        _generatedHtml = _htmlEditor.value;
        _writeToIframe(_generatedHtml);
        _htmlEditor.classList.remove('modified');
        _htmlDirty = false;
        _showApplyButton('html', false);
        _setStatus('Cambios aplicados', 'saved');
        setTimeout(() => _setStatus(''), 2000);
    }

    /**
     * Apply edited JSON (validate first)
     */
    function applyJsonChanges() {
        if (!_jsonEditor) return;
        try {
            JSON.parse(_jsonEditor.value);
            _generatedJson = _jsonEditor.value;
            _jsonEditor.classList.remove('modified');
            _jsonDirty = false;
            _showApplyButton('json', false);
            _setStatus('JSON válido y aplicado', 'saved');
            setTimeout(() => _setStatus(''), 2000);
        } catch (err) {
            _setStatus('JSON inválido: ' + err.message, 'error');
        }
    }

    function _writeToIframe(html) {
        if (!_iframe) return;
        const doc = _iframe.contentDocument || _iframe.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
    }

    function _updateLineNumbers(type) {
        const editor = type === 'html' ? _htmlEditor : _jsonEditor;
        const numbersEl = document.getElementById(type === 'html' ? 'htmlLineNumbers' : 'jsonLineNumbers');
        if (!editor || !numbersEl) return;

        const lineCount = editor.value.split('\n').length;
        const currentCount = numbersEl.children.length;

        if (lineCount !== currentCount) {
            let html = '';
            for (let i = 1; i <= lineCount; i++) {
                html += `<span>${i}</span>`;
            }
            numbersEl.innerHTML = html;
        }
    }

    function _syncLineScroll(type) {
        const editor = type === 'html' ? _htmlEditor : _jsonEditor;
        const numbersEl = document.getElementById(type === 'html' ? 'htmlLineNumbers' : 'jsonLineNumbers');
        if (!editor || !numbersEl) return;
        numbersEl.scrollTop = editor.scrollTop;
    }

    function _showApplyButton(type, show) {
        const btn = document.getElementById(type === 'html' ? 'btnApplyHtml' : 'btnApplyJson');
        if (btn) btn.hidden = !show;
    }

    function _updateStatus(type) {
        const editor = type === 'html' ? _htmlEditor : _jsonEditor;
        if (!editor) return;
        const lines = editor.value.split('\n').length;
        const chars = editor.value.length;
        _setStatus(`${lines} líneas, ${chars} caracteres — modificado`, 'modified');
    }

    function _setStatus(text, className) {
        const el = document.getElementById('editorStatus');
        if (!el) return;
        el.textContent = text;
        el.className = 'editor-status' + (className ? ' ' + className : '');
    }

    function getHtml() {
        // Return the latest (possibly edited) version
        return _htmlEditor ? _htmlEditor.value : _generatedHtml;
    }

    function getJson() {
        return _jsonEditor ? _jsonEditor.value : _generatedJson;
    }

    function isHtmlDirty() { return _htmlDirty; }
    function isJsonDirty() { return _jsonDirty; }

    function downloadHtml(fileName) {
        const html = getHtml();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        downloadBlob(blob, fileName || 'formulario.html');
    }

    function downloadJson(fileName) {
        const json = getJson();
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
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
        applyHtmlChanges,
        applyJsonChanges,
        getHtml,
        getJson,
        isHtmlDirty,
        isJsonDirty,
        downloadHtml,
        downloadJson
    };
})();
