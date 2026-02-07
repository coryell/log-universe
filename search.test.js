
import { isMatch, tokenize } from './search.js';
import assert from 'assert';

console.log("Running Search Tests...");

// Test Data
const redDwarf = { displayName: "Red Dwarf" }; // Tokens: ["red", "dwarf"]
const redBloodCell = { displayName: "Red Blood Cell" }; // Tokens: ["red", "blood", "cell"]
const blueWhale = { displayName: "Blue Whale" };
const parenthesizedRed = { displayName: "Lowest Energy Visible (Red)" }; // Tokens: ["lowest", "energy", "visible", "red"]

// Test Cases

// 1. Basic Single Word Prefix
assert.strictEqual(isMatch(redDwarf, "re"), true, "re matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "red"), true, "red matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "dw"), true, "dw matches Red Dwarf");
assert.strictEqual(isMatch(blueWhale, "blu"), true, "blu matches Blue Whale");
assert.strictEqual(isMatch(blueWhale, "red"), false, "red does not match Blue Whale");

// 2. Parentheses Handling & Delimiters
assert.strictEqual(isMatch(parenthesizedRed, "re"), true, "re matches (Red)");
assert.strictEqual(isMatch(parenthesizedRed, "red"), true, "red matches (Red)");
assert.strictEqual(isMatch(parenthesizedRed, "(Red)"), true, "(Red) query matches (Red) target");

// New Delimiter Tests
const protonNeutron = { displayName: "Proton/Neutron Radius" };
const xRay = { displayName: "Highest Energy X-Ray" };

assert.strictEqual(isMatch(protonNeutron, "neutron"), true, "neutron matches Proton/Neutron");
assert.strictEqual(isMatch(xRay, "ray"), true, "ray matches X-Ray");
assert.strictEqual(isMatch(xRay, "x-ray"), true, "x-ray matches X-Ray");
assert.strictEqual(isMatch({ displayName: "Red" }, "(Red)"), false, "(Red) query does NOT match Red target");
assert.strictEqual(isMatch(parenthesizedRed, "Red"), true, "Red query matches (Red) target");

// 3. Multi-word Logic
assert.strictEqual(isMatch(redDwarf, "red dw"), true, "red dw matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "re dw"), false, "re dw should NOT match Red Dwarf (first token not exact)");
assert.strictEqual(isMatch(redDwarf, "red d"), true, "red d matches Red Dwarf");
assert.strictEqual(isMatch(redDwarf, "dwarf r"), true, "dwarf r matches Red Dwarf (order independent)");
assert.strictEqual(isMatch(redDwarf, "dwarf r"), true, "dwarf r matches Red Dwarf (order independent)");

// 4. Case Insensitivity
assert.strictEqual(isMatch(redDwarf, "RED DW"), true, "RED DW matches Red Dwarf");

// 5. Highlighting Logic
import { getHighlightedText } from './search.js';

assert.strictEqual(
    getHighlightedText("Red Dwarf", "re"),
    "<strong>Re</strong>d Dwarf",
    "Highlighting 're' in 'Red Dwarf'"
);

assert.strictEqual(
    getHighlightedText("Red Dwarf", "red"),
    "<strong>Red</strong> Dwarf",
    "Highlighting 'red' in 'Red Dwarf'"
);

assert.strictEqual(
    getHighlightedText("Red Dwarf", "red d"),
    "<strong>Red</strong> <strong>D</strong>warf",
    "Highlighting 'red d' in 'Red Dwarf'"
);

assert.strictEqual(
    getHighlightedText("Lowest (Red)", "re"),
    "Lowest (<strong>Re</strong>d)",
    "Highlighting 're' in 'Lowest (Red)'"
);

// 6. Sorting Logic
// Shortest length first, then alphabetical
import { getMatches } from './search.js';

const unsortedData = [
    { displayName: "Apple Pie" },  // 9 chars
    { displayName: "Apple" },      // 5 chars
    { displayName: "Apple Tart" }  // 10 chars
];

const matches = getMatches(unsortedData, "Apple");
assert.strictEqual(matches[0].displayName, "Apple", "First match should be shortest (Apple)");
assert.strictEqual(matches[1].displayName, "Apple Pie", "Second match should be next shortest (Apple Pie)");
assert.strictEqual(matches[2].displayName, "Apple Tart", "Third match should be longest (Apple Tart)");

// Alphabetical Tie-Breaker
const tiedData = [
    { displayName: "Apple B" }, // 7 chars
    { displayName: "Apple A" }  // 7 chars
];
const tiedMatches = getMatches(tiedData, "Apple");
assert.strictEqual(tiedMatches[0].displayName, "Apple A", "Tie-break should be alphabetical (Apple A)");
assert.strictEqual(tiedMatches[1].displayName, "Apple B", "Tie-break should be alphabetical (Apple B)");

console.log("All tests passed!");
