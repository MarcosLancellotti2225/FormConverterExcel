#!/usr/bin/env python3
"""
combine_form.py — Two-step combiner for Signframe form definitions.

Step 1: Pre-populate sourceName suggestions in the matrix → matriz_revisar.xlsx
Step 2: Generate enriched form-definition JSON → form-definition-final.json

Usage:
    python3 combine_form.py                     # Both steps
    python3 combine_form.py --step 1            # Only step 1
    python3 combine_form.py --step 2            # Only step 2
    python3 combine_form.py --signframe X.json --matriz Y.xlsx
"""

import json, sys, os, re, argparse, unicodedata
from collections import OrderedDict
from difflib import SequenceMatcher

try:
    import openpyxl
    from openpyxl.styles import PatternFill
except ImportError:
    sys.exit("ERROR: pip install openpyxl")

# ─── Constants ───────────────────────────────────────────────────────────────

NEVER_CONDITION = json.dumps({
    "logic": "and",
    "conditions": [{"fieldId": "field_NEVER_EXISTS", "operator": "not_empty"}]
})

VALID_OPERATORS = frozenset(['not_empty', 'empty', 'equals'])

YELLOW_FILL = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')

TYPE_MAP = {
    'texto': 'text', 'alfanumerico': 'text', 'alfanumérico': 'text',
    'numerico': 'number', 'numérico': 'number',
    'numérico/porcentual': 'number',
    'fecha': 'date', 'combo': 'select', 'lista': 'select',
    'select': 'select', 'dropdown': 'select',
    'radio': 'radio', 'radio/combo': 'radio',
    'checkbox': 'checkbox', 'check': 'checkbox',
    'email': 'email',
    'comentario informativo': 'readonly', 'informativo': 'readonly',
    'titulo': 'heading', 'textarea': 'textarea',
}

# ─── Utilities ───────────────────────────────────────────────────────────────

