// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

/**
 * Data Processor Module
 * Handles validation and numerical coercion of the raw JSON data.
 */

const dimensionRegex = /^[<>]?[1-9](\.\d+)?[eE][-+]?\d+$/;

/**
 * Validates and transforms raw data points.
 * @param {Array} rawData - The raw JSON data from data.json
 * @returns {Array} - The validated and processed data array
 */
export function processData(rawData) {
    const data = rawData.filter(d => {
        // Validate Dimensions
        if (!d.dimensions) {
            d.dimensions = {};
        } else {
            for (const [dim, val] of Object.entries(d.dimensions)) {
                if (Array.isArray(val)) {
                    if (val.length !== 2 || !val.every(v => typeof v === 'string' && /^[1-9](\.\d+)?[eE][-+]?\d+$/.test(v))) {
                        const reason = val.some(v => typeof v === 'string' && v.startsWith('-'))
                            ? "negative quantities aren't allowed"
                            : "Expected exactly 2 strictly scientific notation strings";
                        console.error(`Skipping data point "${d.id || d.displayName?.['en-us'] || 'Unknown'}": Invalid dimension array "${dim}". ${reason}.`);
                        return false;
                    }
                } else if (typeof val !== 'string' || !dimensionRegex.test(val)) {
                    const reason = (typeof val === 'string' && val.startsWith('-'))
                        ? "negative quantities aren't allowed"
                        : `Expected scientific notation like "1.23e+4"`;
                    console.error(`Skipping data point "${d.id || d.displayName?.['en-us'] || 'Unknown'}": Invalid dimension "${dim}" format ("${val}"). ${reason}.`);
                    return false;
                }
            }
        }

        // Validate X Coordinates
        if (!d.x_coordinates) {
            d.x_coordinates = {};
        } else {
            for (const [key, val] of Object.entries(d.x_coordinates)) {
                if (typeof val !== 'string' || val.trim() === '' || isNaN(Number(val))) {
                    console.error(`Skipping data point "${d.id || d.displayName?.['en-us'] || 'Unknown'}": Invalid x_coordinate "${key}" format ("${val}"). Expected a numerical string.`);
                    return false;
                }
            }
        }

        return true;
    });

    // Data Processing (Numerical Coercion)
    data.forEach(d => {
        // Store original strings for exact comparison
        d._orig_dimensions = { ...d.dimensions };

        if (!d.x_coordinates) d.x_coordinates = {};
        d._orig_x_coordinates = { ...d.x_coordinates };

        // Numerical coercion for calculations
        for (const key in d.x_coordinates) d.x_coordinates[key] = +d.x_coordinates[key];
    });

    return data;
}
