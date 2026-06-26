'use strict';

var c = require('./constants');

function classifySection(seccionPdf) {
    if (!seccionPdf) return { sectionKey: 'datos_generales', subsectionKey: 'solicitud' };
    var lower = seccionPdf.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    for (var subKey in c.SECTION_KEYWORDS) {
        var keywords = c.SECTION_KEYWORDS[subKey];
        for (var k = 0; k < keywords.length; k++) {
            var kw = keywords[k].normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (lower.indexOf(kw) !== -1) {
                var parentKey = findParentSection(subKey);
                return { sectionKey: parentKey, subsectionKey: subKey };
            }
        }
    }

    return { sectionKey: 'datos_generales', subsectionKey: 'solicitud' };
}

function findParentSection(subKey) {
    for (var i = 0; i < c.SECTION_ORDER.length; i++) {
        var sec = c.SECTION_ORDER[i];
        for (var j = 0; j < sec.subsections.length; j++) {
            if (sec.subsections[j].key === subKey) return sec.key;
        }
    }
    return 'datos_generales';
}

function organizeIntoSections(fields, matrixRows) {
    var buckets = {};

    for (var i = 0; i < c.SECTION_ORDER.length; i++) {
        var sec = c.SECTION_ORDER[i];
        buckets[sec.key] = {};
        for (var j = 0; j < sec.subsections.length; j++) {
            buckets[sec.key][sec.subsections[j].key] = [];
        }
    }
    buckets._unclassified = { _unclassified: [] };

    for (var fi = 0; fi < fields.length; fi++) {
        var field = fields[fi];
        var matrixRow = matrixRows[fi] || null;
        var secPdf = matrixRow ? matrixRow.seccionPdf : '';
        var cls = classifySection(secPdf);

        if (buckets[cls.sectionKey] && buckets[cls.sectionKey][cls.subsectionKey]) {
            buckets[cls.sectionKey][cls.subsectionKey].push(field);
        } else if (buckets[cls.sectionKey]) {
            var firstSub = Object.keys(buckets[cls.sectionKey])[0];
            buckets[cls.sectionKey][firstSub].push(field);
        } else {
            buckets._unclassified._unclassified.push(field);
        }
    }

    return buildSectionsArray(buckets);
}

function buildSectionsArray(buckets) {
    var sections = [];
    var sectionOrder = 1;

    for (var si = 0; si < c.SECTION_ORDER.length; si++) {
        var secDef = c.SECTION_ORDER[si];
        var subsections = [];
        var subsectionOrder = 1;
        var hasFields = false;

        for (var ssi = 0; ssi < secDef.subsections.length; ssi++) {
            var subDef = secDef.subsections[ssi];
            var subFields = (buckets[secDef.key] && buckets[secDef.key][subDef.key]) || [];

            for (var f = 0; f < subFields.length; f++) {
                subFields[f].order = f + 1;
            }

            if (subFields.length > 0) hasFields = true;

            var subsection = {
                id: 'subsection_' + secDef.key + '_' + subDef.key,
                title: subDef.title,
                order: subsectionOrder++,
                fields: subFields,
                childrenOrder: subFields.map(function (f) { return f.id; }),
            };

            if (subDef.hidden) {
                subsection.conditionalVisibility = c.NEVER_CONDITION;
            }

            subsections.push(subsection);
        }

        if (!hasFields) continue;

        sections.push({
            id: 'section_' + secDef.key,
            title: secDef.title,
            order: sectionOrder++,
            subsections: subsections,
            childrenOrder: subsections.map(function (s) { return s.id; }),
        });
    }

    if (buckets._unclassified && buckets._unclassified._unclassified.length > 0) {
        var uncFields = buckets._unclassified._unclassified;
        for (var u = 0; u < uncFields.length; u++) uncFields[u].order = u + 1;
        sections.push({
            id: 'section_otros',
            title: 'Otros campos',
            order: sectionOrder++,
            subsections: [{
                id: 'subsection_otros',
                title: 'Campos sin clasificar',
                order: 1,
                fields: uncFields,
                childrenOrder: uncFields.map(function (f) { return f.id; }),
            }],
            childrenOrder: ['subsection_otros'],
        });
    }

    return sections;
}

module.exports = { organizeIntoSections, classifySection };
