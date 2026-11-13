const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shapeCcdc, jDaysToMillis } = require("./ccdcShape");

test("jDaysToMillis converts the matlab epoch", () => {
  assert.equal(jDaysToMillis(719529), 0);
  assert.equal(jDaysToMillis(719530), 86400000);
});

test("shapeCcdc splits raw and segment features", () => {
  const fc = { features: [
    { properties: { date: { type: "Date", value: 100 }, raw: 5000 } },
    { properties: { date: { type: "Date", value: 200 }, segments: [{ value: 4000 }, {}] } },
    { properties: { date: { type: "Date", value: 300 }, segments: [{}, { value: 3000 }] } },
  ] };
  const out = shapeCcdc(fc, [719530, 0]);
  assert.deepEqual(out.observed, [{ date: 100, value: 0.5 }]);
  assert.deepEqual(out.segments, [[{ date: 200, value: 0.4 }], [{ date: 300, value: 0.3 }]]);
  assert.deepEqual(out.breaks, [86400000]);
});

test("shapeCcdc accepts date as a plain number and sorts by date", () => {
  const fc = { features: [
    { properties: { date: 300, raw: 1000 } },
    { properties: { date: 100, raw: 2000 } },
    { properties: { date: 200, segments: [{ value: 500 }] } },
    { properties: { date: 150, segments: [{ value: 600 }] } },
  ] };
  const out = shapeCcdc(fc, []);
  assert.deepEqual(out.observed, [{ date: 100, value: 0.2 }, { date: 300, value: 0.1 }]);
  assert.deepEqual(out.segments, [[{ date: 150, value: 0.06 }, { date: 200, value: 0.05 }]]);
  assert.deepEqual(out.breaks, []);
});

test("shapeCcdc tolerates segments arrays of unequal length across features", () => {
  const fc = { features: [
    { properties: { date: 100, segments: [{ value: 1000 }] } },
    { properties: { date: 200, segments: [{}, {}, { value: 3000 }] } },
    { properties: { date: 300, segments: [{}, { value: 2000 }] } },
  ] };
  const out = shapeCcdc(fc, []);
  assert.equal(out.segments.length, 3);
  assert.deepEqual(out.segments, [[{ date: 100, value: 0.1 }], [{ date: 300, value: 0.2 }], [{ date: 200, value: 0.3 }]]);
});

test("shapeCcdc skips raw observations and segment cells that are null", () => {
  const fc = { features: [
    { properties: { date: 100, raw: null } },
    { properties: { date: 200, raw: 0 } },
    { properties: { date: 300, segments: [{ value: null }, { value: 0 }] } },
  ] };
  const out = shapeCcdc(fc, []);
  assert.deepEqual(out.observed, [{ date: 200, value: 0 }]);
  assert.deepEqual(out.segments, [[], [{ date: 300, value: 0 }]]);
});

test("shapeCcdc drops tBreak values that are zero or negative (no break)", () => {
  const out = shapeCcdc({ features: [] }, [0, -1, 719531, 0]);
  assert.deepEqual(out.breaks, [2 * 86400000]);
  assert.deepEqual(out.observed, []);
  assert.deepEqual(out.segments, []);
});

test("shapeCcdc treats a missing tBreaks list as no breaks", () => {
  assert.deepEqual(shapeCcdc({ features: [] }, null).breaks, []);
});

test("shapeCcdc keeps the exact feature date value in milliseconds, with no rounding", () => {
  // The scene lookup matches system:time_start exactly, so a Landsat time_start such as
  // 1452787489237 (not a whole second) must round-trip through the observed point untouched.
  const fc = { features: [
    { properties: { date: { type: "Date", value: 1452787489237 }, raw: 4321 } },
    { properties: { date: { type: "Date", value: 1452787489237 }, segments: [{ value: 4000 }] } },
    { properties: { date: 1397487654321, raw: 1234 } },
  ] };
  const out = shapeCcdc(fc, []);
  assert.deepEqual(out.observed, [{ date: 1397487654321, value: 0.1234 }, { date: 1452787489237, value: 0.4321 }]);
  assert.deepEqual(out.segments, [[{ date: 1452787489237, value: 0.4 }]]);
});
