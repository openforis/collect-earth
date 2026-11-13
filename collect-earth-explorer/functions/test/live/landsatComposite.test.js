const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { evaluate } = require("../../ee/promise");
const { landsatCompositeTiles, buildYearlyComposite, sensorImages } = require("../../ee/landsatComposite");
const { belize } = require("../fixtures");
const { tileXY } = require("./tiles");

const live = { skip: !process.env.EE_LIVE };

for (const [year, sensor] of [[1990, "Landsat 5"], [2005, "Landsat 7"], [2023, "Landsat 8 + Landsat 9"]]) {
  test(`landsat composite ${year} returns a tile url labelled with the year and sensor`, live, async () => {
    await eeAuth();
    const r = await landsatCompositeTiles(ee.Geometry(belize), year);
    assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
    assert.ok(r.label.includes(String(year)), `label ${r.label} lacks the year`);
    assert.equal(r.sensor, sensor);
  });
}

test("landsat composite 1984 over the plot is either served or a 404 not_found", live, async () => {
  // Landsat 5 TM coverage of Belize in 1984 is uncertain; either outcome is valid, a 500 is not.
  await eeAuth();
  let r;
  try {
    r = await landsatCompositeTiles(ee.Geometry(belize), 1984);
  } catch (err) {
    assert.equal(err.status, 404, `unexpected error ${err.message}`);
    assert.equal(err.code, "not_found");
    assert.equal(err.message, "no Landsat scenes for 1984");
    return;
  }
  assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  assert.equal(r.sensor, "Landsat 5");
});

test("landsat composite 2005 has scenes over the plot", live, async () => {
  await eeAuth();
  const size = await evaluate(sensorImages("L7", ee.Geometry(belize), 2005).size());
  assert.ok(size > 0, `expected Landsat 7 scenes over the plot in 2005, got ${size}`);
});

test("landsat composite image carries exactly the nir/swir/red bands", live, async () => {
  await eeAuth();
  const { image, sensorNames } = buildYearlyComposite(ee.Geometry(belize), 2005);
  assert.deepEqual(sensorNames, ["Landsat 7"]);
  const bands = await evaluate(image.bandNames());
  assert.deepEqual(bands, ["nir", "swir", "red"]);
});

test("landsat composite tile over the plot is served as an image", live, async () => {
  await eeAuth();
  const r = await landsatCompositeTiles(ee.Geometry(belize), 2005);
  const [lon, lat] = belize.coordinates[0][0];
  const { x, y } = tileXY(lon, lat, 15);
  const url = r.tileUrl.replace("{z}", "15").replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url);
  assert.equal(res.status, 200, `tile ${url} returned ${res.status}`);
  assert.match(res.headers.get("content-type") || "", /^image\//);
});
