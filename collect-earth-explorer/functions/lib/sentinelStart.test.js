const { test } = require("node:test");
const assert = require("node:assert/strict");
const { clampSentinelStart, SENTINEL_START } = require("../ee/sentinel2Series");

test("clampSentinelStart moves starts before the first Sentinel-2 scene to 2015-06-23", () => {
  assert.equal(SENTINEL_START, "2015-06-23");
  assert.equal(clampSentinelStart("2000-01-01"), "2015-06-23");
  assert.equal(clampSentinelStart("2015-06-22"), "2015-06-23");
});

test("clampSentinelStart leaves later starts unchanged", () => {
  assert.equal(clampSentinelStart("2020-05-01"), "2020-05-01");
  assert.equal(clampSentinelStart("2015-06-23"), "2015-06-23");
});

const { sentinelWindow } = require("../ee/sentinel2Series");

test("sentinelWindow clamps the start and keeps the end", () => {
  assert.deepEqual(sentinelWindow("2000-01-01", "2017-12-31"), { start: "2015-06-23", end: "2017-12-31" });
  assert.deepEqual(sentinelWindow("2020-05-01", "2021-01-01"), { start: "2020-05-01", end: "2021-01-01" });
});

test("sentinelWindow is null when the clamped start is not before the end", () => {
  assert.equal(sentinelWindow("2000-01-01", "2015-01-01"), null);
  assert.equal(sentinelWindow("2000-01-01", "2015-06-23"), null);
  assert.equal(sentinelWindow("2020-05-01", "2020-05-01"), null);
  assert.equal(sentinelWindow("2020-05-02", "2020-05-01"), null);
});

test("sentinelWindow clamps to another first day when given one (HLS)", () => {
  const { HLS_START } = require("../ee/hls");
  assert.equal(HLS_START, "2013-04-11");
  assert.deepEqual(sentinelWindow("2000-01-01", "2014-01-01", HLS_START), { start: "2013-04-11", end: "2014-01-01" });
  assert.equal(sentinelWindow("2000-01-01", "2013-04-11", HLS_START), null);
});
