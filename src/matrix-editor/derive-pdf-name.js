'use strict';

function deriveFromJsonPath(jsonPath) {
    if (!jsonPath || !jsonPath.trim()) return null;
    const firstPath = String(jsonPath).split(/[,\n]/)[0].trim();
    const leaf = firstPath.split('.').pop();
    if (!leaf) return null;
    return leaf
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
        .replace(/_+/g, '_');
}

module.exports = { deriveFromJsonPath };
