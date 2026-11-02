const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { modisSeries } = require("../../ee/modisSeries");
const { belize } = require("../fixtures");

const live = { skip: !process.env.EE_LIVE };

test("modis series has ndvi points in range, sorted and dated inside the requested year", live, async () => {
  await eeAuth();
  const r = await modisSeries(ee.Geometry(belize), "2020-01-01", "2021-01-01");
  // MOD13Q1 is 16-daily (23 per year); cloud-masked plot means can drop a few.
  assert.ok(r.ndvi.length >= 15, `got ${r.ndvi.length} points`);
  const yearStart = Date.UTC(2020, 0, 1);
  const yearEnd = Date.UTC(2021, 0, 1);
  for (const p of r.ndvi) {
    assert.ok(p.value >= -1 && p.value <= 1, `ndvi ${p.value} out of range`);
    assert.ok(p.date >= yearStart && p.date < yearEnd, `date ${new Date(p.date).toISOString()} outside 2020`);
  }
  assert.ok(r.ndvi.every((p, i) => i === 0 || p.date > r.ndvi[i - 1].date), "ndvi points must be strictly sorted by date");
  assert.ok(Array.isArray(r.fires));
  for (const f of r.fires) {
    assert.equal(new Date(f.date).getUTCFullYear(), new Date(f.month).getUTCFullYear(), "burn date must fall in the month's year");
  }
});
