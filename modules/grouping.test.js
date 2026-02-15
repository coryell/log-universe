
// grouping.test.js
import assert from 'assert';
import { getClusters } from './grouping.js';

// Mock getLocalized and getFilteredData manually or rely on imports?
// The module uses simple logic.
// However, it imports from './utils.js'. Node might complain about imports if I run this directly unless package.json type is module (it is).

// basic mocks for data
const data = [
    {
        id: "1",
        displayName: { "en-us": "A" },
        _orig_dimensions: { length: "10" },
        _orig_x_coordinates: { length: "5" },
        dimensions: { length: 10 },
        x_coordinates: { length: 5 },
        category: { "en-us": "Cat1" }
    },
    {
        id: "2",
        displayName: { "en-us": "B" },
        _orig_dimensions: { length: "10" },
        _orig_x_coordinates: { length: "5" },
        dimensions: { length: 10 },
        x_coordinates: { length: 5 },
        category: { "en-us": "Cat2" }
    },
    {
        id: "3",
        displayName: { "en-us": "C" },
        _orig_dimensions: { length: "20" },
        _orig_x_coordinates: { length: "6" },
        dimensions: { length: 20 },
        x_coordinates: { length: 6 },
        category: { "en-us": "Cat1" }
    }
];

console.log("Testing getClusters...");

// Test Case 1: Clustering identical points in 1D mode (None vs Length)
// currentDimensionX = "none", currentDimensionY = "length"
const clusters1D = getClusters(data, "none", "length", "en-us");

assert.strictEqual(clusters1D.length, 1, "Should find 1 cluster");
assert.strictEqual(clusters1D[0]._members.length, 2, "Cluster should have 2 members");
assert.strictEqual(clusters1D[0].id, "combined-y:10|x:5", "Cluster ID format check");
// verify C is not in cluster
const cInCluster = clusters1D[0]._members.find(m => m.id === "3");
assert.strictEqual(cInCluster, undefined, "Item C should not be in cluster");

// Test Case 2: No clustering when unique
const clustersUnique = getClusters([data[0], data[2]], "none", "length", "en-us");
assert.strictEqual(clustersUnique.length, 0, "Should find 0 clusters for unique points");

console.log("grouping.test.js passed!");
