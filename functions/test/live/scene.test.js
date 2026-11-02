const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { sentinel2Series } = require("../../ee/sentinel2Series");
const { landsatSeries } = require("../../ee/landsatSeries");
const { sceneTiles } = require("../../ee/scene");
const { belize } = require("../fixtures");
const { tileXY } = require("./tiles");

const live = { skip: !process.env.EE_LIVE };

function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

/** Fetches the z=15 tile containing the plot's first vertex and checks it is served as an image. */
async function assertTileIsImage(tileUrl) {
  const [lon, lat] = belize.coordinates[0][0];
  const { x, y } = tileXY(lon, lat, 15);
  const url = tileUrl.replace("{z}", "15").replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url);
  assert.equal(res.status, 200, `tile ${url} returned ${res.status}`);
  assert.match(res.headers.get("content-type") || "", /^image\//);
}

test("sentinel2 series has dated, in-range NDVI points and its first scene is served as tiles", live, async () => {
  await eeAuth();
  const g = ee.Geometry(belize);
  const { points } = await sentinel2Series(g, "2022-01-01", "2022-07-01");
  assert.ok(points.length >= 5, `got ${points.length}`);
  const rangeStart = Date.UTC(2022, 0, 1);
  const rangeEnd = Date.UTC(2022, 6, 1);
  for (const p of points) {
    assert.ok(p.value >= -1 && p.value <= 1, `ndvi ${p.value} out of range`);
    assert.ok(Number.isInteger(p.date), `date ${p.date} is not an integer`);
    assert.ok(p.date >= rangeStart && p.date < rangeEnd, `date ${new Date(p.date).toISOString()} outside the request`);
    assert.ok(typeof p.id === "string" && p.id.length > 0, `id ${JSON.stringify(p.id)} is not a non-empty string`);
  }
  // Two Sentinel-2 granules of one orbit can share a system:time_start, so dates are non-decreasing, not strictly increasing.
  assert.ok(points.every((p, i) => i === 0 || p.date >= points[i - 1].date), "points must be sorted by date");

  const clicked = points[0];
  const r = await sceneTiles(g, "2022-01-01", "2022-07-01", "sentinel2", clicked.date);
  assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  assert.equal(r.sensor, "sentinel2");
  assert.equal(r.label, `Sentinel-2 ${isoDate(clicked.date)}`);
  await assertTileIsImage(r.tileUrl);
});

test("sentinel2 series clamps a pre-2015 start instead of failing", live, async () => {
  await eeAuth();
  const { points } = await sentinel2Series(ee.Geometry(belize), "2000-01-01", "2017-12-31");
  assert.ok(points.length > 0, "expected scenes between 2015-06-23 and 2017-12-31");
  for (const p of points) {
    assert.ok(p.date >= Date.UTC(2015, 5, 23), `date ${new Date(p.date).toISOString()} before the first Sentinel-2 scene`);
  }
});

test("landsat scene at a timeStart with no scene rejects with 404 not_found", live, async () => {
  await eeAuth();
  await assert.rejects(sceneTiles(ee.Geometry(belize), "2021-01-01", "2021-07-01", "landsat", 1), (err) => {
    assert.equal(err.status, 404);
    assert.equal(err.code, "not_found");
    assert.match(err.message, /no landsat scene at 1970-01-01T00:00:00\.001Z/);
    return true;
  });
});

test("landsat scene from a series point is served as tiles labelled with its date", live, async () => {
  await eeAuth();
  const g = ee.Geometry(belize);
  const { points } = await landsatSeries(g, "2021-01-01", "2021-07-01");
  assert.ok(points.length > 0, "expected Landsat 8 scenes over the plot in early 2021");
  const clicked = points[0];
  const r = await sceneTiles(g, "2021-01-01", "2021-07-01", "landsat", clicked.date);
  assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  assert.equal(r.sensor, "landsat");
  assert.equal(r.label, `Landsat ${isoDate(clicked.date)}`);
  await assertTileIsImage(r.tileUrl);
});
