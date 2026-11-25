/** Rainfall in mm rounded to 0.1, as every dataset's points are returned. */
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * CHIRPS pentads ({date, value} in mm per pentad) summed per UTC month, dated at the month's start. A month has six
 * pentads (the sixth runs from the 26th to its end); one with fewer (the current one, or one cut by the dates) is left out.
 */
function monthlyTotals(points) {
  const months = new Map();
  for (const { date, value } of points) {
    const d = new Date(date);
    const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const m = months.get(key) ?? { n: 0, sum: 0 };
    months.set(key, { n: m.n + 1, sum: m.sum + value });
  }
  return [...months]
    .filter(([, m]) => m.n === 6)
    .sort(([a], [b]) => a - b)
    .map(([date, m]) => ({ date, value: round1(m.sum) }));
}

/** GPM IMERG monthly's mean rate (mm per hour) as the total of the month starting at `date`, from its own length. */
function mmPerMonth(date, mmPerHour) {
  const d = new Date(date);
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 86400000).getUTCDate();
  return mmPerHour * 24 * days;
}

module.exports = { monthlyTotals, mmPerMonth, round1 };
