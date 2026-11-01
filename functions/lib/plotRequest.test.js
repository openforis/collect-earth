const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePlotRequest, toPolygon } = require("./plotRequest");

const ring = [[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]];

test("converts Collect Earth MultiLineString to Polygon", () => {
  const poly = toPolygon({ type: "MultiLineString", coordinates: [ring] });
  assert.deepEqual(poly, { type: "Polygon", coordinates: [ring] });
});

test("accepts Polygon unchanged", () => {
  const poly = toPolygon({ type: "Polygon", coordinates: [ring] });
  assert.deepEqual(poly, { type: "Polygon", coordinates: [ring] });
});

test("parses a full request and clamps dates", () => {
  const r = parsePlotRequest({ plot: { type: "Polygon", coordinates: [ring] }, start: "1970-01-01", end: "2099-01-01" }, new Date("2026-11-01"));
  assert.equal(r.start, "1984-01-01");
  assert.equal(r.end, "2026-11-01");
  assert.equal(r.plot.type, "Polygon");
});

test("rejects missing plot", () => {
  assert.throws(() => parsePlotRequest({}), /plot/);
});

test("rejects plots larger than 100 ha", () => {
  const big = [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]; // ~490 ha
  assert.throws(() => parsePlotRequest({ plot: { type: "Polygon", coordinates: [big] } }), /100 ha/);
});
