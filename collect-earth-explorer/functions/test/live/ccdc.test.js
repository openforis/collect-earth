const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { ccdcSeries } = require("../../ee/ccdc");
const { belize } = require("../fixtures");

const live = { skip: !process.env.EE_LIVE, timeout: 300000 };

function assertSeriesInRange(points, label) {
  for (const p of points) {
    assert.ok(Number.isInteger(p.date), `${label} date ${p.date} is not an integer`);
    assert.ok(p.value >= -1 && p.value <= 1, `${label} value ${p.value} out of range`);
  }
}

test("ccdc returns observed points and at least one segment", live, async () => {
  await eeAuth();
  const r = await ccdcSeries(ee.Geometry(belize), "2010-01-01", "2020-01-01", "NDFI");
  assert.equal(r.band, "NDFI");
  assert.ok(r.observed.length >= 50, `observed ${r.observed.length}`);
  assert.ok(r.segments.length >= 1 && r.segments[0].length >= 12, `segments ${r.segments.map((s) => s.length)}`);
  assertSeriesInRange(r.observed, "observed");
  for (const s of r.segments) assertSeriesInRange(s, "segment");
  assert.ok(r.observed.every((p, i) => i === 0 || p.date > r.observed[i - 1].date), "observed dates must be strictly increasing");
  const rangeStart = Date.UTC(2010, 0, 1);
  const rangeEnd = Date.UTC(2020, 0, 1);
  for (const p of r.observed) assert.ok(p.date >= rangeStart && p.date < rangeEnd, `observed ${new Date(p.date).toISOString()} outside 2010..2019`);
  assert.ok(r.breaks.every((b) => b > Date.UTC(2009, 0, 1) && b < Date.UTC(2021, 0, 1)), `breaks ${r.breaks.map((b) => new Date(b).toISOString())}`);
});

test("ccdc NDVI band yields an in-range series", live, async () => {
  await eeAuth();
  const r = await ccdcSeries(ee.Geometry(belize), "2015-01-01", "2020-01-01", "NDVI");
  assert.equal(r.band, "NDVI");
  assert.ok(r.observed.length >= 20, `observed ${r.observed.length}`);
  assert.ok(r.segments.length >= 1, "at least one segment");
  assertSeriesInRange(r.observed, "observed");
  for (const s of r.segments) assertSeriesInRange(s, "segment");
});
