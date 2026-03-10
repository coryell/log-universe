// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

import { getDimensionValueX, getDimensionValueY, getLocalized, getFilteredData } from './utils.js';
import { GROUP_SEPARATOR } from './constants.js';

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
            // Sort by localized label length (shortest to longest)
            members.sort((a, b) => {
                const nameA = getLocalized(a.displayName, language) || "";
                const nameB = getLocalized(b.displayName, language) || "";
                return nameA.length - nameB.length;
            });

            const first = members[0];
            // Truncation Logic (Limit ~30 chars)

            const charLimit = 30;
            let currentLen = 0;
            const labelMembers = [];

            for (const m of members) {
                const name = getLocalized(m.displayName, language);
                // Always include at least one
                if (labelMembers.length === 0 || (currentLen + name.length + 3) <= charLimit) {
                    labelMembers.push(m);
                    currentLen += name.length + (labelMembers.length > 1 ? GROUP_SEPARATOR.length : 0);
                } else {
                    break;
                }
            }

            const hiddenCount = members.length - labelMembers.length;

            // Construct display string for text width estimation
            let combinedDisplayName = labelMembers.map(m => getLocalized(m.displayName, language)).join(GROUP_SEPARATOR);
            if (hiddenCount > 0) {
                combinedDisplayName += ` (+ ${hiddenCount} ${hiddenCount === 1 ? 'other' : 'others'})`;
            }

            // Create a combined data object
            const combinedData = {
                ...first, // Inherit properties from first member (like color/category) for defaults
                id: `combined-${key}`,
                displayName: { [language]: combinedDisplayName },
                _isCombined: true,
                _members: members, // Store all original members (for infobox)
                _labelMembers: labelMembers, // Store only visible members (for label rendering)
                _hiddenCount: hiddenCount // Store count of hidden members
            };
            clusters.push(combinedData);
        }
    });

    return clusters;
}
