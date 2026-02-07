
/**
 * Helper to get localized string from data.
 * Handles object (i18n) formats only.
 */
export function getLocalized(val) {
    if (val && typeof val === 'object' && 'en-us' in val) {
        return val['en-us'];
    }
    return '';
}

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
export function isMatch(item, query) {
    if (!query) return false;
    if (!item || !item.displayName) return false;

    const queryTokens = tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return false;

    // Check Display Name
    const displayName = getLocalized(item.displayName).toLowerCase();
    if (checkMatch(displayName, queryTokens)) return true;

    // Check Tags
    if (item.tags) {
        const tags = item.tags['en-us'] || []; // localized tags? assuming structure
        // If data.json tags are localized objects { "en-us": ["tag1", "tag2"] }
        // If they are just arrays ["tag1"], adjust. User diff showed localized.
        // Diff: "tags": { "en-us": ["sol", "star"] }

        // We want to return true if ANY tag matches
        return tags.some(tag => checkMatch(tag.toLowerCase(), queryTokens));
    }

    return false;
}

/**
 * Helper to check if a target string matches the query tokens rule.
 */
function checkMatch(target, queryTokens) {
    return queryTokens.every((token, index) => {
        const isLast = (index === queryTokens.length - 1);
        const safeToken = escapeRegExp(token);
        const startBoundary = `(?:^|[\\s()/\-])`;

        let pattern;
        if (isLast) {
            pattern = `${startBoundary}${safeToken}`;
        } else {
            const endBoundary = `(?=$|[\\s()/\-])`;
            pattern = `${startBoundary}${safeToken}${endBoundary}`;
        }

        const regex = new RegExp(pattern);
        return regex.test(target);
    });
}

/**
 * Filter data based on query.
 * Sorted by length (shortest first), then alphabetically.
 */
export function getMatches(data, query) {
    const matches = data.filter(d => isMatch(d, query));

    return matches.sort((a, b) => {
        const nameA = getLocalized(a.displayName);
        const nameB = getLocalized(b.displayName);

        // 1. Length (shortest first)
        const lenDiff = nameA.length - nameB.length;
        if (lenDiff !== 0) return lenDiff;

        // 2. Alphabetical
        return nameA.localeCompare(nameB);
    });
}

/**
 * Returns HTML string with matched query tokens highlighted.
 */
export function getHighlightedText(text, query) {
    if (!query) return text;
    // text should already be the localized string passed from main.js

    const queryTokens = tokenize(query.toLowerCase());
    if (queryTokens.length === 0) return text;

    let formattedText = text;

    // Highlighting logic must parallel isMatch logic.
    // We identify exact vs prefix tokens.
    const exactTokens = queryTokens.slice(0, -1);
    const prefixToken = queryTokens[queryTokens.length - 1];

    const applyHighlight = (t, isPrefix) => {
        const safeToken = escapeRegExp(t);
        const startBoundary = `(^|[\\s()/\-])`; // Capturing group 1 for the delimiter/start
        let pattern;
        if (isPrefix) {
            pattern = `${startBoundary}(${safeToken})`; // Group 2 is match
        } else {
            const endBoundary = `(?=$|[\\s()/\-])`;
            pattern = `${startBoundary}(${safeToken})${endBoundary}`;
        }

        // Global replace
        const regex = new RegExp(pattern, 'gi');

        formattedText = formattedText.replace(regex, (match, p1, p2) => {
            return `${p1}<strong>${p2}</strong>`;
        });
    };

    // Apply highlights. Order matters if tokens overlap, but typically input tokens
    // are distinct enough. Highlight exact matches first, then prefix.
    exactTokens.forEach(t => applyHighlight(t, false));
    if (prefixToken) applyHighlight(prefixToken, true);

    return formattedText;
}

/**
 * Returns content for search result item.
 * - If displayName matches: returns highlighted displayName
 * - If tag matches: returns "displayName (highlightedTag)"
 */
export function getSearchResultContent(item, query) {
    if (!item || !query) return '';

    const queryTokens = tokenize(query.toLowerCase());
    const displayName = getLocalized(item.displayName);

    // 1. Check if Display Name matches
    if (checkMatch(displayName.toLowerCase(), queryTokens)) {
        return getHighlightedText(displayName, query);
    }

    // 2. Check Tags
    if (item.tags) {
        const tags = item.tags['en-us'] || [];
        // Find the FIRST tag that matches
        const matchedTag = tags.find(tag => checkMatch(tag.toLowerCase(), queryTokens));

        if (matchedTag) {
            const tempTag = getHighlightedText(matchedTag, query);
            return `${displayName} [${tempTag}]`;
        }
    }

    // Fallback (shouldn't happen if isMatch was true)
    return displayName;
}
