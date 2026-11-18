import { describe, it, expect } from "vitest";
import { changePoint, monthlyProfile, trend, unusuallyLow, yearlyMedian } from "./seriesStats";
import type { Point } from "./csv";

describe("yearlyMedian", () => {
  const at = (y: number, m: number, value: number): Point => ({ date: Date.UTC(y, m, 1), value });
  const july = (y: number) => Date.UTC(y, 6, 1);

  it("gives one median per year with points, on 1 July UTC, for odd, even and single counts, skipping empty years", () => {
    const pts = [
      at(2018, 0, 0.9), at(2018, 5, 0.1), at(2018, 9, 0.5), // odd: 0.5
      at(2019, 1, 0.2), at(2019, 3, 0.4), at(2019, 7, 0.8), at(2019, 11, 0.6), // even: (0.4 + 0.6) / 2
      // 2020 has no points
      at(2021, 4, 0.7), // a single point
    ];
    const m = yearlyMedian(pts);
    expect(m.map((p) => p.date)).toEqual([july(2018), july(2019), july(2021)]);
    expect(m[0].value).toBe(0.5);
    expect(m[1].value).toBeCloseTo(0.5);
    expect(m[2].value).toBe(0.7);
  });

  it("gives nothing when the points span fewer than three calendar years", () => {
    expect(yearlyMedian([])).toEqual([]);
    expect(yearlyMedian([at(2020, 0, 0.1), at(2021, 11, 0.2)])).toEqual([]);
  });

  it("reads the year in UTC", () => {
    // 2018-12-31T23:30Z is 2018 in UTC whatever the local zone.
    const m = yearlyMedian([{ date: Date.UTC(2018, 11, 31, 23, 30), value: 0.1 }, at(2020, 0, 0.2)]);
    expect(m.map((p) => p.date)).toEqual([july(2018), july(2020)]);
  });
});

describe("trend", () => {
  const yearly = (values: number[], years = values.map((_, i) => 2010 + i)): Point[] =>
    values.map((value, i) => ({ date: Date.UTC(years[i], 6, 1), value }));

  it("1..10 over 10 years: slope 1, p about 8.3e-5 (S = 45, var = 125, z = 44 / sqrt 125)", () => {
    const t = trend(yearly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))!;
    expect(t.slope).toBe(1);
    expect(t.intercept).toBe(5.5 - 2014.5);
    expect(t.p).toBeCloseTo(8.303e-5, 6);
  });

  it("a decreasing series gives a negative slope and the same p", () => {
    const t = trend(yearly([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]))!;
    expect(t.slope).toBe(-1);
    expect(t.p).toBeCloseTo(8.303e-5, 6);
  });

  it("all equal values give slope 0 and p 1", () => {
    expect(trend(yearly([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]))).toEqual({ slope: 0, intercept: 0.5, p: 1 });
  });

  it("corrects the variance for ties", () => {
    // 1,2,2,3,4,5,6,7: S = 28 pairs - 1 tied = 27; one tie group of 2:
    // var = (8*7*21 - 2*1*9) / 18 = 1158 / 18 = 64.33; z = 26 / sqrt 64.33 = 3.2416; p = 0.001189.
    expect(trend(yearly([1, 2, 2, 3, 4, 5, 6, 7]))!.p).toBeCloseTo(0.001189, 5);
  });

  it("needs 8 yearly values", () => {
    expect(trend(yearly([1, 2, 3, 4, 5, 6, 7]))).toBeUndefined();
  });

  it("uses the real year difference when years are missing", () => {
    const years = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2010];
    expect(trend(yearly(years.map((y) => 2 * (y - 2000)), years))!.slope).toBe(2);
  });
});

