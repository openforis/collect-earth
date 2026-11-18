const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { landsatSeries } = require("../../ee/landsatSeries");
const { sentinel2Series } = require("../../ee/sentinel2Series");
const { createApp } = require("../../app");
const { registerRoutes } = require("../../routes");
const { belize } = require("../fixtures");
const { tileXY } = require("./tiles");

const live = { skip: !process.env.EE_LIVE, timeout: 300000 };

/** The real route with a pass-through cache: validation, both sides' images and the difference all run against Earth Engine. */
const app = createApp((a) => registerRoutes(a, { cache: { withCache: (endpoint, parsed, extras, ttl, compute) => compute() } }));

/** Fetches the z=15 tile containing the plot's first vertex and checks it is served as an image. */
async function assertTileIsImage(tileUrl) {
  const [lon, lat] = belize.coordinates[0][0];
  const { x, y } = tileXY(lon, lat, 15);
  const url = tileUrl.replace("{z}", "15").replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url);
  assert.equal(res.status, 200, `tile ${url} returned ${res.status}`);
  assert.match(res.headers.get("content-type") || "", /^image\//);
}

async function difference(left, right) {
  const res = await request(app).post("/api/tiles/difference").send({ plot: belize, start: "2020-01-01", end: "2025-06-01", left, right });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  await assertTileIsImage(res.body.tileUrl);
  return res.body;
}

test("difference of two Landsat yearly composites is served as tiles", live, async () => {
  const r = await difference({ path: "tiles/landsat", year: 2019 }, { path: "tiles/landsat", year: 2021, bands: "true-colour" });
  assert.equal(r.label, "NDVI change: Landsat 8 2019 composite → Landsat 8 2021 composite");
});

test("difference of a Sentinel-2 calendar year and the last 12 months is served as tiles", live, async () => {
  const r = await difference({ path: "tiles/sentinel2", compositeStart: "2020-01-01", compositeEnd: "2021-01-01" }, { path: "tiles/sentinel2" });
  assert.equal(r.label, "NDVI change: Sentinel-2 composite 2020-01-01 to 2021-01-01 → Sentinel-2 composite 2024-06-01 to 2025-06-01");
});

test("difference of a Landsat scene from the series and a Landsat composite is served as tiles", live, async () => {
  await eeAuth();
  const { points } = await landsatSeries(ee.Geometry(belize), "2021-01-01", "2021-07-01");
  assert.ok(points.length > 0, "expected Landsat scenes over the plot in early 2021");
  const r = await difference({ path: "tiles/scene", sensor: "landsat", timeStart: points[0].date }, { path: "tiles/landsat", year: 2023 });
  assert.match(r.label, /^NDVI change: Landsat 2021-\d\d-\d\d → Landsat 8\/Landsat 9 2023 composite$/);
});

test("difference of a Sentinel-2 composite and a Sentinel-2 scene from the series (product band names) is served as tiles", live, async () => {
  await eeAuth();
  const { points } = await sentinel2Series(ee.Geometry(belize), "2022-01-01", "2022-07-01");
  assert.ok(points.length > 0, "expected Sentinel-2 scenes over the plot in early 2022");
  const r = await difference({ path: "tiles/sentinel2", compositeStart: "2020-01-01", compositeEnd: "2021-01-01" }, { path: "tiles/scene", sensor: "sentinel2", timeStart: points[0].date });
  assert.match(r.label, /→ Sentinel-2 2022-\d\d-\d\d$/);
});

test("difference with a side that has no imagery is that side's 404", live, async () => {
  const res = await request(app).post("/api/tiles/difference")
    .send({ plot: belize, end: "2025-06-01", left: { path: "tiles/scene", sensor: "landsat", timeStart: 1 }, right: { path: "tiles/sentinel2" } });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "not_found");
});
