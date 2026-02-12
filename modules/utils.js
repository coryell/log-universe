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
        return dataList.filter(d => d.dimensions[currentDimensionY] !== undefined && d.x_coordinates[currentDimensionY] !== undefined);
    } else {
        // 2D Mode: Strictly no ranges. Exclude if either X or Y is an array.
        return dataList.filter(d => {
            const valY = d.dimensions[currentDimensionY];
            const valX = d.dimensions[currentDimensionX];
            return (
                valY !== undefined && !Array.isArray(valY) &&
                valX !== undefined && !Array.isArray(valX)
            );
        });
    }
};
