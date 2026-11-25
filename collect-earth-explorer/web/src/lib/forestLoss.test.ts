import { describe, it, expect } from "vitest";
import { alertsByMonth, forestLossCsv, inPeriod, type ForestLoss } from "./forestLoss";

const day = (y: number, m: number, d: number) => Date.UTC(y, m, d);
const data: ForestLoss = {
  plotHa: 98.6,
  treeCover2000: 80,
  hansen: [{ year: 2018, ha: 1 }, { year: 2024, ha: 41.5 }],
  alerts: [
    { date: day(2024, 7, 31), ha: 0.5, source: "RADD", confirmed: true },
    { date: day(2024, 7, 3), ha: 0.25, source: "RADD", confirmed: true },
    { date: day(2024, 7, 10), ha: 0.1, source: "RADD", confirmed: false },
    { date: day(2024, 8, 1), ha: 2, source: "GLAD", confirmed: true },
    { date: day(2026, 0, 5), ha: 1, source: "GLAD", confirmed: false },
  ],
  coverage: { radd: true, glad: true },
};

describe("inPeriod", () => {
  it("keeps the Hansen years and the alerts inside [start, end), the request's period", () => {
    const r = inPeriod(data, "2019-01-01", "2026-01-01");
    expect(r.hansen.map((h) => h.year)).toEqual([2024]);
    expect(r.alerts).toHaveLength(4);
    expect(inPeriod(data, "2018-06-01", "2025-01-01").hansen.map((h) => h.year)).toEqual([2018, 2024]);
  });
});

describe("alertsByMonth", () => {
  it("sums one source's confirmed and unconfirmed alerts per UTC month, dated at the month's start", () => {
    expect(alertsByMonth(data.alerts, "RADD")).toEqual([{ month: day(2024, 7, 1), confirmed: 0.75, unconfirmed: 0.1 }]);
    expect(alertsByMonth(data.alerts, "GLAD")).toEqual([
      { month: day(2024, 8, 1), confirmed: 2, unconfirmed: 0 },
      { month: day(2026, 0, 1), confirmed: 0, unconfirmed: 1 },
    ]);
  });
});

describe("forestLossCsv", () => {
  it("lists Hansen's years then the alerts by date, with source, ha and confirmed", () => {
    expect(forestLossCsv({ ...data, alerts: data.alerts.slice(0, 1) })).toBe("date,source,ha,confirmed\n2018,Hansen,1,\n2024,Hansen,41.5,\n2024-08-31,RADD,0.5,true\n");
  });
});
