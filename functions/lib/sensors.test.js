const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SENSORS, sensorsForYear } = require("./sensors");

test("picks Landsat 5 before 1999", () => {
  assert.deepEqual(sensorsForYear(1984), ["L5"]);
  assert.deepEqual(sensorsForYear(1990), ["L5"]);
  assert.deepEqual(sensorsForYear(1998), ["L5"]);
});

test("picks Landsat 7 from 1999 to 2012", () => {
  assert.deepEqual(sensorsForYear(1999), ["L7"]);
  assert.deepEqual(sensorsForYear(2012), ["L7"]);
});

test("picks Landsat 8 from 2013, plus 9 from 2022", () => {
  assert.deepEqual(sensorsForYear(2013), ["L8"]);
  assert.deepEqual(sensorsForYear(2021), ["L8"]);
  assert.deepEqual(sensorsForYear(2022), ["L8", "L9"]);
  assert.deepEqual(sensorsForYear(2023), ["L8", "L9"]);
});

test("rejects years before 1984 as a 400 bad_request", () => {
  assert.throws(() => sensorsForYear(1983), (err) => {
    assert.match(err.message, /1984/);
    assert.equal(err.status, 400);
    assert.equal(err.code, "bad_request");
    return true;
  });
});

test("rejects non-integer years", () => {
  assert.throws(() => sensorsForYear(NaN), /1984/);
  assert.throws(() => sensorsForYear(2005.5), /1984/);
  assert.throws(() => sensorsForYear("2005"), /1984/);
});

test("every sensor id maps to a collection with three false-colour bands", () => {
  for (const id of ["L5", "L7", "L8", "L9"]) {
    const s = SENSORS[id];
    assert.match(s.collection, /^LANDSAT\/L[TEC]0[5789]\/C02\/T1_L2$/);
    assert.equal(s.falseColour.length, 3);
    assert.equal(typeof s.name, "string");
  }
});
