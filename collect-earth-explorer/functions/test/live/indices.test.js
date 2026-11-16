const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { landsatSeries } = require("../../ee/landsatSeries");
const { sentinel2Series } = require("../../ee/sentinel2Series");
const { belize } = require("../fixtures");

const live = { skip: !process.env.EE_LIVE };

/** EVI is not bounded like a normalised difference; over vegetation it stays well inside -1..1.5. */
const MAX = { NDMI: 1, NBR: 1, EVI: 1.5 };

for (const [name, series, start, end] of [
  ["landsat", landsatSeries, "2012-01-01", "2016-01-01"],
  ["sentinel2", sentinel2Series, "2022-01-01", "2022-07-01"],
]) {
  for (const index of ["NDMI", "NBR", "EVI"]) {
    test(`${name} ${index} series has points with finite, in-range values`, live, async () => {
      await eeAuth();
      const { points } = await series(ee.Geometry(belize), start, end, index);
      assert.ok(points.length >= 5, `got ${points.length}`);
      for (const p of points) assert.ok(Number.isFinite(p.value) && p.value >= -1 && p.value <= MAX[index], `${index} ${p.value} out of range`);
      console.log(`${name} ${index}`, points.slice(0, 4).map((p) => p.value.toFixed(3)).join(" "));
    });
  }
}

const { catalogue } = require("../../lib/catalogue");

for (const [name, series, start, end] of [
  ["landsat", landsatSeries, "2012-01-01", "2016-01-01"],
  ["sentinel2", sentinel2Series, "2022-01-01", "2022-07-01"],
]) {
  test(`${name}: every named index of the catalogue has points with finite values`, live, async () => {
    await eeAuth();
    for (const index of Object.keys(catalogue.indices)) {
      const { points } = await series(ee.Geometry(belize), start, end, index);
      assert.ok(points.length >= 5, `${index}: got ${points.length}`);
      for (const p of points) assert.ok(Number.isFinite(p.value), `${index} ${p.value}`);
      console.log(`${name} ${index}`, points.slice(0, 4).map((p) => p.value.toFixed(3)).join(" "));
    }
  });

  test(`${name}: a custom formula equal to NDVI's gives the values of index NDVI`, live, async () => {
    await eeAuth();
    const named = await series(ee.Geometry(belize), start, end, "NDVI");
    const custom = await series(ee.Geometry(belize), start, end, undefined, "(nir-red)/(nir+red)");
    assert.ok(named.points.length >= 5);
    assert.deepEqual(custom, named);
  });
}

test("sentinel2: a red-edge formula has points with finite values", live, async () => {
  await eeAuth();
  const { points } = await sentinel2Series(ee.Geometry(belize), "2022-01-01", "2022-07-01", undefined, "(nir - rededge1) / (nir + rededge1) + rededge2 * 0 + rededge3 * 0");
  assert.ok(points.length >= 5, `got ${points.length}`);
  for (const p of points) assert.ok(Number.isFinite(p.value) && p.value > -1 && p.value < 1, `${p.value}`);
  console.log("sentinel2 NDRE", points.slice(0, 4).map((p) => p.value.toFixed(3)).join(" "));
});
