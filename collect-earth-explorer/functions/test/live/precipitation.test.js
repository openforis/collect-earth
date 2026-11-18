const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { precipitationSeries } = require("../../ee/precipitation");
const { belize } = require("../fixtures");

const live = { skip: !process.env.EE_LIVE };

test("precipitation over a plot far smaller than a cell has one point per month of 2020, in plausible mm", live, async () => {
  await eeAuth();
  const r = await precipitationSeries(ee.Geometry(belize), "2020-01-01", "2021-01-01");
  console.log("precipitation 2020 mm", r.points.map((p) => p.value).join(" "));
  assert.deepEqual(r.points.map((p) => p.date), Array.from({ length: 12 }, (_, m) => Date.UTC(2020, m, 1)));
  for (const p of r.points) assert.ok(p.value >= 0 && p.value < 1000, `${p.value} mm`);
  // Belize has a wet season: some month above 100 mm.
  assert.ok(Math.max(...r.points.map((p) => p.value)) > 100);
});

test("precipitation from 1984 to today evaluates in one request with every month up to the dataset's last", live, async () => {
  await eeAuth();
  const t = Date.now();
  const end = new Date().toISOString().slice(0, 10);
  const r = await precipitationSeries(ee.Geometry(belize), "1984-01-01", end);
  const last = new Date(r.points[r.points.length - 1].date).toISOString().slice(0, 7);
  console.log("precipitation 1984..today points", r.points.length, "in", Date.now() - t, "ms; last month", last);
  assert.equal(r.points[0].date, Date.UTC(1984, 0, 1));
  const months = (new Date(r.points[r.points.length - 1].date).getUTCFullYear() - 1984) * 12 + new Date(r.points[r.points.length - 1].date).getUTCMonth() + 1;
  assert.equal(r.points.length, months, "no month missing");
  assert.ok(r.points.every((p) => p.value >= 0 && p.value < 1500));
});
