const { test } = require("node:test");
const assert = require("node:assert/strict");
const { yydoyToMs, alertsOf, hansenOf, shapeForestLoss } = require("./forestLoss");

test("yydoyToMs reads RADD's and GLAD's year-and-day-of-year codes as UTC midnight", () => {
  assert.equal(yydoyToMs(20001), Date.UTC(2020, 0, 1));
  assert.equal(yydoyToMs(24060), Date.UTC(2024, 1, 29)); // a leap year
  assert.equal(yydoyToMs(25365), Date.UTC(2025, 11, 31));
});

test("alertsOf turns grouped areas (code = YYDOY * 10 + confidence, m²) into dated alerts in ha to 0.001, merged and sorted", () => {
  const groups = [
    { code: 263122, sum: 1500 },
    { code: 200013, sum: 10000 },
    { code: 263122, sum: 500 },
    { code: 200012, sum: 49.6 },
  ];
  assert.deepEqual(alertsOf(groups, "RADD"), [
    { date: Date.UTC(2020, 0, 1), ha: 0.005, source: "RADD", confirmed: false },
    { date: Date.UTC(2020, 0, 1), ha: 1, source: "RADD", confirmed: true },
    { date: Date.UTC(2026, 10, 8), ha: 0.2, source: "RADD", confirmed: false },
  ]);
});

test("hansenOf gives the yearly loss from lossyear groups (years since 2000), in ha", () => {
  assert.deepEqual(hansenOf([{ code: 21, sum: 12345 }, { code: 3, sum: 100 }]), [{ year: 2003, ha: 0.01 }, { year: 2021, ha: 1.235 }]);
  assert.deepEqual(hansenOf(undefined), []);
});

test("shapeForestLoss puts the datasets together; an alert system that does not cover the plot has no alerts", () => {
  const r = shapeForestLoss({
    plotHa: 99.996,
    treeCover2000: 87.44,
    loss: [{ code: 21, sum: 20000 }],
    radd: { covered: true, groups: [{ code: 210103, sum: 300 }] },
    glad: { covered: false, groups: [] },
  });
  assert.deepEqual(r, {
    plotHa: 100,
    treeCover2000: 87.4,
    hansen: [{ year: 2021, ha: 2 }],
    alerts: [{ date: Date.UTC(2021, 0, 10), ha: 0.03, source: "RADD", confirmed: true }],
    coverage: { radd: true, glad: false },
  });
  assert.equal(shapeForestLoss({ plotHa: 1, treeCover2000: null, loss: [], radd: { covered: false, groups: [] }, glad: { covered: false, groups: [] } }).treeCover2000, null);
});
