const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { forestLoss } = require("../../ee/forestLoss");

const live = { skip: !process.env.EE_LIVE };

/** About 1 km square (98.6 ha) in Rondônia, Brazil, cleared in 2024-2025: Hansen loss and both alert systems. */
const rondonia = () => ee.Geometry.Rectangle([-63.08, -10.076, -63.071, -10.067]);
/** About 1 km square of pine plantation in the Landes, France: Hansen loss, outside RADD and GLAD. */
const landes = () => ee.Geometry.Rectangle([-0.9, 44.2, -0.888, 44.209]);

test("forest loss on a cleared plot in Rondônia has Hansen's 2024 loss and RADD and GLAD alerts", live, async () => {
  await eeAuth();
  const t = Date.now();
  const r = await forestLoss(rondonia());
  const total = (src) => r.alerts.filter((a) => a.source === src).reduce((s, a) => s + a.ha, 0);
  console.log("forest loss rondonia", Date.now() - t, "ms; cover", r.treeCover2000, "% plot", r.plotHa, "ha; hansen", JSON.stringify(r.hansen),
    "; alerts", r.alerts.length, "RADD", total("RADD").toFixed(2), "ha GLAD", total("GLAD").toFixed(2), "ha; first", new Date(r.alerts[0].date).toISOString().slice(0, 10), "last", new Date(r.alerts.at(-1).date).toISOString().slice(0, 10));
  assert.ok(r.plotHa > 95 && r.plotHa < 100);
  assert.ok(r.treeCover2000 > 50 && r.treeCover2000 <= 100);
  assert.ok(r.hansen.find((h) => h.year === 2024).ha > 20);
  assert.ok(r.hansen.reduce((s, h) => s + h.ha, 0) <= r.plotHa);
  assert.deepEqual(r.coverage, { radd: true, glad: true });
  assert.ok(total("RADD") > 5 && total("GLAD") > 5);
  assert.ok(r.alerts.every((a, i) => a.ha > 0 && a.date >= Date.UTC(2019, 0, 1) && a.date <= Date.now() && (i === 0 || a.date >= r.alerts[i - 1].date)));
  assert.ok(r.alerts.some((a) => a.confirmed));
});

test("forest loss outside the tropics has Hansen only, and says neither alert system covers it", live, async () => {
  await eeAuth();
  const t = Date.now();
  const r = await forestLoss(landes());
  console.log("forest loss landes", Date.now() - t, "ms; cover", r.treeCover2000, "%; hansen", JSON.stringify(r.hansen), "; coverage", JSON.stringify(r.coverage));
  assert.deepEqual(r.coverage, { radd: false, glad: false });
  assert.deepEqual(r.alerts, []);
  assert.ok(r.treeCover2000 > 0);
});
