import { getDimensionValueX, getDimensionValueY, getLocalized, getFilteredData } from './utils.js';

/**
 * Identifies groups of data points that share the same coordinates.
 * Returns an array of "combined" data objects representing these groups.
 */
/**
 * Normalizes numerical strings for grouping comparison.
 * - Removes trailing mantissa zeros.
 * - Removes '+' from exponent.
 * - Removes trailing zeros from standard numbers.
 */
function normalizeValue(val) {
    if (val === undefined || val === null) return val;
    let s = String(val);

    // Handle scientific notation
    if (s.includes('e') || s.includes('E')) {
        let parts = s.toLowerCase().split('e');
        let mantissa = parts[0];
        let exponent = parts[1];

        // Remove trailing zeros from mantissa
        if (mantissa.includes('.')) {
            mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
        }

        // Remove plus sign from exponent
        if (exponent.startsWith('+')) {
            exponent = exponent.substring(1);
        }

        return `${mantissa}e${exponent}`;
    }

    // Handle standard numbers (like x coords in 1D view)
    if (s.includes('.')) {
        s = s.replace(/0+$/, '').replace(/\.$/, '');
    }

    return s;
}

export function getClusters(data, currentDimensionX, currentDimensionY, language) {
    if (!data) return [];

    const groups = new Map();
    const filteredData = getFilteredData(data, currentDimensionX, currentDimensionY);

    filteredData.forEach(d => {
        // Use original dimensions to group by exact values, but normalized
        const valY = normalizeValue(d._orig_dimensions && d._orig_dimensions[currentDimensionY]);
        let valX;

        if (currentDimensionX === "none") {
            valX = normalizeValue(d._orig_x_coordinates && d._orig_x_coordinates[currentDimensionY]);
        } else {
            valX = normalizeValue(d._orig_dimensions && d._orig_dimensions[currentDimensionX]);
        }

        const key = `y:${valY}|x:${valX}`;

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
