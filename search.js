
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

    const target = item.displayName.toLowerCase();

    return queryTokens.every((token, index) => {
        const isLast = (index === queryTokens.length - 1);
        const safeToken = escapeRegExp(token);

        // Construct regex for this token
        // Preceded by Start or Space or ( or ) or / or -
        // Note: match must handle the delimiter but strictness comes from token content
        const startBoundary = `(?:^|[\\s()/\-])`;

        let pattern;
        if (isLast) {
            // Prefix match
            pattern = `${startBoundary}${safeToken}`;
        } else {
            // Exact match: Followed by End or Space or ( or ) or / or -
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
        // 1. Length (shortest first)
        const lenDiff = a.displayName.length - b.displayName.length;
        if (lenDiff !== 0) return lenDiff;

        // 2. Alphabetical
        return a.displayName.localeCompare(b.displayName);
    });
}

/**
 * Returns HTML string with matched query tokens highlighted.
 */
export function getHighlightedText(text, query) {
    if (!query) return text;

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
