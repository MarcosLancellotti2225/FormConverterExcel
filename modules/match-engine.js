/**
 * Match Engine Module
 * Fuzzy-matches spec fields ↔ questions ↔ PDF field names
 */
const MatchEngine = (() => {
    'use strict';

    let _matches = [];

    /**
     * Run auto-match between spec fields, questions, and PDF fields
     * @param {Array} specFields - normalized fields from FieldManager
     * @param {Array} questions  - [{fieldId, question, section, hint}]
     * @param {Array} pdfFields  - [{name, raw}]
     * @returns {Array} match results
     */
    function autoMatch(specFields, questions, pdfFields) {
        _matches = specFields.map(field => {
            const result = {
                fieldId: field.id,
                fieldName: field.fieldName,
                section: field.section,
                step: field.step,
                // Question match
                questionMatch: null,
                questionScore: 0,
                questionText: '',
                // PDF match
                pdfMatch: null,
                pdfScore: 0,
                pdfName: field.pdfField || '',
                // Override flags
                questionOverride: false,
                pdfOverride: false
            };

            // Match against questions
            if (questions && questions.length > 0) {
                const qMatch = findBestMatch(field, questions, 'question');
                if (qMatch) {
                    result.questionMatch = qMatch.item;
                    result.questionScore = qMatch.score;
                    result.questionText = qMatch.item.question;
                }
            }

            // Match against PDF fields
            if (pdfFields && pdfFields.length > 0 && !field.pdfField) {
                const pMatch = findBestPdfMatch(field, pdfFields);
                if (pMatch) {
                    result.pdfMatch = pMatch.item;
                    result.pdfScore = pMatch.score;
                    result.pdfName = pMatch.item.name;
                }
            }

            return result;
        });

        return _matches;
    }

    /**
     * Find the best matching question for a field
     */
    function findBestMatch(field, questions, textKey) {
        let best = null;
        let bestScore = 0;

        const fieldText = normalize(field.fieldName);
        const fieldSection = normalize(field.section);

        for (const q of questions) {
            let score = 0;

            // 1. Direct ID match (highest confidence)
            if (q.fieldId && normalize(q.fieldId) === fieldText) {
                score = 1.0;
            } else {
                const qText = normalize(q[textKey] || '');
                const qFieldId = normalize(q.fieldId || '');

                // 2. Fuzzy text similarity
                const simFieldName = similarity(fieldText, qText);
                const simFieldId = qFieldId ? similarity(fieldText, qFieldId) : 0;
                score = Math.max(simFieldName, simFieldId);

                // 3. Section bonus
                if (q.section && fieldSection) {
                    const secSim = similarity(fieldSection, normalize(q.section));
                    if (secSim > 0.6) score += 0.1;
                }

                // 4. Containment bonus
                if (qText.includes(fieldText) || fieldText.includes(qText)) {
                    score = Math.max(score, 0.7);
                }
            }

            if (score > bestScore && score >= 0.3) {
                bestScore = score;
                best = { item: q, score };
            }
        }

        return best;
    }

    /**
     * Find the best matching PDF field name
     */
    function findBestPdfMatch(field, pdfFields) {
        let best = null;
        let bestScore = 0;
        const fieldText = normalize(field.fieldName);

        for (const pf of pdfFields) {
            const pfText = normalize(pf.name);
            let score = similarity(fieldText, pfText);

            // Containment bonus
            if (pfText.includes(fieldText) || fieldText.includes(pfText)) {
                score = Math.max(score, 0.65);
            }

            if (score > bestScore && score >= 0.3) {
                bestScore = score;
                best = { item: pf, score };
            }
        }

        return best;
    }

    /**
     * Get all matches
     */
    function getMatches() {
        return _matches;
    }

    /**
     * Update a specific match (user correction)
     */
    function updateMatch(fieldId, updates) {
        const match = _matches.find(m => m.fieldId === fieldId);
        if (match) Object.assign(match, updates);
    }

    /**
     * Get match statistics
     */
    function getStats() {
        const total = _matches.length;
        const qMatched = _matches.filter(m => m.questionMatch || m.questionOverride).length;
        const pdfMatched = _matches.filter(m => m.pdfName).length;
        const highConf = _matches.filter(m => m.questionScore >= 0.7 || m.pdfScore >= 0.7).length;
        const lowConf = _matches.filter(m =>
            (m.questionMatch && m.questionScore < 0.5) ||
            (m.pdfMatch && m.pdfScore < 0.5)
        ).length;
        const unmatched = _matches.filter(m => !m.questionMatch && !m.questionOverride && !m.pdfName).length;

        return { total, qMatched, pdfMatched, highConf, lowConf, unmatched };
    }

    /**
     * Apply matches to FieldManager fields
     */
    function applyToFields() {
        for (const match of _matches) {
            const updates = {};

            // Apply question as custom label
            if (match.questionText) {
                updates.customLabel = match.questionText;
            }

            // Apply question hint as placeholder
            if (match.questionMatch && match.questionMatch.hint) {
                updates.placeholder = match.questionMatch.hint;
            }

            // Apply PDF field name
            if (match.pdfName) {
                updates.pdfField = match.pdfName;
            }

            if (Object.keys(updates).length > 0) {
                FieldManager.updateField(match.fieldId, updates);
            }
        }
    }

    // === String Similarity (Dice coefficient) ===

    function normalize(str) {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function bigrams(str) {
        const set = new Map();
        for (let i = 0; i < str.length - 1; i++) {
            const bi = str.substring(i, i + 2);
            set.set(bi, (set.get(bi) || 0) + 1);
        }
        return set;
    }

    function similarity(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;

        const biA = bigrams(a);
        const biB = bigrams(b);

        let intersection = 0;
        for (const [bi, count] of biA) {
            if (biB.has(bi)) {
                intersection += Math.min(count, biB.get(bi));
            }
        }

        const totalA = a.length - 1;
        const totalB = b.length - 1;
        if (totalA + totalB === 0) return 0;

        return (2 * intersection) / (totalA + totalB);
    }

    return {
        autoMatch,
        getMatches,
        updateMatch,
        getStats,
        applyToFields
    };
})();
