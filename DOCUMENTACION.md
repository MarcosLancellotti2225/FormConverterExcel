# Form Tools — qué tenemos

Herramientas para digitalizar formularios PDF del INS de Costa Rica y convertirlos
en form-definitions de Signframe.

Todo corre **100% en el browser**. Ningún archivo sale de tu máquina: no hay backend,
no hay upload, no hay servidor que vea tus PDFs.

- **Repo:** `MarcosLancellotti2225/FormConverterExcel`
- **Rama de trabajo:** `claude/docpath-form-builder-89SN4`
- **Paquete:** `ins-lovable-json-generator` v0.1.0

---

## Cómo se abre

```bash
git clone https://github.com/MarcosLancellotti2225/FormConverterExcel.git
cd FormConverterExcel
npm install
npm run build:web     # genera bundle.js
npx http-server -p 3000 -c-1 .
```

Y abrís `http://localhost:3000/index.html`.

Cada herramienta tiene su propia URL: `#v2`, `#detect-fields`, `#quoter`, etc.
Se pueden compartir y sobreviven al refresh.

---

## El circuito

Este es el orden real en que se digitaliza un formulario. La app hace lo mecánico
y determinístico: leer el PDF, medir, escribir, contar y auditar. El mapeo
ficha ↔ PDF y las decisiones del formulario los resolvés vos.

| # | Etapa | Quién | Entra | Sale |
|---|-------|-------|-------|------|
| 1 | Etapa 0 | app + vos | PDF del INS, ficha, paquete de campos | PDF renombrado + mapeo en Excel |
| 2 | Signframe | afuera | PDF renombrado | JSON main |
| 3 | Etapa 1 | app | Mapeo en Excel + ficha | Matriz canónica (2 hojas) |
| 4 | Etapa 1 | app | Matriz canónica + JSON main | form-definition |
| 5 | Etapa 2 | app | form-definition | form-def auditado |
| 6 | Entrega | app | ZIP con todo | Reporte comercial |

El **paso 1** es el único que mezcla las dos cosas: detectás los campos con la app,
resolvés a mano cómo se llama cada uno leyendo la ficha, y volvés a la app para
aplicar los nombres. Ese "a mano" del medio es el que no se puede automatizar:
la ficha y el PDF se contradicen seguido y hay que decidir.

---

## Las herramientas

### 2.0 — el hub
La puerta de entrada. Tiene el circuito completo escrito como instrucción
(qué necesitás · qué hacés · qué te queda), un paso 0 que te pregunta por dónde
entrás y te deja parado en tu paso, y el handoff con la skill y el prompt para
seguir con Claude.

La elección del paso 0 se guarda en `localStorage`. Si no está disponible, la
pantalla abre con todo desplegado.

### Detector de Campos
Analiza un PDF y lista todos los AcroForms con tipo, página y posición.
Preview interactivo con overlays, click en campo ↔ fila de tabla sincronizado.
Exporta la lista a Excel y puede bajar el PDF con los labels dibujados encima.

### Convertir PDF
Renombra, agrega, borra y dibuja campos AcroForm, con preview en vivo.
Tres modos de entrada: matriz de 22 columnas, Excel custom, o manual.
Exporta imagen, PDF con labels y el mapeo en Excel.

### Matriz Canónica
Colapsa el xlsx de mapeo a dos hojas: **Campos** (pregunta + negocio) y
**Opciones** (el detalle de cada lista). Agrupa por raíz distinguiendo campo
simple, radio, repeater y lookup, y le fusiona el negocio que viene de la ficha,
cruzando por `sourceName`. Es el input del Generador.

### Generador Signframe
De la matriz canónica al form-definition. Agrupa los `sourceNames` por raíz y los
alinea con su fila de la matriz por sección + orden de lectura. Desdobla los
radios, preserva `sourceMeta` intacto, y corre 8 checks de validación al final.

### Mapa JSON
Carga un form-definition y dibuja el JSON de salida que genera y el de entrada
que consume, recorriendo todas las rutas. Dice qué campo escribe en cada ruta y
marca las que borran el subárbol. Corre las 26 reglas de plataforma del Revisor.
Si le das un JSON real del cliente, compara y te sugiere la ruta más parecida
cuando no coincide.

