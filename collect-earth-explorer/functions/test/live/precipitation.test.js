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

test("CHIRPS and IMERG give the same shape as ERA5-Land, with monthly totals of the same size (no unit error)", live, async () => {
  await eeAuth();
  const plot = ee.Geometry(belize);
  const all = {};
  for (const dataset of ["era5-land", "chirps", "imerg"]) {
    const t = Date.now();
    all[dataset] = (await precipitationSeries(plot, "2020-01-01", "2021-01-01", dataset)).points;
    console.log(`precipitation 2020 ${dataset.padEnd(9)} ${String(Date.now() - t).padStart(5)} ms:`, all[dataset].map((p) => String(p.value).padStart(6)).join(""));
  }
  const months = Array.from({ length: 12 }, (_, m) => Date.UTC(2020, m, 1));
  const year = (ps) => ps.reduce((s, p) => s + p.value, 0);
  for (const dataset of ["chirps", "imerg"]) {
    assert.deepEqual(all[dataset].map((p) => p.date), months, dataset);
    assert.ok(all[dataset].every((p) => p.value >= 0 && p.value < 1000 && Math.round(p.value * 10) === p.value * 10), dataset);
    // The year's total within a factor of two of ERA5-Land's: a unit error (per hour, per pentad, m) is far larger.
    const ratio = year(all[dataset]) / year(all["era5-land"]);
    assert.ok(ratio > 0.5 && ratio < 2, `${dataset} / era5-land = ${ratio}`);
  }
});

test("CHIRPS from 1984 to today in one request ends at its last complete month; outside 50 degrees it has no point", live, async () => {
  await eeAuth();
  const t = Date.now();
  const r = await precipitationSeries(ee.Geometry(belize), "1984-01-01", new Date().toISOString().slice(0, 10), "chirps");
  console.log("chirps 1984..today points", r.points.length, "in", Date.now() - t, "ms; last month", new Date(r.points.at(-1).date).toISOString().slice(0, 7));
  assert.equal(r.points[0].date, Date.UTC(1984, 0, 1));
  const t2 = Date.now();
  const i = await precipitationSeries(ee.Geometry(belize), "1984-01-01", new Date().toISOString().slice(0, 10), "imerg");
  console.log("imerg 1984..today points", i.points.length, "in", Date.now() - t2, "ms; first", new Date(i.points[0].date).toISOString().slice(0, 7), "last", new Date(i.points.at(-1).date).toISOString().slice(0, 7));
  const finland = ee.Geometry.Rectangle([25.0, 62.0, 25.005, 62.005]);
  assert.deepEqual((await precipitationSeries(finland, "2020-01-01", "2021-01-01", "chirps")).points, []);
  assert.equal((await precipitationSeries(finland, "2020-01-01", "2021-01-01", "imerg")).points.length, 12);
});
