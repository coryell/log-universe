
import { getLocalized } from './utils.js';

/**
 * Helper to get localized string from data.
 * Handles object (i18n) formats only.
 */
// Removed local definition

/**
 * Splits a string into tokens based on SPACES ONLY.
 * Parentheses and other chars are part of the token.
 * @param {string} text 
 * @returns {string[]}
 */
export function tokenize(text) {
    if (!text) return [];
    // Split by whitespace only, filter out empty strings
    return text.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Escapes special characters for Regex.
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a query string matches a data item's display name.
 * Rule:
 * - Query tokens split by space.
 * - Non-last tokens must be EXACT word matches in target.
 * - Last token must be PREFIX word match in target.
 * - "Word match" means preceded by Start or Delimiter ([\s()/\-]).
 * - "Exact" means followed by End or Delimiter.
 */
/**
 * Checks if a single token matches a target string.
 * @param {string} target - Lowercase target string
 * @param {string} token - Lowercase query token
 * @param {boolean} isLast - Is this the last token in the query?
 */
function tokenMatches(target, token, isLast) {
    const safeToken = escapeRegExp(token);
    const startBoundary = `(?:^|[\\s()/\-])`;
    let pattern;
    if (isLast) {
        pattern = `${startBoundary}${safeToken}`;
    } else {
        const endBoundary = `(?=$|[\\s()/\-])`;
        pattern = `${startBoundary}${safeToken}${endBoundary}`;
    }
    return new RegExp(pattern).test(target);
}

/**
 * Checks if a query string matches a data item's display name OR tags.
 * Rule:
 * - Query tokens split by space.
 * - EACH token must match EITHER the Display Name OR AT LEAST ONE Tag.
 * - Non-last tokens must be EXACT word matches.
 * - Last token must be PREFIX word match.
 */
export function isMatch(item, query, language) {
    if (!query) return false;
    if (!item) return false;

    const queryTokens = tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return false;

    // Pre-calculate localized strings
    const displayName = (getLocalized(item.displayName, language) || "").toLowerCase();
    const tags = (item.tags && item.tags[language]) ? item.tags[language].map(t => t.toLowerCase()) : [];

    // Check if EVERY token finds a match in either Name or Tags
    return queryTokens.every((token, index) => {
        const isLast = (index === queryTokens.length - 1);

        // 1. Check Name
        if (tokenMatches(displayName, token, isLast)) return true;

        // 2. Check Tags
        if (tags.some(tag => tokenMatches(tag, token, isLast))) return true;

        return false;
    });
}

/**
 * Filter data based on query.
 * Sorted by length (shortest first), then alphabetically.
 */
export function getMatches(data, query, language) {
    const matches = data.filter(d => isMatch(d, query, language));

    return matches.sort((a, b) => {
        const nameA = getLocalized(a.displayName, language);
        const nameB = getLocalized(b.displayName, language);

        // 1. Length (shortest first)
        const lenDiff = nameA.length - nameB.length;
        if (lenDiff !== 0) return lenDiff;

        // 2. Alphabetical
        return nameA.localeCompare(nameB);
    });
}

/**
 * Returns HTML string with matched query tokens highlighted.
 * Uses range-based highlighting to avoid HTML tag corruption.
 */
export function getHighlightedText(text, query) {
    if (!query) return text;
    // text should already be the localized string passed from main.js

    const queryTokens = tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return text;

    const ranges = [];

    // Highlighting logic must parallel isMatch logic.
    const exactTokens = queryTokens.slice(0, -1);
    const prefixToken = queryTokens[queryTokens.length - 1];

    const findRanges = (t, isPrefix) => {
        const safeToken = escapeRegExp(t);
        const startBoundary = `(^|[\\s()/\-])`; // Group 1
        let pattern;
        if (isPrefix) {
            pattern = `${startBoundary}(${safeToken})`; // Group 2
        } else {
            const endBoundary = `(?=$|[\\s()/\-])`;
            pattern = `${startBoundary}(${safeToken})${endBoundary}`;
        }

        const regex = new RegExp(pattern, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
            // match[0] is full match. match[1] is start boundary. match[2] is target.
            // Start index of highlight = match.index + length of start boundary
            const start = match.index + match[1].length;
            const end = start + match[2].length;
            ranges.push({ start, end });
        }
    };

    exactTokens.forEach(t => findRanges(t, false));
    if (prefixToken) findRanges(prefixToken, true);

    if (ranges.length === 0) return text;

    // Merge overlapping ranges
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    let current = ranges[0];

    for (let i = 1; i < ranges.length; i++) {
        const next = ranges[i];
        if (next.start < current.end) {
            // Overlapping or adjacent
            current.end = Math.max(current.end, next.end);
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);

    // Apply highlights
    let result = "";
    let lastIndex = 0;
    for (const range of merged) {
        result += text.substring(lastIndex, range.start);
        result += `<strong>${text.substring(range.start, range.end)}</strong>`;
        lastIndex = range.end;
    }
    result += text.substring(lastIndex);

    return result;
}

/**
 * Returns content for search result item.
 * - Returns "HighlightedName [HighlightedTags...]"
 */
export function getSearchResultContent(item, query, language) {
    if (!item || !query) return '';

    const queryTokens = tokenize(query.toLowerCase());
    const displayName = getLocalized(item.displayName, language);

    // Highlight Name
    const highlightedName = getHighlightedText(displayName, query);

    // Find matching tags
    let matchingTags = [];
    if (item.tags && item.tags[language]) {
        matchingTags = item.tags[language].filter(tag => {
            const tagLower = tag.toLowerCase();
            // Include tag if it matches ANY token in the query
            return queryTokens.some((token, index) => {
                const isLast = (index === queryTokens.length - 1);
                return tokenMatches(tagLower, token, isLast);
            });
        });
    }

    if (matchingTags.length > 0) {
        // Highlight matching tags
        const highlightedTags = matchingTags.map(tag => getHighlightedText(tag, query)).join(", ");
        return `${highlightedName} <span class="search-tag-match">[${highlightedTags}]</span>`;
    }

    return highlightedName;
}
