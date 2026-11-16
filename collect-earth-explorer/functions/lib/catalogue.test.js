const { test } = require("node:test");
const assert = require("node:assert/strict");
const { catalogue, paramOf } = require("./catalogue");

/** Asserts fn throws a 400 bad_request whose message matches `re`. */
function assert400(fn, re) {
  assert.throws(fn, (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, "bad_request");
    assert.match(err.message, re);
    return true;
  });
}

test("an undefined value returns the default, or undefined when there is none", () => {
  assert.equal(paramOf("layers", "sentinel2", "maxCloud"), 70);
  assert.equal(paramOf("layers", "landsat", "maxCloud"), 50);
  assert.equal(paramOf("charts", "ccdc", "band"), "NDFI");
  assert.equal(paramOf("charts", "modis", "collapsed"), false);
  assert.equal(paramOf("layers", "sentinel2", "start"), undefined);
});

test("choice accepts a listed value and names the allowed values otherwise", () => {
  assert.equal(paramOf("charts", "ccdc", "band", "NDVI"), "NDVI");
  assert400(() => paramOf("charts", "ccdc", "band", "EVI"), /band.*NDFI, NDVI/);
  assert400(() => paramOf("charts", "ccdc", "band", 1), /band/);
});

test("int accepts an integer in [min, max] and rejects strings, floats and out-of-range values", () => {
  assert.equal(paramOf("layers", "sentinel2", "maxCloud", 1), 1);
  assert.equal(paramOf("layers", "sentinel2", "maxCloud", 100), 100);
  for (const bad of ["70", "abc", 70.5, 0, 101, null, NaN]) {
    assert400(() => paramOf("layers", "sentinel2", "maxCloud", bad), /maxCloud.*1.*100/);
  }
});

test("date accepts a real YYYY-MM-DD and rejects impossible or malformed dates", () => {
  assert.equal(paramOf("layers", "sentinel2", "start", "2024-02-29"), "2024-02-29");
  for (const bad of ["2021-02-30", "2021-13-01", "2021-1-01", "2021-01-01T00:00", 20210101]) {
    assert400(() => paramOf("layers", "sentinel2", "start", bad), /start.*YYYY-MM-DD/);
  }
});

test("year is an integer in [min, maxYear]", () => {
  assert.equal(paramOf("layers", "landsat", "year", 1984, { maxYear: 2030 }), 1984);
  assert.equal(paramOf("layers", "landsat", "year", 2030, { maxYear: 2030 }), 2030);
  assert400(() => paramOf("layers", "landsat", "year", 1983, { maxYear: 2030 }), /year.*1984.*2030/);
  assert400(() => paramOf("layers", "landsat", "year", 2031, { maxYear: 2030 }), /year.*1984.*2030/);
  assert400(() => paramOf("layers", "landsat", "year", "2020"), /year/);
  const thisYear = new Date().getUTCFullYear();
  assert.equal(paramOf("layers", "landsat", "year", thisYear), thisYear);
  assert400(() => paramOf("layers", "landsat", "year", thisYear + 1), /year/);
});

test("yearRange is two years in range with from <= to", () => {
  assert.deepEqual(paramOf("layers", "landsat", "years", [2000, 2010], { maxYear: 2030 }), [2000, 2010]);
  assert.deepEqual(paramOf("layers", "landsat", "years", [2005, 2005], { maxYear: 2030 }), [2005, 2005]);
  for (const bad of [[2010, 2000], [1983, 2000], [2000, 2031], [2000], [2000, 2001, 2002], ["2000", "2010"], "2000-2010"]) {
    assert400(() => paramOf("layers", "landsat", "years", bad, { maxYear: 2030 }), /years.*1984.*2030/);
  }
});

test("bool accepts only true and false; text is a string no longer than max", () => {
  assert.equal(paramOf("charts", "modis", "collapsed", true), true);
  assert.equal(paramOf("charts", "modis", "collapsed", false), false);
  for (const bad of ["true", 1, 0, null]) assert400(() => paramOf("charts", "modis", "collapsed", bad), /collapsed.*true or false/);
  assert.equal(paramOf("layers", "sentinel2", "label", "Dry season"), "Dry season");
  assert.equal(paramOf("layers", "sentinel2", "label", "x".repeat(60)), "x".repeat(60));
  assert400(() => paramOf("layers", "sentinel2", "label", "x".repeat(61)), /label.*60/);
  assert400(() => paramOf("layers", "sentinel2", "label", 5), /label/);
});

test("an unknown kind, type or parameter name is a 400", () => {
  assert400(() => paramOf("widgets", "sentinel2", "maxCloud", 5), /widgets/);
  assert400(() => paramOf("layers", "planet", "maxCloud", 5), /planet/);
  assert400(() => paramOf("layers", "sentinel2", "gamma", 5), /gamma/);
  assert400(() => paramOf("layers", "toString", "x", 5), /toString/);
});

test("every entry of the standard configuration names a catalogue type", () => {
  assert.ok(catalogue.standard.layers.length > 0);
  assert.ok(catalogue.standard.charts.length > 0);
  for (const kind of ["layers", "charts"]) {
    for (const entry of catalogue.standard[kind]) assert.ok(Object.hasOwn(catalogue[kind], entry.type), kind + " " + entry.type);
  }
});
