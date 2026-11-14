const { test } = require("node:test");
const assert = require("node:assert/strict");
const { landsatPeriods, COLLECTIONS, HARMONIZED } = require("./landsatPeriods");

test("2012 to 2016 splits at the L7/L8 threshold", () => {
  assert.deepEqual(landsatPeriods("2012-01-01", "2016-01-01"), [
    { sensor: "L7", start: "2012-01-01", end: "2015-01-01" },
    { sensor: "L8", start: "2015-01-01", end: "2016-01-01" },
  ]);
});

test("1990 to 1995 is Landsat 5 only", () => {
  assert.deepEqual(landsatPeriods("1990-01-01", "1995-01-01"), [{ sensor: "L5", start: "1990-01-01", end: "1995-01-01" }]);
});

test("2024 is Landsat 8 and 9, with the L9 window clipped to the requested start", () => {
  assert.deepEqual(landsatPeriods("2024-01-01", "2025-01-01"), [
    { sensor: "L8", start: "2024-01-01", end: "2025-01-01" },
    { sensor: "L9", start: "2024-01-01", end: "2025-01-01" },
  ]);
});

test("a range starting before L9 begins its L9 window at L9_START", () => {
  assert.deepEqual(landsatPeriods("2023-01-01", "2024-01-01"), [
    { sensor: "L8", start: "2023-01-01", end: "2024-01-01" },
    { sensor: "L9", start: "2023-11-01", end: "2024-01-01" },
  ]);
});

test("1984 to 2026 requests all four sensors in chronological order", () => {
  assert.deepEqual(landsatPeriods("1984-01-01", "2026-01-01"), [
    { sensor: "L5", start: "1984-01-01", end: "1999-12-31" },
    { sensor: "L7", start: "1999-04-15", end: "2015-01-01" },
    { sensor: "L8", start: "2015-01-01", end: "2026-01-01" },
    { sensor: "L9", start: "2023-11-01", end: "2026-01-01" },
  ]);
});

test("every window is non-empty and lies inside the requested range", () => {
  const ranges = [["1984-01-01", "2026-01-01"], ["1999-06-01", "2000-06-01"], ["2014-12-01", "2015-02-01"], ["2023-10-01", "2023-12-01"]];
  for (const [s, e] of ranges) {
    for (const p of landsatPeriods(s, e)) {
      assert.ok(p.start < p.end, `${p.sensor} ${p.start}..${p.end} is empty`);
      assert.ok(p.start >= s && p.end <= e, `${p.sensor} ${p.start}..${p.end} escapes ${s}..${e}`);
    }
  }
});

test("L5 and L7 overlap between the L7 launch and the L5 threshold, as in charts_v2", () => {
  assert.deepEqual(landsatPeriods("1999-06-01", "2000-06-01"), [
    { sensor: "L5", start: "1999-06-01", end: "1999-12-31" },
    { sensor: "L7", start: "1999-06-01", end: "2000-06-01" },
  ]);
});

test("an empty or inverted range yields no windows", () => {
  assert.deepEqual(landsatPeriods("2016-01-01", "2016-01-01"), []);
  assert.deepEqual(landsatPeriods("2016-01-01", "2012-01-01"), []);
});

test("every sensor has a collection id and a harmonisation flag", () => {
  for (const sensor of ["L5", "L7", "L8", "L9"]) {
    assert.match(COLLECTIONS[sensor], /^LANDSAT\/L[CET]0[5789]\/C02\/T1_L2$/);
    assert.equal(typeof HARMONIZED[sensor], "boolean");
  }
  assert.equal(HARMONIZED.L8, true);
  assert.equal(HARMONIZED.L7, false);
});
