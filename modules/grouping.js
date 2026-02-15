import { getDimensionValueX, getDimensionValueY, getLocalized, getFilteredData } from './utils.js';

/**
 * Identifies groups of data points that share the same coordinates.
 * Returns an array of "combined" data objects representing these groups.
 */
export function getClusters(data, currentDimensionX, currentDimensionY, language) {
    if (!data) return [];

    const groups = new Map();
    const filteredData = getFilteredData(data, currentDimensionX, currentDimensionY);

    filteredData.forEach(d => {
        let key = "";
        // Use original dimensions to group by exact values before numerical coercion/rounding might occur
        if (currentDimensionX === "none") {
            key = `y:${d._orig_dimensions[currentDimensionY]}|x:${d._orig_x_coordinates[currentDimensionY]}`;
        } else {
            key = `y:${d._orig_dimensions[currentDimensionY]}|x:${d._orig_dimensions[currentDimensionX]}`;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
    });

    const clusters = [];
    groups.forEach((members, key) => {
        if (members.length > 1) {
            const first = members[0];
            const combinedDisplayName = members.map(m => getLocalized(m.displayName, language)).join(" / ");

            // Create a combined data object
            const combinedData = {
                ...first, // Inherit properties from first member (like color/category) for defaults
                id: `combined-${key}`,
                displayName: { [language]: combinedDisplayName },
                _isCombined: true,
                _members: members // Store original members for drill-down/reference
            };
            clusters.push(combinedData);
        }
    });

    return clusters;
}