### Cotizador
Cargás un ZIP con los insumos y te dice todo lo que contiene. Cuenta los campos
de cada PDF y las reglas de negocio de cada ficha por separado, clasifica cada
archivo por rol, y mide cuánto se repite entre formularios para descontarlo.
Saca complejidad **Baja / Media / Alta** por formulario y de la entrega completa,
que no son lo mismo: tres formularios Media pueden dar una entrega Alta.
Exporta el reporte comercial en HTML, PDF y Word.

### Concatenar PDFs
Une varios PDFs en uno solo, con drag & drop para reordenar. Deduplica los
nombres `/T` colisionados como `<nombre>__p<página>` para que los AcroForms no se
pisen — que es exactamente lo que rompía los PDFs concatenados antes.

### Metadata PDF
Ve y edita el Document Info (título, autor, asunto, keywords, fechas), con
exportar e importar como JSON. Acá vive también el **tope de tamaño de fuente**.

---

## Dos cosas que costaron encontrar

**El font que crecía.** Poner el `/DA` en 9pt no alcanzaba: los campos tenían el
**flag Comb** (`/Ff` bit 24) prendido, que ignora el tamaño de la DA y estira el
texto para llenar las celdas. Hay que limpiar el bit *además* de capear el tamaño.
Afectaba a 152 campos de un PDF real.

**`constructor.name` no sirve en el bundle.** esbuild renombra las clases internas
de `pdf-lib` (`PDFTextField` pasa a ser `PDFTextField2`), así que cualquier check
por nombre de clase funciona en Node y falla en silencio en el browser. Va
`instanceof`, siempre.

---

## El Revisor — las 26 reglas

Motor portado desde el repo `frombuilder` v4.0.0. Vive en
`src/json-mapper/revisor/` y corre dentro de Mapa JSON.

Severidades: **error** (rompe el formulario) · **aviso** (se puede entregar, pero
anotalo) · **nota**.

| | Qué detecta |
|---|---|
| R00 | Una regla falló y no se evaluó — el diagnóstico está incompleto |
| R01 | El id no coincide con su sourceName |
| R02 | id duplicado |
| R03 | Condición apuntando a un campo inexistente |
| R04 | `salidaJSON` y `jsonOutputPath` no coinciden |
| R05 | Repeater con `jsonOutputPath` |
| R06 | Repeater sin `jsonSlotPattern` |
| R07 | Patrón de repeater 1-based |
| R08 | Helper que escribe siempre |
| R09 | Casilla que pinta con "X" |
| R10 | Condición comparada solo por etiqueta |
| R11 | Puede generar una persona fantasma |
| R12 | Dos campos escriben la misma ruta |
| R13 | Casillero del PDF que queda vacío |
| R14 | `prefillMode "api"` |
| R15 | Label sin tildes |
| R16 | Descripción que nunca se llena |
| R17 | Edad sin calcular |
| R18 | Cascada apuntando a otra persona |
| R19 | Fecha cortada en formato ISO |
| R20 | Nombre completo desbloqueado |
| R21 | Grupo de radios roto |
| R22 | No hay campo de firma |
| R23 | Declaraciones no está al final |
| R24 | Grupo de tipo de persona incompleto |
| R25 | Campos del PDF sin usar |
| R26 | Término distinto al acordado |

**R00 existe por una razón concreta.** Al sincronizar R01 rompí su `require` y la
regla empezó a tirar excepción. El `catch` del motor se la tragaba, el panel
mostraba 0 hallazgos de R01, y eso se leía como "está todo bien" cuando en
realidad la regla estaba muerta. R00 convierte ese silencio en un aviso visible.

**Sobre R01.** Signframe **slugifica** los ids: `depGeneroFem[0]` llega como
`field_depgenerofem_0`. Comparar contra el `sourceName` crudo daba 117 falsos
positivos en un solo formulario — el 69% de todo el ruido, tapando los hallazgos
de verdad. Con el slug bien hecho, `signframe.json` pasó de 172 hallazgos a 54
reales.

---

## Cómo cotiza el Cotizador

Pesos por unidad de trabajo:

| Unidad | Peso |
|---|---|
| Campo AcroForm | 1 |
| Página de formulario | 2 |
| Regla de negocio (Excel) | 2.5 |
| Visibilidad condicional | 6 |
| Repeater | 10 |
| Ítem de catálogo | 0.2 |
| Catálogo distinto | 5 |
| PDF extra | 40 |

