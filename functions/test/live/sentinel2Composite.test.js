const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { evaluate } = require("../../ee/promise");
const { sentinel2Images } = require("../../ee/sentinel2");
const { sentinel2CompositeTiles, buildComposite } = require("../../ee/sentinel2Composite");
const { belize } = require("../fixtures");
const { tileXY } = require("./tiles");

const END = "2025-06-01";
const live = { skip: !process.env.EE_LIVE };

test("sentinel2 composite returns a tile url and a 12-month date range", live, async () => {
  await eeAuth();
  const r = await sentinel2CompositeTiles(ee.Geometry(belize), END);
  assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  assert.equal(r.dateRange.start, "2024-06-01");
  assert.equal(r.dateRange.end, END);
});

test("sentinel2 composite window has scenes over the plot", live, async () => {
  await eeAuth();
  const plot = ee.Geometry(belize);
  const { start } = buildComposite(plot, END);
  const size = await evaluate(sentinel2Images(plot, start, END).size());
  assert.ok(size > 0, `expected scenes between ${start} and ${END}, got ${size}`);
});

test("sentinel2 composite image carries the false-colour bands", live, async () => {
  await eeAuth();
  const { image } = buildComposite(ee.Geometry(belize), END);
  const bands = await evaluate(image.bandNames());
  for (const b of ["nir", "swir1", "red"]) assert.ok(bands.includes(b), `missing band ${b} in ${bands}`);
});

test("sentinel2 composite tile over the plot is served as an image", live, async () => {
  await eeAuth();
  const r = await sentinel2CompositeTiles(ee.Geometry(belize), END);
  const [lon, lat] = belize.coordinates[0][0];
  const { x, y } = tileXY(lon, lat, 15);
  const url = r.tileUrl.replace("{z}", "15").replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url);
  assert.equal(res.status, 200, `tile ${url} returned ${res.status}`);
  assert.match(res.headers.get("content-type") || "", /^image\//);
});
