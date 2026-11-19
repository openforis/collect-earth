import type { Point } from "./csv";

/** Pure statistics on a series of observations, computed in the browser. */

/**
 * One point per calendar year (UTC) with values, the median of that year, dated 1 July;
 * nothing when the points span fewer than 3 calendar years.
 */
export function yearlyMedian(points: Point[]): Point[] {
  const byYear = new Map<number, number[]>();
  for (const p of points) {
    const year = new Date(p.date).getUTCFullYear();
    const values = byYear.get(year);
    if (values) values.push(p.value);
    else byYear.set(year, [p.value]);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length === 0 || years[years.length - 1] - years[0] < 2) return [];
  return years.map((year) => ({ date: Date.UTC(year, 6, 1), value: median(byYear.get(year)!) }));
}

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Mann-Kendall test (two-sided p, tie-corrected variance, continuity correction) and
 * Theil-Sen slope per year on the yearly medians; undefined with fewer than 8 values.
 * The line is value = intercept + slope * year.
 */
export function trend(yearly: Point[]): { slope: number; intercept: number; p: number } | undefined {
  const n = yearly.length;
  if (n < 8) return undefined;
  const x = yearly.map((p) => new Date(p.date).getUTCFullYear());
  const v = yearly.map((p) => p.value);
  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(v[j] - v[i]);
      slopes.push((v[j] - v[i]) / (x[j] - x[i]));
    }
  }
  const ties = new Map<number, number>();
  for (const value of v) ties.set(value, (ties.get(value) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  let p = 1;
  if (variance > 0) {
    const z = s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0;
    // 2 * (1 - Phi(|z|)) = erfc(|z| / sqrt 2), erfc by Abramowitz-Stegun 7.1.26.
    const a = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * a);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    p = Math.min(1, poly * Math.exp(-a * a));
  }
  const slope = median(slopes);
  return { slope, intercept: median(v) - slope * median(x), p };
}

/**
 * Pettitt test on the yearly medians: the split where the values before and after differ most.
 * `year` is the year of the first value after the split; undefined with fewer than 8 values.
 */
export function changePoint(yearly: Point[]): { year: number; before: number; after: number; p: number } | undefined {
  const n = yearly.length;
  if (n < 8) return undefined;
  const v = yearly.map((p) => p.value);
  let k = 0;
  let at = 1;
  for (let t = 1; t < n; t++) {
    let u = 0;
    for (let i = 0; i < t; i++) for (let j = t; j < n; j++) u += Math.sign(v[j] - v[i]);
    if (Math.abs(u) > k) {
      k = Math.abs(u);
      at = t;
    }
  }
  const p = k === 0 ? 1 : Math.min(1, 2 * Math.exp((-6 * k * k) / (n ** 3 + n ** 2)));
  return { year: new Date(yearly[at].date).getUTCFullYear(), before: median(v.slice(0, at)), after: median(v.slice(at)), p };
}

/** Linear interpolation between the order statistics of sorted `v` (the usual "type 7" quantile). */
function quantile(v: number[], q: number): number {
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  return lo + 1 < v.length ? v[lo] + (v[lo + 1] - v[lo]) * (pos - lo) : v[lo];
}

/** Median and quartiles per calendar month (UTC, 0..11) with at least 3 observations; other months are left out. */
export function monthlyProfile(points: Point[]): { month: number; median: number; q1: number; q3: number; n: number }[] {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const p of points) byMonth[new Date(p.date).getUTCMonth()].push(p.value);
  return byMonth.flatMap((values, month) => {
    if (values.length < 3) return [];
    const v = [...values].sort((a, b) => a - b);
    return [{ month, median: quantile(v, 0.5), q1: quantile(v, 0.25), q3: quantile(v, 0.75), n: v.length }];
  });
}

/**
 * One flag per point: far below the usual value for its month (anomaly from the month's median
 * under -2.5 robust standard deviations, from the median absolute deviation). Nothing under 24 points.
 */
export function unusuallyLow(points: Point[]): boolean[] {
  const none = points.map(() => false);
  if (points.length < 24) return none;
  const usual = new Map(monthlyProfile(points).map((m) => [m.month, m.median]));
  const anomaly = points.map((p) => {
    const m = usual.get(new Date(p.date).getUTCMonth());
    return m === undefined ? undefined : p.value - m;
  });
  const known = anomaly.filter((a): a is number => a !== undefined);
  if (!known.length) return none;
  const centre = median(known);
  const spread = 1.4826 * median(known.map((a) => Math.abs(a - centre)));
  if (spread === 0) return none;
  return anomaly.map((a) => a !== undefined && a < -2.5 * spread);
}

/** The verdict a series summary line shows: the trend, the change year when significant, the last observation's date. */
export interface Summary {
  trend: "increase" | "decrease" | "none" | "too-few";
  change?: number;
  last?: number;
}

export function summarize(points: Point[]): Summary {
  const yearly = yearlyMedian(points);
  const fit = trend(yearly);
  const change = changePoint(yearly);
  return {
    trend: !fit ? "too-few" : fit.p >= 0.05 ? "none" : fit.slope >= 0 ? "increase" : "decrease",
    change: change && change.p < 0.05 ? change.year : undefined,
    last: points.length ? Math.max(...points.map((p) => p.date)) : undefined,
  };
}
