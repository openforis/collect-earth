const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { sentinel2CompositeTiles } = require("../../ee/sentinel2Composite");
const { belize } = require("../fixtures");

test("sentinel2 composite returns a tile url", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  const r = await sentinel2CompositeTiles(ee.Geometry(belize), "2025-06-01");
  assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  assert.equal(r.dateRange.start, "2024-06-01");
});
