const { test } = require("node:test");
const assert = require("node:assert/strict");
const { hlsTilePrefixes } = require("./hlsTiles");

test("hlsTilePrefixes names the UTM zone of a longitude and its two neighbours", () => {
  assert.deepEqual(hlsTilePrefixes(-88.6), ["T15", "T16", "T17"]);
  assert.deepEqual(hlsTilePrefixes(3), ["T30", "T31", "T32"]);
  assert.deepEqual(hlsTilePrefixes(-180), ["T60", "T01", "T02"]);
  assert.deepEqual(hlsTilePrefixes(179.9), ["T59", "T60", "T01"]);
  assert.deepEqual(hlsTilePrefixes(180), ["T59", "T60", "T01"]);
});
