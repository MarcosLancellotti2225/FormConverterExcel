# PDF Converter v2

Converts an INS PDF form + a 22-column mapping Excel into:
- A renamed PDF (AcroForm fields renamed per convention B)
- An enriched JSON (Lovable v8 format)

## Version

Current: **v1.0.0**

## Inputs

1. PDF original del INS (.pdf)
2. Excel de mapeo de 22 columnas (.xlsx) — output del Editor de Matriz

## Outputs

```
<CODIGO>_<Nombre>.zip
├── <CODIGO>_<Nombre>_renamed.pdf
└── form-definition-<CODIGO>_enriched.json
```
