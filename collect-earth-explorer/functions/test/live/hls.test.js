const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { hlsSeries } = require("../../ee/hls");
const { sceneTiles } = require("../../ee/scene");
const { createApp } = require("../../app");
const { registerRoutes } = require("../../routes");
const { belize } = require("../fixtures");
const { tileXY } = require("./tiles");

const live = { skip: !process.env.EE_LIVE, timeout: 300000 };

function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function assertTileIsImage(tileUrl) {
  const [lon, lat] = belize.coordinates[0][0];
  const { x, y } = tileXY(lon, lat, 15);
  const res = await fetch(tileUrl.replace("{z}", "15").replace("{x}", String(x)).replace("{y}", String(y)));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /^image\//);
}

test("hls series merges L30 and S30 points with sensor and cloud, and its scenes are served as tiles", live, async () => {
  await eeAuth();
  const g = ee.Geometry(belize);
  const t0 = Date.now();
  const { points } = await hlsSeries(g, "2022-01-01", "2023-01-01");
  console.log(`hls 2022: ${points.length} points in ${Date.now() - t0} ms`);
  const sensors = new Set(points.map((p) => p.sensor));
  assert.deepEqual([...sensors].sort(), ["HLS L30", "HLS S30"]);
  for (const p of points) {
    assert.ok(p.value >= -1 && p.value <= 1, `ndvi ${p.value} out of range`);
    assert.ok(p.date >= Date.UTC(2022, 0, 1) && p.date < Date.UTC(2023, 0, 1), isoDate(p.date));
    assert.ok(Number.isFinite(p.cloud) && p.cloud >= 0 && p.cloud <= 100, `cloud ${p.cloud}`);
  }
  for (const sensor of sensors) {
    const clicked = points.find((p) => p.sensor === sensor);
    const r = await sceneTiles(g, "2022-01-01", "2023-01-01", "hls", clicked.date);
    assert.equal(r.label, `HLS ${isoDate(clicked.date)}`);
    await assertTileIsImage(r.tileUrl);
  }
});

test("hls series over a decade stays within Earth Engine's limits and clamps a pre-2013 start", live, async () => {
  await eeAuth();
  const t0 = Date.now();
  const { points } = await hlsSeries(ee.Geometry(belize), "2000-01-01", "2026-01-01");
  console.log(`hls 2000-2026: ${points.length} points in ${Date.now() - t0} ms`);
  assert.ok(points.length > 100, `got ${points.length}`);
  assert.ok(points[0].date >= Date.UTC(2013, 3, 11));
});

test("hls named indices and a custom formula give finite values; a formula equal to NDVI gives index NDVI", live, async () => {
  await eeAuth();
  const g = ee.Geometry(belize);
  for (const index of ["NDMI", "NBR", "EVI"]) {
    const { points } = await hlsSeries(g, "2022-01-01", "2022-07-01", index);
    assert.ok(points.length >= 5, `${index}: got ${points.length}`);
    for (const p of points) assert.ok(Number.isFinite(p.value) && p.value >= -1 && p.value <= 1.5, `${index} ${p.value}`);
  }
  const named = await hlsSeries(g, "2022-01-01", "2022-07-01", "NDVI");
  assert.deepEqual(await hlsSeries(g, "2022-01-01", "2022-07-01", undefined, "(nir-red)/(nir+red)"), named);
});

test("difference of a Landsat composite and an HLS scene is served as tiles", live, async () => {
  await eeAuth();
  const { points } = await hlsSeries(ee.Geometry(belize), "2022-01-01", "2022-07-01");
  const app = createApp((a) => registerRoutes(a, { cache: { withCache: (endpoint, parsed, extras, ttl, compute) => compute() } }));
  const res = await request(app).post("/api/tiles/difference")
    .send({ plot: belize, start: "2020-01-01", end: "2025-06-01", left: { path: "tiles/landsat", year: 2020 }, right: { path: "tiles/scene", sensor: "hls", timeStart: points[0].date } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.label, /→ HLS 2022-\d\d-\d\d$/);
  await assertTileIsImage(res.body.tileUrl);
});
