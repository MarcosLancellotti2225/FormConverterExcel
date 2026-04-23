'use strict';

function applyConditionals(field, excelRow, fieldLookup) {
    const text = joinTexts(excelRow.rule, excelRow.obs);
    if (!text) return null;

    const n = norm(text);

    const triggerRe = /si\s+(?:se\s+)?(?:selecciona|elige|marca)n?\s+(.+?)\s+se\s+(?:debe(?:\s+de)?\s+)?(?:habilitar?|desplegar?|mostrar?|visualizar?)\s+(?:el\s+campo\s+)?(.+)/;
    const mA = n.match(triggerRe);
    if (mA) {
        const triggerValue = cleanVal(mA[1]);
        const targetLabel = cleanVal(mA[2]);
        return {
            kind: 'trigger',
            triggerFieldId: field.id,
            triggerValue,
            targetLabel,
        };
    }

    const despRe = /si\s+(?:se\s+)?(?:selecciona|elige|marca)n?\s+(.+?)\s+se\s+despliega/;
    const mD = n.match(despRe);
    if (mD) {
        return {
            kind: 'trigger',
            triggerFieldId: field.id,
            triggerValue: cleanVal(mD[1]),
            targetLabel: null,
        };
    }

    const depRe = /si\s+(?:el\s+campo\s+|el\s+|la\s+)?(.+?)\s+(?:es|=|==|igual\s+a)\s+(.+)/;
    const mB = n.match(depRe);
    if (mB) {
        const depLabel = cleanVal(mB[1]);
        const depValue = cleanVal(mB[2]);
        const depField = fieldLookup(depLabel);
        if (depField) {
            field.conditionalVisibility = JSON.stringify({
                logic: 'AND',
                conditions: [{
                    fieldId: depField.id,
                    operator: 'equals',
                    value: depValue,
                }]
            });
            return null;
        }
    }

    const depSimple = n.match(/depende\s+de\s+(.+)/);
    if (depSimple) {
        const depLabel = cleanVal(depSimple[1]);
        const depField = fieldLookup(depLabel);
        if (depField) {
            field.conditionalVisibility = JSON.stringify({
                logic: 'AND',
                conditions: [{
                    fieldId: depField.id,
                    operator: 'not_empty',
                }]
            });
            return null;
        }
    }

    return null;
}

function resolveTriggers(triggers, allFields, warnings) {
    const byLabel = new Map();
    const byId = new Map();
    for (const f of allFields) {
        byId.set(f.id, f);
        const nl = norm(f.label || '');
        if (nl) byLabel.set(nl, f);
        const sn = (f.sourceMeta?.sourceName || '').replace(/_/g, ' ').toLowerCase();
        if (sn) byLabel.set(sn, f);
    }

    for (const t of triggers) {
        if (!t.targetLabel) {
            warnings.push({
                stage: 'enrich', type: 'rule-not-parsed',
                field: t.triggerFieldId,
                reason: `Trigger rule found but target field unclear`,
            });
            continue;
        }

        const target = byLabel.get(norm(t.targetLabel));
        if (!target) {
            warnings.push({
                stage: 'enrich', type: 'rule-not-parsed',
                field: t.triggerFieldId,
                reason: `Could not resolve target "${t.targetLabel}" for trigger`,
            });
            continue;
        }

        target.conditionalVisibility = JSON.stringify({
            logic: 'AND',
            conditions: [{
                fieldId: t.triggerFieldId,
                operator: 'equals',
                value: t.triggerValue,
            }]
        });
    }
}

function joinTexts(...parts) {
    return parts.filter(Boolean).join(' · ');
}

function cleanVal(s) {
    return String(s || '').replace(/[.,:;]+$/, '').replace(/^['"]+|['"]+$/g, '').trim();
}

function norm(s) {
    return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ').trim();
}

module.exports = { applyConditionals, resolveTriggers };
