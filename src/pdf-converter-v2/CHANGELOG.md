# Changelog

## v1.3.3
- Add input file type validation (PDF/Excel) before processing
- Enhance status bar with section count and grouped warning display
- Categorize warnings by type in the warnings panel

## v1.3.2
- Rename old "Convertir PDF" mode card to "Convertir PDF (legacy)"

## v1.3.1
- Wire v2 flow into app.js: file inputs, PDF preview on load, process + download handlers
- Add Convert PDF V2 mode card and flow section to index.html
- Allow v2 CSS in dev server ALLOWED list

## v1.3.0
- Add PDF preview component using PDF.js (full-width pages, vertical scroll)
- Add v2 UI stylesheet (inputs bar, preview container, status bar, warnings panel)

## v1.2.0
- Wire `runConvertPdfV2` and `renderPdfPreviewV2` into browser.js exports

## v1.1.0
- Add json-enricher.js with full Lovable v8 JSON generation (sections, field types, radio groups, beneficiary cascade, Encabezado, date selects, catalogs, prefillMode, helpText)
- Add 30 json-enricher tests (all passing)

## v1.0.1
- Add excel-reader.js (22-column parsing + header validation + rename mapping builder)
- Add pdf-renamer.js (recursive AcroForm tree walk, flatten, rename, dirty default cleanup, verification)
- Add catalogos.js (10 hardcoded INS catalogs)
- Add precharged-lists.js (DIAS, MESES, ANIOS date options)
- Add encabezado-section.js (10 hidden header fields with NEVER_VISIBLE conditional)
- Add prefill-mode-rules.js (mandatory/optional determination)
- Add help-texts.js (50+ help text entries in Spanish)
- Add 8 pdf-renamer tests (all passing)

## v1.0.0
- Initial module structure and directory setup
- Add index.js entry point orchestrating the full pipeline
- Add README.md and CHANGELOG.md
