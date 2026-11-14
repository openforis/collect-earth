const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cacheKey } = require("./cacheKey");

const plot = { type: "Polygon", coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] };
const base = { plot, start: "2000-01-01", end: "2001-01-01" };

test("key is stable across property order and 40 hex chars", () => {
  const a = cacheKey("series/modis", { plot: { type: "Polygon", coordinates: [[[1, 2]]] }, start: "2000-01-01", end: "2001-01-01" }, { band: "NDFI" });
  const b = cacheKey("series/modis", { end: "2001-01-01", start: "2000-01-01", plot: { coordinates: [[[1, 2]]], type: "Polygon" } }, { band: "NDFI" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test("different extras give different keys", () => {
  assert.notEqual(cacheKey("ccdc", base, { band: "NDFI" }), cacheKey("ccdc", base, { band: "NDVI" }));
});

test("different plots give different keys", () => {
  const other = { ...base, plot: { type: "Polygon", coordinates: [[[1, 2], [3, 4], [5, 7], [1, 2]]] } };
  assert.notEqual(cacheKey("series/modis", base, {}), cacheKey("series/modis", other, {}));
});

test("different endpoints and different dates give different keys", () => {
  assert.notEqual(cacheKey("series/modis", base, {}), cacheKey("series/landsat", base, {}));
  assert.notEqual(cacheKey("series/modis", base, {}), cacheKey("series/modis", { ...base, end: "2002-01-01" }, {}));
});

test("missing extras hash the same as empty extras, and areaHa is not part of the key", () => {
  assert.equal(cacheKey("series/modis", base, undefined), cacheKey("series/modis", base, {}));
  assert.equal(cacheKey("series/modis", { ...base, areaHa: 1 }, {}), cacheKey("series/modis", { ...base, areaHa: 2 }, {}));
});