describe("changePoint", () => {
  const yearly = (values: number[]): Point[] => values.map((value, i) => ({ date: Date.UTC(2010 + i, 6, 1), value }));

  it("finds the split of a step and reads its p-value", () => {
    // 0,0,0,0,1,1,1,1: U_4 = 4 * 4 = 16 is the largest (U_3 = U_5 = 12), so K = 16, split before index 4 (2014);
    // p = 2 exp(-6 * 256 / (512 + 64)) = 2 exp(-2.667) = 0.1390.
    const c = changePoint(yearly([0, 0, 0, 0, 1, 1, 1, 1]))!;
    expect(c.year).toBe(2014);
    expect(c.before).toBe(0);
    expect(c.after).toBe(1);
    expect(c.p).toBeCloseTo(0.139, 3);
  });

  it("a longer step is significant", () => {
    // 10 zeros then 10 ones: K = 100, p = 2 exp(-6 * 10000 / (8000 + 400)) = 2 exp(-7.143) = 0.00158.
    const c = changePoint(yearly([...Array(10).fill(0.2), ...Array(10).fill(0.7)]))!;
    expect(c.year).toBe(2020);
    expect(c.p).toBeCloseTo(0.00158, 5);
  });

  it("all equal values: K = 0 and p = 1; under 8 values: undefined", () => {
    expect(changePoint(yearly(Array(8).fill(0.5)))!.p).toBe(1);
    expect(changePoint(yearly([1, 2, 3, 4, 5, 6, 7]))).toBeUndefined();
  });
});

describe("monthlyProfile", () => {
  const at = (m: number, value: number, y = 2020): Point => ({ date: Date.UTC(y, m, 15), value });

  it("gives the median and interpolated quartiles of months with at least 3 observations", () => {
    const pts = [
      at(0, 1), at(0, 2, 2021), at(0, 3, 2022), at(0, 4, 2023), // Jan 1,2,3,4: median 2.5, q1 at 0.75 -> 1.75, q3 at 2.25 -> 3.25
      at(1, 9), at(1, 9, 2021), // Feb: only 2, left out
      at(2, 5), at(2, 1, 2021), at(2, 3, 2022), // Mar 1,3,5: median 3, q1 at 0.5 -> 2, q3 at 1.5 -> 4
    ];
    expect(monthlyProfile(pts)).toEqual([
      { month: 0, median: 2.5, q1: 1.75, q3: 3.25, n: 4 },
      { month: 2, median: 3, q1: 2, q3: 4, n: 3 },
    ]);
  });

  it("reads the month in UTC", () => {
    // 31 Jan 23:30 UTC is January whatever the local zone.
    const late = { date: Date.UTC(2020, 0, 31, 23, 30), value: 1 };
    expect(monthlyProfile([late, late, late]).map((m) => m.month)).toEqual([0]);
  });
});

describe("unusuallyLow", () => {
  const at = (m: number, i: number, value: number): Point => ({ date: Date.UTC(2015 + i, m, 10), value });
  const usual = [0.5, 0.51, 0.49, 0.5, 0.52, 0.48];
  // Jan to Apr, 6 years each; one January value is 0.10.
  const base = [0, 1, 2, 3].flatMap((m) => usual.map((v, i) => at(m, i, m === 0 && i === 0 ? 0.1 : v)));

  it("flags a value far below its month's median and nothing else", () => {
    // Jan median 0.495, other months 0.50. Anomalies: -0.395 once, the rest within ±0.025; their median is 0,
    // the median absolute deviation 0.01, so spread = 0.014826 and the limit -0.0371: only -0.395 is below it.
    // A May observation (its month has under 3 observations, so it is left out) is never flagged, however low.
    const pts = [...base, at(4, 0, -0.9)];
    const flags = unusuallyLow(pts);
    expect(flags).toHaveLength(pts.length);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags[0]).toBe(true);
  });

  it("flags nothing with fewer than 24 points, or when the spread is 0", () => {
    expect(unusuallyLow(base.slice(1)).some(Boolean)).toBe(false);
    const flat = base.map((p, i) => ({ ...p, value: i === 0 ? 0.1 : 0.5 }));
    expect(unusuallyLow(flat).some(Boolean)).toBe(false);
  });
});