**Umbrales:** ≤900 Baja · ≤1800 Media · resto Alta.
**Plazos:** Baja 1 semana · Media 2 · Alta 3.
**Reuso:** lo ya resuelto cuesta el 15% (`reuseFactor: 0.15`).

Calibrado contra casos reales: *D0873 DSE* (129 campos, 2 págs) da **Baja**;
*Fidelidad* (202 campos, 344 reglas, 25 catálogos, 4 págs) da **Media**. Los
umbrales se ajustan desde la UI sin tocar código.

---

## La skill para Claude

`public/skill-signframe-form-def.zip` — 13 archivos, 178 KB, v1.0.0.

Trae las reglas de plataforma de Signframe y las convenciones del INS: el
`SKILL.md` es el índice, y lo que evita los errores caros está en `references/`
(reglas de plataforma, convenciones, ficha nueva, Etapa 0, patrones y tres
ejemplos de oro), más tres scripts de validación en Python.

Se instala descomprimiéndola en `~/.claude/skills/` y reiniciando Claude Code.

Para publicar una versión nueva:

```bash
node scripts/build-skill-zip.js <carpeta-de-la-skill> 1.1.0
```

El script reescribe `public/skill-signframe-form-def.json` con versión, fecha,
peso y cantidad de archivos. **El HTML no se toca**: la versión que se ve en
pantalla sale de ese JSON.

El prompt para arrancar con Claude está en `public/prompt-form-def.md` y se trae
con `fetch` en cada carga, así editarlo no obliga a tocar `app.js` ni a bumpear
el cache-bust.

---

## Cómo está armado

```
/                       UI estática — se sirve desde acá
  index.html            todas las pantallas, uno por modo
  app.js                routing, estado y render (vanilla, sin framework)
  styles.css
  bundle.js             generado por esbuild desde src/browser.js
/public
  skill-signframe-form-def.zip + .json    la skill y su versión
  prompt-form-def.md                      el prompt copiable
/scripts
  build-skill-zip.js    empaqueta la skill
  serve.js              dev server mínimo, sin dependencias
/src
  browser.js            entry del bundle: lo que la UI puede llamar
  pdf-detect/           detectar campos
  pdf-converter/        renombrar y reescribir AcroForms
  pdf-converter-v2/     el convertidor nuevo
  signframe-generator/  matriz canónica y form-definition
  json-mapper/          Mapa JSON
    revisor/            el motor de 26 reglas
  quoter/               cotización, reporte HTML y docx
  matrix-editor/        edición de matrices
  parsers/ transformers/ builders/ validators/ enricher/
/test                   smoke tests
```

**Stack:** vanilla JS en CommonJS, empaquetado con esbuild.
`pdf-lib` para leer y escribir AcroForms, `pdfjs-dist` para renderizar,
`xlsx` (SheetJS) para los Excel, `jszip` para ZIPs y para el `.docx`.
Sin framework, sin runtime.

`index.html`, `app.js` y `styles.css` se cargan directo con `?v=NN` para
cache-busting — **si tocás alguno de los tres, subí el número**.

**Tests:** `npm test` — 109 pasando, 0 fallando, en 13 suites.

---

## Convenciones que no se rompen

- Todo el trabajo va a `claude/docpath-form-builder-89SN4`, **nunca a `main`**.
- No se convierte PDF a HTML.
- `sourceMeta.nativeType` y `rect` se preservan; las coordenadas no se
  sobrescriben.
- Los `id` y el `sourceMeta` existentes no se alteran.
- Un grupo de radios legítimo (un `/T` padre con hijos) **no** es una colisión de
  nombres. Distinguirlos antes de "arreglar" nada.

---

## Lo que quedó pendiente

- **Matriz Canónica** — hay una duda de fondo sin resolver: son dos Excel en fila,
  el de Etapa 0 y el canónico. Congelada hasta definirlo.
- Editar metadata XMP (hoy solo Document Info).
- Exportar el listado de `fields[]` como CSV o Excel.
- Los 62 campos sin ruta de salida, en detalle.
- El conflicto `enfermedades` array-vs-objeto.
- Usar la columna "Formulario a visualizar" de la ficha para asignar las reglas
  exactas, en vez de prorratearlas.
- Branding y tarifa por hora en el reporte comercial.
