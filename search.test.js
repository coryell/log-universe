
// search.test.js
// Run with: node search.test.js

import assert from 'assert';
import { isMatch, getMatches, getLocalized } from './search.js';

const LANGUAGE = "en-us";

// Mock Data (i18n format)
const redDwarf = { displayName: { "en-us": "Red Dwarf" } };
const blueWhale = { displayName: { "en-us": "Blue Whale" } };
const parenthesizedRed = { displayName: { "en-us": "(Red)" } };

// 0. Test getLocalized
assert.strictEqual(getLocalized({ "en-us": "Hello" }, LANGUAGE), "Hello", "getLocalized extracts en-us");
assert.strictEqual(getLocalized("Hello", LANGUAGE), "", "getLocalized returns empty for strings");

// 1. Basic Prefix Matching
assert.strictEqual(isMatch(redDwarf, "red", LANGUAGE), true, "red matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "Red", LANGUAGE), true, "Red matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "dw", LANGUAGE), true, "dw matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "blue", LANGUAGE), false, "blue does not match Red Dwarf");
assert.strictEqual(isMatch(blueWhale, "red", LANGUAGE), false, "red does not match Blue Whale");

// 2. Parentheses Handling & Delimiters
assert.strictEqual(isMatch(parenthesizedRed, "re", LANGUAGE), true, "re matches (Red)");
assert.strictEqual(isMatch(parenthesizedRed, "red", LANGUAGE), true, "red matches (Red)");
assert.strictEqual(isMatch(parenthesizedRed, "(Red)", LANGUAGE), true, "(Red) query matches (Red) target");

// New Delimiter Tests
const protonNeutron = { displayName: { "en-us": "Proton/Neutron Radius" } };
const xRay = { displayName: { "en-us": "Highest Energy X-Ray" } };

assert.strictEqual(isMatch(protonNeutron, "neutron", LANGUAGE), true, "neutron matches Proton/Neutron");
assert.strictEqual(isMatch(xRay, "ray", LANGUAGE), true, "ray matches X-Ray");
assert.strictEqual(isMatch(xRay, "x-ray", LANGUAGE), true, "x-ray matches X-Ray");
assert.strictEqual(isMatch({ displayName: { "en-us": "Red" } }, "(Red)", LANGUAGE), false, "(Red) query does NOT match Red target");
assert.strictEqual(isMatch(parenthesizedRed, "Red", LANGUAGE), true, "Red query matches (Red) target");

// 3. Multi-word Logic
assert.strictEqual(isMatch(redDwarf, "red dw", LANGUAGE), true, "red dw matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "re dw", LANGUAGE), false, "re dw should NOT match Red Dwarf (first token not exact)");
assert.strictEqual(isMatch(redDwarf, "red d", LANGUAGE), true, "red d matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "dwarf r", LANGUAGE), true, "dwarf r matches Red Dwarf (order independent)");

// 4. Case Insensitivity
assert.strictEqual(isMatch(redDwarf, "RED DWARF", LANGUAGE), true, "RED DWARF matches Red Dwarf");

// 5. Highlighting (Mocking only text processing part manually or via function if exported)
// getHighlightedText is tested by output string check
import { getHighlightedText } from './search.js';

const highlighted = getHighlightedText("Red Dwarf", "red");
// Expected: "<strong>Red</strong> Dwarf" or similar. 
// My implementation uses "<strong>$1</strong>" replacement.
// "Red" matches "Red".
// Regex parallel to isMatch:
// "red" -> exact match token (no, it's last token? "red" query)
// If query is "red", tokens=["red"]. It's the last token, so prefix match.
// "Red Dwarf" -> "Red" matches start boundary + "red".
assert.match(highlighted, /<strong>Red<\/strong>/, "Highlighting 'Red' in 'Red Dwarf'");

const highlight2 = getHighlightedText("Highest Energy X-Ray", "ray");
// "ray" is last token -> prefix match.
// "X-Ray". "Ray" is preceded by "-". Matches.
// Should highlight "Ray".
assert.match(highlight2, /<strong>Ray<\/strong>/, "Highlighting 'Ray' in 'X-Ray'");

// Test exact token in multi-word
const highlight3 = getHighlightedText("Lowest (Red)", "re");
// "re" is prefix match. Matches "Re" in "(Red)".
assert.match(highlight3, /<strong>Re<\/strong>/, "Highlighting 're' in 'Lowest (Red)'");

// 6. Sorting Logic
// Shortest length first, then alphabetical
const unsortedData = [
    { displayName: { "en-us": "Apple Pie" } },  // 9 chars
    { displayName: { "en-us": "Apple" } },      // 5 chars
    { displayName: { "en-us": "Apple Tart" } }  // 10 chars
];

const matches = getMatches(unsortedData, "Apple", LANGUAGE);
// Expected Order: Apple (5), Apple Pie (9), Apple Tart (10)
assert.strictEqual(matches[0].displayName['en-us'], "Apple", "First match should be shortest (Apple)");
assert.strictEqual(matches[1].displayName['en-us'], "Apple Pie", "Second match should be next shortest (Apple Pie)");
assert.strictEqual(matches[2].displayName['en-us'], "Apple Tart", "Third match should be longest (Apple Tart)");

// Alphabetical Tie-Breaker
const tiedData = [
    { displayName: { "en-us": "Apple B" } }, // 7 chars
    { displayName: { "en-us": "Apple A" } }  // 7 chars
];
const tiedMatches = getMatches(tiedData, "Apple", LANGUAGE);
assert.strictEqual(tiedMatches[0].displayName['en-us'], "Apple A", "Tie-break should be alphabetical (Apple A)");
assert.strictEqual(tiedMatches[1].displayName['en-us'], "Apple B", "Tie-break should be alphabetical (Apple B)");

console.log("All tests passed!");
