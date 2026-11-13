const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { landsatSeries } = require("../../ee/landsatSeries");
const { belize } = require("../fixtures");

const live = { skip: !process.env.EE_LIVE };

test("landsat series spans sensors with dated, identified, in-range points", live, async () => {
  await eeAuth();
  const { points } = await landsatSeries(ee.Geometry(belize), "2012-01-01", "2016-01-01");
  assert.ok(points.length >= 10, `got ${points.length}`);
  const sensors = new Set(points.map((p) => p.sensor));
  assert.ok(sensors.has("LANDSAT_7") && sensors.has("LANDSAT_8"), [...sensors].join());
  const rangeStart = Date.UTC(2012, 0, 1);
  const rangeEnd = Date.UTC(2016, 0, 1);
  for (const p of points) {
    assert.ok(p.value >= -1 && p.value <= 1, `ndvi ${p.value} out of range`);
    assert.ok(Number.isInteger(p.date), `date ${p.date} is not an integer`);
    assert.ok(p.date >= rangeStart && p.date < rangeEnd, `date ${new Date(p.date).toISOString()} outside 2012..2015`);
    assert.ok(typeof p.id === "string" && p.id.length > 0, `id ${JSON.stringify(p.id)} is not a non-empty string`);
    const year = new Date(p.date).getUTCFullYear();
    assert.equal(p.sensor, year < 2015 ? "LANDSAT_7" : "LANDSAT_8", `${new Date(p.date).toISOString()} came from ${p.sensor}`);
  }
  assert.ok(points.every((p, i) => i === 0 || p.date > points[i - 1].date), "points must be strictly increasing by date");
});
