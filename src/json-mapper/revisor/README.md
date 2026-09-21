# Motor de reglas del Revisor — ESM puro

Las 26 reglas de plataforma de Signaframe, en JavaScript sin dependencias.
Portado desde `frombuilder` v4.0.0 con `tsc` (no a mano), y verificado contra
los mismos form-def reales: da resultados idénticos al original.

**No trae UI.** Son funciones puras sobre un objeto JSON. La pantalla la pone
quien lo consume.

## Qué necesita

Nada. Cero dependencias, cero `import` externos, no lee archivos ni red, no toca
`window` ni `document`. Corre igual en el browser y en Node.

Los catálogos del INS están **adentro** de `catalogos.js` como constantes: no
hace falta cargar la ficha ni ningún xlsx en runtime.

## API

```js
import { construirModelo } from './revisor/modelo.js';
import { revisar, cobertura } from './revisor/reglas.js';

const modelo    = construirModelo(formDef);
const hallazgos = revisar(modelo);
const cob       = cobertura(modelo, ejemploDelCliente); // opcional
```

### `construirModelo(formDef)`

Aplana el form-def una vez y lo indexa por las **dos** claves: por sección (lo
que ve el usuario) y por ruta JSON (lo que recibe el INS). Eso es lo que permite
que seleccionar de un lado ilumine el otro.

| Campo | Qué es |
|---|---|
| `campos` | `CampoPlano[]` — cada campo con su ruta de secciones y si está oculto |
| `porId` | `Map<id, CampoPlano>` |
| `porRuta` | `Map<rutaJSON, HojaJson>` — **más de un campo por ruta = conflicto** |
| `arbol` | el árbol JSON de salida, para dibujar |
| `porSourceName` | `Map<sourceName, CampoPlano>` |
| `sourceNamesPdf` | sourceNames del PDF que ningún campo usa |

### `revisar(modelo)`

Devuelve `Hallazgo[]`, ya ordenado por severidad:

```js
{
  regla: 'R09',
  severidad: 'error',        // 'error' | 'aviso' | 'nota'
  titulo: 'Casilla que pinta con "X"',
  detalle: '...',            // el SÍNTOMA, con `backticks` para código
  campoIds: ['field_x'],
  ruta: 'datosFormulario...', // opcional
  ref: '§E2',                 // opcional
}
```

Una regla que explota no tumba el diagnóstico: se saltea y el resto sigue.

### `cobertura(modelo, ejemplo)`

`{ total, cubiertas, faltan }`. Compara **la forma**, normalizando los índices de
array, así que `personas[0]` y `personas[3]` cuentan como `personas[]`.

## Las severidades

- **error** — rompe el entregable. No se sube así.
- **aviso** — probablemente esté mal, pero puede ser intencional. Se explica.
- **nota** — diferencia con la convención; decide una persona.

## Lo que NO hace

**No corrige.** Un fix automático sobre 400 campos es exactamente el cambio que
después nadie audita, y acá el costo de un error silencioso lo paga el backend
del INS. Las reglas reportan; la corrección la hace una persona.

## Validación

Sobre los form-def reales, antes y después de las correcciones hechas a mano:

| Formulario | Errores antes | Después |
|---|---|---|
| Fidelidad Adhesión | 2 | 0 |
| Seguro Voluntario de Automóviles | 76 | 0 |
| D0714 | 0 | 0 |

Los 76 de Automóviles son los que se corrigieron en una sesión entera: 66
casillas `/Btn` que se marcaban con la cadena `"X"`, 6 fechas cortadas en formato
ISO sobre un `DD/MM/AAAA`, y 4 condiciones comparadas solo por etiqueta sobre un
select prellenado.

## Solapamiento con el Mapa JSON

`R12` (dos campos escribiendo la misma ruta) ya existe del otro lado, con la
misma excepción para grupos de radios. Al integrar, quedarse con una sola.

Lo que este motor **no** tiene y el Mapa JSON sí: nodo usado como array y objeto
a la vez, ruta contenedor que borra el subárbol, el «¿quisiste decir?» por sufijo
en la cobertura, y el JSON de entrada dibujado. Esas cuatro van en la dirección
contraria.

## Si hay que tocar una regla

Están todas en `reglas.js`, una función por regla, con el síntoma escrito arriba.
El array `REGLAS` del final es el registro: agregar una es escribir la función y
sumarla ahí.

Los catálogos y las convenciones (grupos de tipo de persona, orden de secciones,
anchos, tildes, términos) están en `catalogos.js`. Si el cliente corrige un
código, se toca ahí y lo toman todas las reglas.
