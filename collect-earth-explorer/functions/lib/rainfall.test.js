const { test } = require("node:test");
const assert = require("node:assert/strict");
const { monthlyTotals, mmPerMonth } = require("./rainfall");

const pentads = (y, m, values) => values.map((value, i) => ({ date: Date.UTC(y, m, 1 + 5 * i), value }));

test("monthlyTotals sums the six pentads of each month, dated at the month's start, in mm to 0.1", () => {
  const r = monthlyTotals([...pentads(2020, 1, [1, 2, 3, 4, 5, 6.06]), ...pentads(2020, 0, [0, 0, 0, 0, 0, 0.04])]);
  assert.deepEqual(r, [{ date: Date.UTC(2020, 0, 1), value: 0 }, { date: Date.UTC(2020, 1, 1), value: 21.1 }]);
});

test("monthlyTotals leaves out a month without all six pentads (the current one, or one cut by the dates)", () => {
  assert.deepEqual(monthlyTotals([...pentads(2020, 0, [1, 1, 1, 1, 1, 1]), ...pentads(2020, 1, [5, 5, 5])]), [{ date: Date.UTC(2020, 0, 1), value: 6 }]);
});

test("mmPerMonth turns IMERG's mm per hour into the month's total from its own length", () => {
  assert.equal(mmPerMonth(Date.UTC(2020, 0, 1), 1), 744); // 31 days
  assert.equal(mmPerMonth(Date.UTC(2020, 1, 1), 1), 696); // 29 days, a leap year
  assert.equal(mmPerMonth(Date.UTC(2021, 1, 1), 1), 672);
  assert.equal(mmPerMonth(Date.UTC(2021, 3, 1), 0.5), 360);
});
