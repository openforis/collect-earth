const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tileXY } = require("./live/tiles");

test("tileXY: lon 0 lat 0 at z=1 is the tile just below and right of the origin", () => {
  assert.deepEqual(tileXY(0, 0, 1), { x: 1, y: 1 });
});

test("tileXY: Belize plot centre at z=15", () => {
  // Standard Web Mercator formula (OSM slippy map); value computed independently with the formula.
  assert.deepEqual(tileXY(-88.6257, 16.7828, 15), { x: 8317, y: 14834 });
});

test("tileXY: corners of the z=0 world map to tile 0/0", () => {
  assert.deepEqual(tileXY(-180, 85, 0), { x: 0, y: 0 });
  assert.deepEqual(tileXY(179.999, -85, 1), { x: 1, y: 1 });
});
