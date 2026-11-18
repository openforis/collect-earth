const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { evaluate } = require("../../ee/promise");
const { sentinel1CompositeTiles, sentinel1Series, buildRadarComposite } = require("../../ee/sentinel1");
const { belize } = require("../fixtures");
const { tileXY } = require("./tiles");

const live = { skip: !process.env.EE_LIVE };

test("sentinel-1 composite 2020 has scenes, VV/VH/diff bands in the stretch ranges, and a tile served as an image", live, async () => {
  await eeAuth();
  const plot = ee.Geometry(belize);
  const { image, collection } = buildRadarComposite(plot, 2020);
  const size = await evaluate(collection.size());
  assert.ok(size > 10, `expected Sentinel-1 scenes over the plot in 2020, got ${size}`);
  assert.deepEqual(await evaluate(image.bandNames()), ["VV", "VH", "diff"]);
  const mean = await evaluate(image.reduceRegion({ reducer: ee.Reducer.mean(), geometry: plot.buffer(2000), scale: 30 }));
  console.log("sentinel-1 2020 scenes", size, "mean dB over 2 km", JSON.stringify(mean));
  assert.ok(mean.VV > -20 && mean.VV < 0, `VV ${mean.VV}`);
  assert.ok(mean.VH > -27 && mean.VH < -5, `VH ${mean.VH}`);
  for (const bands of ["false-colour", "vv", "vh"]) {
    const r = await sentinel1CompositeTiles(plot, 2020, { bands });
    assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
    assert.equal(r.label, "Sentinel-1 2020 radar composite");
    const [lon, lat] = belize.coordinates[0][0];
    const { x, y } = tileXY(lon, lat, 15);
    const res = await fetch(r.tileUrl.replace("{z}", "15").replace("{x}", String(x)).replace("{y}", String(y)));
    console.log("sentinel-1 tile", bands, res.status, res.headers.get("content-type"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /^image\//);
  }
});

test("sentinel-1 composite of a year before the mission is a 404 not_found", live, async () => {
  await eeAuth();
  await assert.rejects(sentinel1CompositeTiles(ee.Geometry(belize), 2013), (err) => {
    assert.equal(err.status, 404);
    assert.equal(err.code, "not_found");
    assert.equal(err.message, "no Sentinel-1 scenes for 2013");
    return true;
  });
});

test("sentinel-1 series has VH and VV points in dB, sorted and inside the window", live, async () => {
  await eeAuth();
  const plot = ee.Geometry(belize);
  const vh = await sentinel1Series(plot, "2020-01-01", "2021-01-01");
  const vv = await sentinel1Series(plot, "2020-01-01", "2021-01-01", "VV");
  console.log("sentinel-1 2020 points VH", vh.points.length, "VV", vv.points.length, "VH first", vh.points.slice(0, 4).map((p) => p.value.toFixed(2)).join(" "), "VV first", vv.points.slice(0, 4).map((p) => p.value.toFixed(2)).join(" "));
  assert.ok(vh.points.length >= 20, `got ${vh.points.length} points`);
  for (const p of vh.points) {
    assert.ok(p.value > -35 && p.value < 5, `VH ${p.value} dB`);
    assert.ok(p.date >= Date.UTC(2020, 0, 1) && p.date < Date.UTC(2021, 0, 1));
  }
  assert.ok(vh.points.every((p, i) => i === 0 || p.date >= vh.points[i - 1].date), "sorted by date");
  // VV backscatter is stronger than VH over land.
  const avg = (ps) => ps.reduce((s, p) => s + p.value, 0) / ps.length;
  assert.ok(avg(vv.points) > avg(vh.points), `VV ${avg(vv.points)} not above VH ${avg(vh.points)}`);
});

test("sentinel-1 series over the whole mission (2015 to 2025) evaluates in one request", live, async () => {
  await eeAuth();
  const t = Date.now();
  const r = await sentinel1Series(ee.Geometry(belize), "2014-01-01", "2026-01-01");
  console.log("sentinel-1 2014..2025 points", r.points.length, "in", Date.now() - t, "ms");
  assert.ok(r.points.length >= 150, `got ${r.points.length} points`);
});
