// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

/**
 * Helper to get localized string from data.
 * Handles object (i18n) formats only.
 */
export function getLocalized(val, language) {
    if (val && typeof val === 'object' && language in val) {
        return val[language];
    }
    return '';
}

export const getUnit = (dim) => {
    if (dim === "mass") return "kg";
    if (dim === "duration") return "s";
    if (dim === "energy") return "J";
    return "m";
};

export const parseValue = (val) => {
    if (val === undefined || val === null) return { value: NaN, type: "equal" };
    if (Array.isArray(val)) {
        return { value: Number(val[0]), value2: Number(val[1]), type: "range" };
    }
    const s = String(val);
    if (s.startsWith(">")) return { value: Number(s.slice(1)), type: "greater" };
    if (s.startsWith("<")) return { value: Number(s.slice(1)), type: "less" };
    return { value: Number(s), type: "equal" };
};

export const getDimensionValueY = (d, currentDimensionY) => parseValue(d.dimensions[currentDimensionY]).value;

export const getDimensionValueX = (d, currentDimensionX, currentDimensionY) => {
    if (currentDimensionX === "none") {
        return d.x_coordinates[currentDimensionY];
    } else {
        return parseValue(d.dimensions[currentDimensionX]).value;
    }
};

export const getFilteredData = (dataList, currentDimensionX, currentDimensionY) => {
    if (currentDimensionX === "none") {
        // 1D Mode: Show items that have the Y dimension AND valid x_coordinates for that dimension
        return dataList.filter(d =>
            d.dimensions[currentDimensionY] !== undefined &&
            d.x_coordinates[currentDimensionY] !== undefined
        );
    } else {
        // 2D Mode: Strictly no ranges. Exclude if either X or Y is an array.
        return dataList.filter(d => {
            const valY = d.dimensions[currentDimensionY];
            const valX = d.dimensions[currentDimensionX];

            const passes2D = (
                valY !== undefined && !Array.isArray(valY) &&
                valX !== undefined && !Array.isArray(valX)
            );

            if (!passes2D) return false;

            // Further approach: If X and Y are the same, also require x_coordinates for visual consistency with 1D
            if (currentDimensionX === currentDimensionY) {
                return d.x_coordinates[currentDimensionY] !== undefined;
            }

            return true;
        });
    }
};

export const formatRelative = (ratio) => {
    if (Math.abs(ratio - 1) < 0.001) return "1.00";
    // Always use scientific notation for consistency with absolute values
    const exp = ratio.toExponential(2);
    const [mantissa, exponent] = exp.split('e');
    const expVal = parseInt(exponent, 10);
    return `${mantissa} × 10^${expVal}`;
};

export const formatAbsolute = (diff, dim) => {
    const unit = getUnit(dim);
    if (Math.abs(diff) === 0) return `0 ${unit}`;
    const exp = diff.toExponential(2);
    const [mantissa, exponent] = exp.split('e');
    const sign = diff > 0 ? "+" : "";
    return `${sign}${mantissa} × 10^${parseInt(exponent, 10)} ${unit}`;
};

/**
 * Overrides a display name with an isotope-specific tag if applicable.
 * 
 * @param {string} name - The localized display name.
 * @param {string[]} tags - The localized tags array for the item.
 * @param {string} dimX - Current X dimension name.
 * @param {string} dimY - Current Y dimension name.
 * @returns {string} The original name or the isotope override.
 */
export const getLabelWithIsotopeOverride = (name, tags, dimX, dimY) => {
    const isMassOrDuration = dimX === "mass" || dimX === "duration" ||
        dimY === "mass" || dimY === "duration";

    if (isMassOrDuration && name && name.match(/^[A-Z][a-z]?$/)) {
        const isotopeTag = (tags || []).find(tag => {
            const match = tag.match(/^([A-Z][a-z]?)-\d+$/);
            return match && match[1] === name;
        });
        return isotopeTag || name;
    }
    return name;
};

