// The time spent on each plot (docs/plans/2026-11-04-time-spent-on-plots.md): Collect Earth counts how long the
// interpreter worked on a plot (its form open and in use, pauses over five minutes left out, summed over every time it
// was opened) and sends it with the record. These figures are for the coordinators only: how long each person usually
// takes, and the plots done much quicker than the team usually takes, which may not have been looked at with care.
//
// "Much quicker" is relative to the team (decided by the owner, 4 Nov 2026): under QUICK_SHARE of the team's median,
// so no number has to be set and it follows the survey (a long form takes longer for everyone).

/** A plot is quick when its active time is under this share of the team's median. */
export const QUICK_SHARE = 0.25;
/** The team's median says what usual is only from this many timed plots on: fewer, and nothing is called quick. */
export const MIN_TIMED_FOR_QUICK = 20;
/** Quick plots listed in one answer, quickest first (the counts are of all of them). */
export const MAX_LISTED_QUICK = 500;
/** The bands of the distributions, in seconds: [0, 30), [30, 60), … [1200, ∞). */
export const TIME_BANDS = [30, 60, 120, 300, 600, 1200] as const;

/** One submitted first assessment of a plot of the files, with the time it took when known. */
export interface TimedRecord {
  plot: string;
  operator: string;
  /** Active seconds, or null when Collect Earth did not send it (an older version, a tool). */
  seconds: number | null;
  /** When it was (first) submitted, ms. */
  submittedAt: number;
}

export interface PersonTime {
  username: string;
  /** Submitted plots with a time, and without. */
  timed: number;
  untimed: number;
  medianSeconds: number | null;
  /** The middle half of their plots: the first and third quartiles. */
  q1Seconds: number | null;
  q3Seconds: number | null;
  totalSeconds: number;
  /** Their plots under the quick limit (0 while there is no limit). */
  quick: number;
  /** How many of their timed plots fall in each band of TIME_BANDS (one more than the bands: the last is open). */
  bands: number[];
}

export interface QuickPlot {
  plot: string;
  operator: string;
  seconds: number;
  submittedAt: number;
}

export interface TimeSpent {
  timed: number;
  untimed: number;
  medianSeconds: number | null;
  q1Seconds: number | null;
  q3Seconds: number | null;
  /** Plots under this many seconds are quick; null while fewer than MIN_TIMED_FOR_QUICK plots are timed. */
  quickBelowSeconds: number | null;
  quickShare: number;
  minTimed: number;
  bands: number[];
  bandLimits: readonly number[];
  people: PersonTime[];
  /** All quick plots, counted. */
  quickCount: number;
  /** The quick plots, quickest first (at most MAX_LISTED_QUICK). */
  quick: QuickPlot[];
}

/** The value at a share (0..1) of sorted numbers, interpolated; null for none. */
export function quantile(sorted: readonly number[], share: number): number | null {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * share;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export function bandOf(seconds: number): number {
  let i = 0;
  while (i < TIME_BANDS.length && seconds >= TIME_BANDS[i]) i++;
  return i;
}

const whole = (v: number | null) => (v === null ? null : Math.round(v));

/** The figures of the time spent, from the submitted first assessments (one per person and plot). */
export function timeSpent(records: readonly TimedRecord[], options: { person?: string } = {}): TimeSpent {
  const all = records.filter((r) => r.seconds !== null).map((r) => r.seconds as number).sort((a, b) => a - b);
  const median = quantile(all, 0.5);
  const limit = all.length >= MIN_TIMED_FOR_QUICK && median !== null ? Math.max(1, Math.round(median * QUICK_SHARE)) : null;
  const isQuick = (s: number | null) => limit !== null && s !== null && s < limit;

  const byPerson = new Map<string, TimedRecord[]>();
  for (const r of records) {
    const list = byPerson.get(r.operator);
    if (list) list.push(r);
    else byPerson.set(r.operator, [r]);
  }
  const bands = (secs: readonly number[]) => {
    const out = new Array<number>(TIME_BANDS.length + 1).fill(0);
    for (const s of secs) out[bandOf(s)]++;
    return out;
  };
  const people: PersonTime[] = [...byPerson]
    .filter(([username]) => options.person === undefined || username === options.person)
    .map(([username, list]) => {
      const secs = list.filter((r) => r.seconds !== null).map((r) => r.seconds as number).sort((a, b) => a - b);
      return {
        username,
        timed: secs.length,
        untimed: list.length - secs.length,
        medianSeconds: whole(quantile(secs, 0.5)),
        q1Seconds: whole(quantile(secs, 0.25)),
        q3Seconds: whole(quantile(secs, 0.75)),
        totalSeconds: secs.reduce((a, b) => a + b, 0),
        quick: secs.filter((s) => isQuick(s)).length,
        bands: bands(secs),
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));

  const quickAll = records
    .filter((r) => isQuick(r.seconds) && (options.person === undefined || r.operator === options.person))
    .map((r) => ({ plot: r.plot, operator: r.operator, seconds: r.seconds as number, submittedAt: r.submittedAt }))
    .sort((a, b) => a.seconds - b.seconds || b.submittedAt - a.submittedAt || a.plot.localeCompare(b.plot));

  return {
    timed: all.length,
    untimed: records.length - all.length,
    medianSeconds: whole(median),
    q1Seconds: whole(quantile(all, 0.25)),
    q3Seconds: whole(quantile(all, 0.75)),
    quickBelowSeconds: limit,
    quickShare: QUICK_SHARE,
    minTimed: MIN_TIMED_FOR_QUICK,
    bands: bands(all),
    bandLimits: TIME_BANDS,
    people,
    quickCount: quickAll.length,
    quick: quickAll.slice(0, MAX_LISTED_QUICK),
  };
}
