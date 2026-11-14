const { test } = require("node:test");
const assert = require("node:assert/strict");
const { featuresToPoints } = require("../ee/series");

test("featuresToPoints drops nulls and sorts by date", () => {
  const fc = { features: [
    { properties: { date: 200, value: 0.5, id: "b" } },
    { properties: { date: 100, value: null, id: "a" } },
    { properties: { date: 50, value: 0.1, id: "c" } },
  ] };
  assert.deepEqual(featuresToPoints(fc), [{ date: 50, value: 0.1, id: "c" }, { date: 200, value: 0.5, id: "b" }]);
});

test("featuresToPoints drops undefined and non-finite values", () => {
  const fc = { features: [
    { properties: { date: 1, value: NaN, id: "nan" } },
    { properties: { date: 2, value: Infinity, id: "inf" } },
    { properties: { date: 3, value: -Infinity, id: "ninf" } },
    { properties: { date: 4, id: "missing" } },
    { properties: { date: 5, value: 0, id: "zero" } },
  ] };
  assert.deepEqual(featuresToPoints(fc), [{ date: 5, value: 0, id: "zero" }]);
});

test("featuresToPoints preserves extra properties such as sensor", () => {
  const fc = { features: [
    { properties: { date: 20, value: 0.3, id: "y", sensor: "Landsat 8" } },
    { properties: { date: 10, value: 0.2, id: "x", sensor: "Landsat 7" } },
  ] };
  assert.deepEqual(featuresToPoints(fc), [
    { date: 10, value: 0.2, id: "x", sensor: "Landsat 7" },
    { date: 20, value: 0.3, id: "y", sensor: "Landsat 8" },
  ]);
});

test("featuresToPoints of an empty collection is an empty array", () => {
  assert.deepEqual(featuresToPoints({ features: [] }), []);
});
