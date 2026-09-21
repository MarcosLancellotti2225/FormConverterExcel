Necesito armar el form-definition de Signframe para un formulario del INS de Costa Rica.

Antes de tocar nada: leé la skill `signframe-form-def` ENTERA, no solo el SKILL.md.
Entrá a references/ y leé las reglas de plataforma y los ejemplos de oro. El SKILL.md
es el índice; lo que evita los errores caros está en las referencias, y son errores
que no fallan — salen mal en silencio.

Te adjunto tres cosas:
- El PDF renombrado: los AcroForms ya tienen nombres legibles, no Text3.0.0.
- El paquete de campos (xlsx): un campo por fila, con tipo, página y posición.
- La ficha de configuración del INS: lo que pide el negocio.

Cómo quiero que trabajemos:
1. Leé todo y decime qué entendiste y qué te falta. No arranques a generar.
2. Resolvé el mapeo ficha ↔ PDF hoja por hoja, y frená a preguntarme cada vez que
   la ficha y el PDF no coincidan. Se contradicen seguido.
3. Recién con el mapeo cerrado, armá el form-def.

Dos cosas que no quiero:
- Si un campo del PDF no está en la ficha, no lo inventes ni le pongas un prefijo
  adivinado: dejalo aparte y preguntame.
- No copies la estructura de otro formulario. Cada uno tiene su ficha.

Lo voy a auditar con el Revisor, así que apuntá a 0 errores de plataforma.