def norm(s):
    """Normalize string for comparison: lowercase, strip accents, collapse whitespace."""
    if not s:
        return ''
    s = str(s).strip().lower()
    s = unicodedata.normalize('NFD', s)
    s = re.sub(r'[̀-ͯ]', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s

def tokenize(s):
    return set(norm(s).split())

def similarity(a, b):
    """0..1 similarity between two strings."""
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()

def token_overlap(a, b):
    """Fraction of shared tokens."""
    ta, tb = tokenize(a), tokenize(b)
    if not ta or not tb:
        return 0.0
    shared = ta & tb
    return len(shared) / min(len(ta), len(tb))

def is_yes(val):
    return str(val or '').strip().lower() in ('si', 'sí', 'yes', 'true', '1')

def to_key(name):
    if not name:
        return 'otros'
    k = norm(name)
    k = re.sub(r'\s+', '_', k)
    return k or 'otros'

def title_case(s):
    return ' '.join(w.capitalize() for w in str(s).split())


# ─── Matrix reading ─────────────────────────────────────────────────────────

HEADER_PATTERNS = [
    (re.compile(r'pasos', re.I), 'pasos'),
    (re.compile(r'^secci[oó]n$', re.I), 'seccion'),
    (re.compile(r'nombre\s+en\s+pdf', re.I), 'nombrePdf'),
    (re.compile(r'nombre\s+del\s+campo\s+en\s+formulario', re.I), 'etiqueta'),
    (re.compile(r'tipo\s+de\s+dato', re.I), 'tipoDato'),
    (re.compile(r'^valor$', re.I), 'valor'),
    (re.compile(r'^regla$', re.I), 'regla'),
    (re.compile(r'obligatori', re.I), 'obligatorio'),
    (re.compile(r'formulario\s+a\s+visual', re.I), 'formularioVisualizar'),
    (re.compile(r'visualizaci[oó]n', re.I), 'visualizacion'),
    (re.compile(r'observacion', re.I), 'observaciones'),
    (re.compile(r'nombre.*campo.*json|nombre.*json', re.I), 'pathJson'),
    (re.compile(r'nombre.*campo.*pdf$', re.I), 'nombreCampoPdf'),
    (re.compile(r'sourcename.*sugerido', re.I), 'sourceNameSugerido'),
    (re.compile(r'sourcename.*final', re.I), 'sourceNameFinal'),
]


def detect_headers(ws):
    col_map = {}
    for c in range(1, ws.max_column + 1):
        header = str(ws.cell(row=1, column=c).value or '').strip()
        if not header:
            continue
        for pattern, prop in HEADER_PATTERNS:
            if pattern.search(header) and prop not in col_map:
                col_map[prop] = c
                break
    return col_map


def read_matriz(path):
    wb = openpyxl.load_workbook(path)
    ws = wb.active
    col_map = detect_headers(ws)

    print(f"\n  Columnas detectadas en {os.path.basename(path)}:")
    for prop, col in sorted(col_map.items(), key=lambda x: x[1]):
        print(f"    Col {col}: {ws.cell(row=1, column=col).value!r} -> {prop}")

    rows = []
    for r in range(2, ws.max_row + 1):
        row = {}
        for prop, col in col_map.items():
            row[prop] = ws.cell(row=r, column=col).value
        if not row.get('etiqueta') and not row.get('nombrePdf'):
            continue
        row['_row'] = r
        row['_obligatorio'] = is_yes(row.get('obligatorio'))
        rows.append(row)

    wb.close()
    print(f"    -> {len(rows)} filas de datos\n")
    return rows, col_map


def collapse_option_rows(rows):
    """Collapse consecutive rows with same etiqueta + different valor into groups.
    Returns list of 'logical fields', each with .rows (list of original rows)
    and .options (list of valor strings).
    The first row of each group carries the primary data (pathJson, etc.).
    """
    groups = []
    i = 0
    while i < len(rows):
        primary = rows[i]
        etiq = norm(primary.get('etiqueta', ''))
        tipo = norm(primary.get('tipoDato', ''))
        group_rows = [primary]
        options = []
        if primary.get('valor'):
            options.append(str(primary['valor']))

        j = i + 1
        while j < len(rows):
            next_row = rows[j]
            next_etiq = norm(next_row.get('etiqueta', ''))
            if next_etiq == etiq and next_row.get('valor') and not next_row.get('pathJson'):
                group_rows.append(next_row)
                options.append(str(next_row['valor']))
                j += 1
            else:
                break

        groups.append({
            'primary': primary,
            'rows': group_rows,
            'options': options if len(options) > 1 else [],
            'etiqueta': primary.get('etiqueta', ''),
            'seccion': primary.get('seccion', ''),
            'tipoDato': primary.get('tipoDato', ''),
            'nombrePdf': primary.get('nombrePdf', ''),
            'pathJson': primary.get('pathJson', ''),
            'obligatorio': primary.get('_obligatorio', False),
            'sourceNameFinal': primary.get('sourceNameFinal'),
            'sourceNameSugerido': primary.get('sourceNameSugerido'),
        })
        i = j
    return groups


# ─── Signframe JSON reading ─────────────────────────────────────────────────

def read_signframe(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def extract_json_fields(data):
    """Extract all fields from signframe JSON, along with field positions if available."""
    fields = []
    for sec in data.get('sections', []):
        for fld in sec.get('fields', []):
            fields.append(fld)
        for sub in sec.get('subsections', []):
            for fld in sub.get('fields', []):
                fields.append(fld)

    positions = {}
    sp = data.get('_sourcePdf', {})
    if sp and sp.get('fieldPositions'):
        fp = sp['fieldPositions']
        if isinstance(fp, list):
            for entry in fp:
                sn = entry.get('sourceName', '')
                if sn:
                    positions[sn] = entry
        elif isinstance(fp, dict):
            positions = fp

    for f in fields:
        sn = ''
        sm = f.get('sourceMeta')
        if sm:
            sn = sm.get('sourceName', '')
        if not sn:
            fid = f.get('id', '')
            sn = fid[6:] if fid.startswith('field_') else fid
        f['_sourceName'] = sn
        f['_label'] = f.get('label', sn)
        f['_page'] = sm.get('page', 0) if sm else 0

        if sn in positions:
            f['_pos'] = positions[sn]

    return fields


# ─── Fuzzy matching engine ───────────────────────────────────────────────────

def score_match(mfield, jfield, section_scores):
    """Score how well a matrix logical-field matches a JSON field. Higher = better."""
    score = 0.0

    m_etiq = mfield.get('etiqueta', '')
    m_pdf = mfield.get('nombrePdf', '')
    m_sec = norm(mfield.get('seccion', ''))
    m_path = mfield.get('pathJson', '')

    j_sn = jfield.get('_sourceName', '')
    j_label = jfield.get('_label', '')
    j_path = jfield.get('salidaJSON') or jfield.get('jsonOutputPath') or jfield.get('prefillKey') or ''

    # 1. JSON path match (strongest signal if both have paths)
    if m_path and j_path:
        m_paths = [p.strip() for p in str(m_path).replace('\n', ',').split(',') if p.strip()]
        for mp in m_paths:
            if mp == j_path:
                score += 50
                break
            if norm(mp) == norm(j_path):
                score += 45
                break
            if mp.split('.')[-1] == j_path.split('.')[-1]:
                score += 15

    # 2. Label similarity: etiqueta vs JSON label
    sim_label = similarity(m_etiq, j_label)
    score += sim_label * 20

    # 3. Label similarity: etiqueta vs sourceName
    sim_sn = similarity(m_etiq, j_sn)
    score += sim_sn * 10

    # 4. "Nombre en PDF" vs sourceName or label
    if m_pdf and m_pdf.lower() != 'no se llena en pdf':
        sim_pdf_sn = similarity(m_pdf, j_sn)
        sim_pdf_label = similarity(m_pdf, j_label)
        score += max(sim_pdf_sn, sim_pdf_label) * 15

    # 5. Token overlap bonuses
    tok_overlap = token_overlap(m_etiq, j_label)
    score += tok_overlap * 10
    tok_overlap_sn = token_overlap(m_etiq, j_sn)
    score += tok_overlap_sn * 5

    # 6. Section affinity (pre-computed)
    if m_sec in section_scores:
        if j_sn in section_scores[m_sec]:
            score += section_scores[m_sec][j_sn]

    return score


def build_section_affinity(matrix_groups, json_fields):
    """Pre-compute section affinity: which JSON fields tend to cluster near
    fields that share the same matrix section label.
    Simple approach: group JSON fields by page, try to match section names."""
    section_scores = {}

    pages = {}
    for jf in json_fields:
        p = jf.get('_page', 0)
        if p not in pages:
            pages[p] = []
        pages[p].append(jf)

    sections_seen = set()
    for mg in matrix_groups:
        sec = norm(mg.get('seccion', ''))
        if sec:
            sections_seen.add(sec)

    for sec in sections_seen:
        section_scores[sec] = {}
        for jf in json_fields:
            j_label = norm(jf.get('_label', ''))
            j_sn = norm(jf.get('_sourceName', ''))
            sec_sim = max(similarity(sec, j_label), similarity(sec, j_sn))
            if sec_sim > 0.3:
                section_scores[sec][jf['_sourceName']] = sec_sim * 5

    return section_scores


def match_all(matrix_groups, json_fields):
    """Match each matrix logical-field to the best JSON field.
    Returns list of (group, matched_sourceName, confidence, is_ambiguous).
    """
    section_scores = build_section_affinity(matrix_groups, json_fields)
    used = set()
    results = []

    for mg in matrix_groups:
        if mg.get('sourceNameFinal'):
            results.append((mg, str(mg['sourceNameFinal']), 1.0, False))
            used.add(str(mg['sourceNameFinal']))
            continue

        is_json_only = norm(mg.get('pasos', '') or '') == 'json'
        is_no_pdf = norm(mg.get('nombrePdf', '')) in ('no se llena en pdf', '')
        is_option_row = not mg.get('pathJson') and len(mg.get('rows', [])) == 1 and mg.get('options')

        if is_option_row and not mg.get('etiqueta'):
            results.append((mg, '', 0.0, False))
            continue

        scores = []
        for jf in json_fields:
            sn = jf['_sourceName']
            if sn in used:
                continue
            sc = score_match(mg, jf, section_scores)
            if sc > 0:
                scores.append((sc, sn, jf))

        scores.sort(key=lambda x: -x[0])

        if not scores:
            results.append((mg, '', 0.0, True))
            continue

        best_score = scores[0][0]
        best_sn = scores[0][1]

        ambiguous = False
        confidence = min(best_score / 50.0, 1.0)

        if len(scores) > 1:
            second_score = scores[1][0]
            if second_score > best_score * 0.85:
                ambiguous = True
                confidence *= 0.6

        if best_score < 10:
            ambiguous = True
            confidence = min(confidence, 0.3)

        used.add(best_sn)
        results.append((mg, best_sn, confidence, ambiguous))

    return results


# ─── Step 1: Write review XLSX ───────────────────────────────────────────────

def write_review_xlsx(original_path, matrix_rows, col_map, match_results, output_path):
    """Copy the original matrix and add sourceName_sugerido + sourceName_final columns."""
    wb = openpyxl.load_workbook(original_path)
    ws = wb.active

    max_col = ws.max_column
    col_sugerido = col_map.get('sourceNameSugerido')
    col_final = col_map.get('sourceNameFinal')

    if not col_sugerido:
        col_sugerido = max_col + 1
        ws.cell(row=1, column=col_sugerido, value='sourceName_sugerido')
    if not col_final:
        col_final = col_sugerido + 1
        ws.cell(row=1, column=col_final, value='sourceName_final')

    row_to_match = {}
    for mg, sn, conf, ambig in match_results:
        for r in mg.get('rows', [mg.get('primary', {})]):
            row_num = r.get('_row')
            if row_num:
                row_to_match[row_num] = (sn, conf, ambig)

    stats = {'resolved': 0, 'ambiguous': 0, 'empty': 0, 'final_set': 0}

    for r in range(2, ws.max_row + 1):
        match_data = row_to_match.get(r)
        if not match_data:
            continue

        sn, conf, ambig = match_data

        existing_final = ws.cell(row=r, column=col_final).value
        if existing_final:
            stats['final_set'] += 1
            continue

        ws.cell(row=r, column=col_sugerido, value=sn if sn else '')

        if ambig or conf < 0.5:
            ws.cell(row=r, column=col_sugerido).fill = YELLOW_FILL
            ws.cell(row=r, column=col_final).fill = YELLOW_FILL
            stats['ambiguous'] += 1
        elif sn:
            stats['resolved'] += 1
        else:
            stats['empty'] += 1

    wb.save(output_path)
    wb.close()

    print(f"\n  Guardado: {output_path}")
    print(f"    {stats['resolved']} filas con match confiable")
    print(f"    {stats['ambiguous']} filas amarillas (revisar manualmente)")
    print(f"    {stats['final_set']} filas con sourceName_final ya definido")
    print(f"    {stats['empty']} filas sin match")
    return stats


# ─── Step 2: Generate form-definition JSON ───────────────────────────────────

def resolve_source_name(mg):
    """Return the resolved sourceName: final > sugerido."""
    final = mg.get('sourceNameFinal')
    if final and str(final).strip():
        return str(final).strip()
    sug = mg.get('sourceNameSugerido')
    if sug and str(sug).strip():
        return str(sug).strip()
    return ''


def resolve_type(mg):
    tipo = norm(mg.get('tipoDato', ''))
    if tipo in TYPE_MAP:
        return TYPE_MAP[tipo]
    return 'text'


def enrich_field(field, mg, all_groups):
    """Enrich a JSON field with matrix data. NEVER touch id or sourceMeta."""

    field['label'] = mg.get('etiqueta') or field.get('label', '')
    field['required'] = mg.get('obligatorio', False)

    if field.get('sourceMeta'):
        field['readOnly'] = False
    elif field.get('readOnly') is None:
        field['readOnly'] = False

    ftype = resolve_type(mg)
    field['type'] = ftype

    path_raw = mg.get('pathJson')
    if path_raw:
        paths = [p.strip() for p in str(path_raw).replace('\n', ',').split(',') if p.strip()]
        if paths:
            field['salidaJSON'] = paths[0]
            field['jsonOutputPath'] = paths[0]
            field['prefillKey'] = paths[0]
            field['excludeFromJson'] = False
            if len(paths) > 1:
                field['mappedPaths'] = paths[1:]
    elif not field.get('salidaJSON'):
        field['excludeFromJson'] = True

    vis = norm(mg.get('visualizacion', ''))
    if 'disabled' in vis:
        field['readOnly'] = True
    if 'no visible' in vis:
        field['hidden'] = True

    if ftype == 'checkbox' and field.get('sourceMeta'):
        field['checkedPdfValue'] = True
        field['checkedJsonValue'] = True

    if mg.get('options'):
        field['options'] = [{'value': v, 'label': v} for v in mg['options']]

    if ftype == 'date':
        field['width'] = 'half'

    if 'conditionalVisibility' not in field:
        field['conditionalVisibility'] = None
    if 'conditionalRequired' not in field:
        field['conditionalRequired'] = None

    return field


def organize_sections(fields_with_section, unmatched_fields):
    """Organize fields into sections based on matrix seccion column."""
    seen = set()
    section_order = []
    section_fields = {}

    for field, sec_name in fields_with_section:
        if sec_name not in seen:
            seen.add(sec_name)
            section_order.append(sec_name)
            section_fields[sec_name] = []
        section_fields[sec_name].append(field)

    sections = []
    sec_idx = 1
    for sec_name in section_order:
        flds = section_fields[sec_name]
        for i, f in enumerate(flds):
            f['order'] = i + 1

        sec_id = 'section_' + to_key(sec_name)
        sub_id = 'subsection_' + to_key(sec_name)
        clean_title = title_case(sec_name)

        subsection = {
            'id': sub_id,
            'title': clean_title,
            'order': 1,
            'fields': flds,
            'childrenOrder': [{'kind': 'field', 'id': f['id']} for f in flds],
        }
        sections.append({
            'id': sec_id,
            'title': clean_title,
            'order': sec_idx,
            'subsections': [subsection],
            'childrenOrder': [{'kind': 'subsection', 'id': sub_id}],
        })
        sec_idx += 1

    if unmatched_fields:
        for i, f in enumerate(unmatched_fields):
            f['order'] = i + 1
        sub_id = 'subsection_sistema_oculto'
        subsection = {
            'id': sub_id,
            'title': 'Datos del Sistema (oculto)',
            'order': 1,
            'conditionalVisibility': NEVER_CONDITION,
            'fields': unmatched_fields,
            'childrenOrder': [{'kind': 'field', 'id': f['id']} for f in unmatched_fields],
        }
        sections.append({
            'id': 'section_sistema',
            'title': 'Sistema',
            'order': sec_idx,
            'subsections': [subsection],
            'childrenOrder': [{'kind': 'subsection', 'id': sub_id}],
        })

    return sections


def generate_form_definition(sf_data, json_fields, matrix_groups, match_results, output_path):
    """Generate the enriched form-definition JSON."""
    warnings = []

    sn_to_group = {}
    for mg, sn, conf, ambig in match_results:
        resolved = resolve_source_name(mg)
        if not resolved:
            resolved = sn
        if resolved:
            sn_to_group[resolved] = mg

    fields_with_section = []
    unmatched = []

    for jf in json_fields:
        sn = jf['_sourceName']
        mg = sn_to_group.get(sn)

        if mg:
            enrich_field(jf, mg, matrix_groups)
            sec = mg.get('seccion', 'Sin Seccion')
            fields_with_section.append((jf, str(sec).strip()))
        else:
            unmatched.append(jf)

        if jf.get('repeaterConfig'):
            warnings.append(f"Field '{jf.get('id')}' tiene repeaterConfig -> preservado, revisar manualmente")

    sections = organize_sections(fields_with_section, unmatched)

    for sec in sections:
        for sub in sec.get('subsections', []):
            for f in sub.get('fields', []):
                if f.get('order', 0) == 0:
                    f['order'] = 1
                cv = f.get('conditionalVisibility')
                if cv and isinstance(cv, str):
                    try:
                        parsed = json.loads(cv)
                        changed = False
                        for c in parsed.get('conditions', []):
                            if c.get('operator') and c['operator'] not in VALID_OPERATORS:
                                c['operator'] = 'not_empty'
                                changed = True
                            if c.get('fieldId', '').startswith('field_') is False and c.get('fieldId'):
                                c['fieldId'] = 'field_' + c['fieldId']
                                changed = True
                        if changed:
                            f['conditionalVisibility'] = json.dumps(parsed)
                    except json.JSONDecodeError:
                        pass

    output = {}
    for k in sf_data:
        if k == 'sections':
            continue
        output[k] = sf_data[k]
    output['sections'] = sections

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total = sum(len(sub.get('fields', []))
                for sec in sections for sub in sec.get('subsections', []))

    print(f"\n  Generado: {output_path}")
    print(f"    {len(sections)} secciones")
    print(f"    {total} campos totales")
    print(f"    {len(fields_with_section)} con match")
    print(f"    {len(unmatched)} sin match (-> Sistema)")

    return warnings


# ─── Report ──────────────────────────────────────────────────────────────────

def write_report(match_results, json_fields, warnings, report_path):
    lines = []
    lines.append("=" * 60)
    lines.append("REPORTE DE COMBINACION")
    lines.append("=" * 60)

    resolved = sum(1 for _, sn, c, a in match_results if sn and c >= 0.5)
    ambiguous = sum(1 for _, sn, c, a in match_results if a)
    empty = sum(1 for _, sn, c, a in match_results if not sn)
    final_set = sum(1 for mg, _, _, _ in match_results if mg.get('sourceNameFinal'))

    used_sns = set()
    for _, sn, _, _ in match_results:
        if sn:
            used_sns.add(sn)

    unmatched_json = [jf for jf in json_fields if jf['_sourceName'] not in used_sns]

    lines.append(f"\nFilas de matriz: {len(match_results)}")
    lines.append(f"  Resueltas (confianza >= 0.5): {resolved}")
    lines.append(f"  Ambiguas (amarillas): {ambiguous}")
    lines.append(f"  Sin match: {empty}")
    lines.append(f"  Con sourceName_final fijo: {final_set}")
    lines.append(f"\nCampos en signframe JSON: {len(json_fields)}")
    lines.append(f"  Con match en matriz: {len(used_sns)}")
    lines.append(f"  Sin match (-> Sistema): {len(unmatched_json)}")

    dups = {}
    for _, sn, _, _ in match_results:
        if sn:
            dups[sn] = dups.get(sn, 0) + 1
    conflicts = {k: v for k, v in dups.items() if v > 1}
    if conflicts:
        lines.append(f"\nCONFLICTOS (mismo sourceName asignado a multiples filas):")
        for sn, count in conflicts.items():
            lines.append(f"  {sn}: {count} filas")

    if warnings:
        lines.append(f"\nWARNINGS ({len(warnings)}):")
        for w in warnings:
            lines.append(f"  {w}")

    if ambiguous:
        lines.append(f"\nFILAS AMBIGUAS (revisar en matriz_revisar.xlsx):")
        for mg, sn, conf, ambig in match_results:
            if ambig:
                lines.append(f"  Fila {mg.get('primary', {}).get('_row', '?')}: "
                           f"'{mg.get('etiqueta', '')}' -> '{sn}' (conf={conf:.2f})")

    report = '\n'.join(lines)
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"\n  Reporte: {report_path}")
    print(report)
    return report


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Combine signframe.json + matriz.xlsx')
    parser.add_argument('--signframe', default='./signframe.json')
    parser.add_argument('--matriz', default='./Matriz_Formularios_VidaColectiva_Secciones.xlsx')
    parser.add_argument('--output-xlsx', default='./matriz_revisar.xlsx')
    parser.add_argument('--output-json', default='./form-definition-final.json')
    parser.add_argument('--report', default='./reporte.txt')
    parser.add_argument('--step', type=int, default=0, help='1=solo XLSX, 2=solo JSON, 0=ambos')
    args = parser.parse_args()

    print("Leyendo signframe.json...")
    sf_data = read_signframe(args.signframe)
    json_fields = extract_json_fields(sf_data)
    print(f"  {len(json_fields)} campos extraidos")

    print("Leyendo matriz...")
    matrix_rows, col_map = read_matriz(args.matriz)

    print("Colapsando filas de opciones...")
    matrix_groups = collapse_option_rows(matrix_rows)
    print(f"  {len(matrix_rows)} filas -> {len(matrix_groups)} campos logicos")

    print("Ejecutando fuzzy matching...")
    match_results = match_all(matrix_groups, json_fields)

    if args.step in (0, 1):
        print("\n--- PASO 1: Generar matriz_revisar.xlsx ---")
        write_review_xlsx(args.matriz, matrix_rows, col_map, match_results, args.output_xlsx)

    warnings = []
    if args.step in (0, 2):
        print("\n--- PASO 2: Generar form-definition-final.json ---")
        warnings = generate_form_definition(
            sf_data, json_fields, matrix_groups, match_results, args.output_json
        )

    write_report(match_results, json_fields, warnings, args.report)
    print("\nDone.")


if __name__ == '__main__':
    main()
