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
