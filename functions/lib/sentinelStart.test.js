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
