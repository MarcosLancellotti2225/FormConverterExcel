# INS Lovable JSON Generator

Pipeline que consume los insumos del INS (PDFs del trámite + matriz Excel + catálogos) y produce un **JSON en formato Lovable** por cada producto.

> El formulario visual lo construye un desarrollador externo en [Lovable](https://lovable.dev).
> Este repo ya no incluye preview ni builder — solo el generador de JSON.

**Dos formas de usarlo:**

1. **CLI** — `node src/index.js --all` (buena para batches / CI).
2. **Web UI** — `npm run serve` o hospedaje estático en GitHub Pages. Toda la pipeline corre 100% client-side, ningún archivo sale del browser.

## Estructura

```
/src
  /parsers
    excel-parser.js         # matriz (Formulario Digital Vida)
    catalogs-parser.js      # catálogos (Tipo Formulario, Moneda, etc.)
    pdf-analyzer.js         # coordenadas AcroForm via pdf-lib
    rule-parser.js          # lenguaje natural → conditionalVisibility + validation
  /transformers
    merge-catalogs.js       # options[] ← catálogos resueltos
    merge-pdf-coords.js     # sourceMeta + rect ← PDF
    section-grouper.js      # Field[] → Section[]
  /builders
    json-builder.js         # JSON Lovable final
  /validators
    prefillkey-validator.js # valida paths contra Json_Formulario_Vida_-_Asegurado.txt
  pipeline.js               # orchestrador puro (buffer-in → JSON-out)
  index.js                  # CLI (Node)
  browser.js                # entry para el bundle web
/                           # UI estática (GitHub Pages sirve desde acá)
  index.html, app.js, styles.css, bundle.js (generado), .nojekyll
/scripts/serve.js           # dev server mínimo (sin deps)
/inputs                     # PDFs, Excels, client JSON (gitignored)
/outputs                    # JSONs generados (gitignored)
/test                       # smoke tests
```

## Inputs esperados en `/inputs/`

| Archivo | Descripción |
|---|---|
| `Matriz_Formularios_VidaColectiva_Secciones.xlsx` | Matriz con definición de campos |
| `Catalogos_Formularios_INS_Namirial_-_Vida.xlsx`  | Catálogos (Moneda, Estado Civil, …) |
| `1009052.pdf`                                      | Vida Colectiva (base) |
| `D0306.pdf`                                        | Vida Universal Plus |
| `D0309.pdf`                                        | Protección Crediticia |
| `Json_Formulario_Vida_-_Asegurado.txt`             | JSON cliente (para validar `prefillKey`) |
| `lovable-example-1009052.json`                     | Ejemplo de estructura Lovable (referencia) |

## Uso — Web UI

```bash
npm install
npm run build:web        # genera bundle.js en la raíz (~2.9MB)
npm run serve            # http://localhost:3000
```

Dropeás la matriz, los catálogos y (opcional) los PDFs, apretás "Generar",
y descargás el/los JSON resultantes. Todo corre en el browser: ningún archivo
va a ningún servidor.

### Publicar en GitHub Pages

1. **Settings → Pages**
2. **Source:** `Deploy from a branch`
3. **Branch:** la branch que tenga el build (ej: `main` o `claude/docpath-form-builder-89SN4`)
4. **Folder:** `/ (root)`
5. Save

La UI queda en `https://<usuario>.github.io/<repo>/`. El archivo `.nojekyll`
en la raíz evita que GitHub renderice el README con Jekyll.

## Uso — CLI

```bash
npm install

# Un solo producto
node src/index.js --pdf=1009052
node src/index.js --pdf=D0306 --verbose
node src/index.js --pdf=D0309 --out=outputs/D0309-custom.json

# Los tres a la vez
node src/index.js --all

# Sin embeber el PDF en base64 (más liviano)
node src/index.js --all --no-pdf-embed

# Forzar estrategia de secciones por página PDF
node src/index.js --all --strategy=pdf_page
```

Shortcuts en `package.json`:

```bash
npm run build            # --all
npm run build:1009052
npm run build:D0306
npm run build:D0309
npm run build:web        # bundle browser
npm run serve            # dev server localhost:3000
npm test                 # smoke tests
```

### Flags

| Flag | Uso |
|---|---|
| `--pdf=<id>`        | Producto individual (`1009052` \| `D0306` \| `D0309`) |
| `--all`             | Genera los tres JSON |
| `--out=<path>`      | Override de ruta de salida |
| `--matrix=<path>`   | Override del xlsx de matriz |
| `--catalogs=<path>` | Override del xlsx de catálogos |
| `--client=<path>`   | Override del JSON cliente |
| `--no-pdf-embed`    | Omite `_sourcePdf.b64` del output |
| `--strategy=<s>`    | `logical` (default) \| `pdf_page` |
| `--verbose`         | Imprime todos los warnings |

## Pipeline

```
1. parseMatrix(xlsx)        → Field[] normalizados
2. parseCatalogs(xlsx)      → Map<catalog, Option[]>
3. mergeCatalogs()          → Field.options resueltas
4. applyRules()             → validationPattern + conditionalVisibility
5. parsePdfCoordinates()    → Map<pdfFieldName, {page, rect}>
6. mergePdfCoords()         → Field.sourceMeta + Field.pdfCoords
7. groupBySections()        → Section[]
8. resolveTriggerConditionals() → mueve reglas a los dependientes
9. buildLovableJson()       → JSON final
10. validateLovableJson()   → flags paths fuera del árbol cliente
```

## Mapa Excel → JSON Lovable

| Columna Excel | JSON Lovable |
|---|---|
| `Pasos Formulario` + `Sección`   | `sections[].id` + `sections[].title` |
| `Nombre del campo en formulario` | `field.label` |
| `Tipo de dato`                   | `field.type` (Combo→select, Radio→radio, Texto→text, Numérico→number, Fecha→date, Alfanumerico→text, Checkbox→checkbox, Comentario Informativo→readonly, Titulo→heading) |
| Filas repetidas con distinto `Valor` | `field.options[]` |
| `Regla` (validaciones)           | `field.validationPattern` + `field.maxLength` |
| `Regla` + `Observaciones` (condicionales) | `field.conditionalVisibility` |
| `Obligatorio`                    | `field.required` |
| `Formulario a visualizar`        | `field.productScope` (meta-conditional) |
| `Visualización en Formularios`   | `field.readOnly`, `field.hidden` |
| `Nombre del Campo en Json`       | `field.prefillKey` (+ `mappedPaths[]`) |
| `Nombre en PDF` / `Nombre del Campo en PDF` | `field.sourceMeta.sourceName` |

## TODOs para el dev de Lovable

Marcados como `TODO-LOVABLE-{N}` en el código. Al resolverlos, buscar el tag y ajustar.

1. **Secciones**: lógicas por `Pasos Formulario` (default) vs `sec_page_N` por página PDF.
2. **Beneficiarios**: `repeatable: true` (default) vs N instancias planas.
3. **Combos con código + descripción**: `prefillKey` + `mappedPaths[]` (default) vs options con `{code, label}`.
4. **JSON único vs por producto**: uno por PDF (default, tres archivos).
5. **Campos ocultos**: `hidden: true` inline (default) vs sección `_hidden`.
6. **Concatenación automática** (Nombre Completo): `computed: { sources, join }` (default) vs client-side.

## Tests

```bash
npm test
```

Incluye:
- Unit tests de `rule-parser` (validaciones + conditionals)
- Unit tests de `excel-parser` (mapType, normalizeRequired, productScope)
- Shape test de `json-builder`
- Walker test de `prefillkey-validator`
- E2E: si hay archivos en `/inputs/`, corre la pipeline completa para `1009052`.
