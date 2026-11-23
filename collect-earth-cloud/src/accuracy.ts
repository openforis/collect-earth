// A share judged against the project's accuracy target (Quality rules): its 95% margin of error, and a verdict a
// coordinator can act on in the first days, when few plots are compared. Pure functions.
//
// The margin is the Wilson score interval: unlike the plain ±1.96·sqrt(p(1−p)/n) it stays inside 0..1 and holds for
// the small numbers of the first days (9 of 10 right gives 60% to 98%, not 71% to 109%).
import type { Judged, Verdict } from './wire/checks.js';

/** The accuracy target of a project that has not set one, in percent. */
export const DEFAULT_ACCURACY_TARGET = 80;
/** The target a project may set, in whole percent. */
export const MIN_ACCURACY_TARGET = 50;
export const MAX_ACCURACY_TARGET = 100;
/** Fewer compared than this: never "below" nor "ok", whatever the share (one wrong answer of two says little). */
export const MIN_VERDICT = 5;

const Z = 1.959963984540054; // the 97.5th percentile of the normal distribution: a 95% interval

/** The target in a project's quality settings, or the default; in percent. */
export function accuracyTargetOf(settings: { accuracyTarget?: number }): number {
  const t = settings.accuracyTarget;
  return typeof t === 'number' && Number.isInteger(t) && t >= MIN_ACCURACY_TARGET && t <= MAX_ACCURACY_TARGET ? t : DEFAULT_ACCURACY_TARGET;
}

/** The 95% Wilson interval of `agreeing` of `compared`, 0..1; null with nothing compared. */
export function wilson(compared: number, agreeing: number): { low: number; high: number } | null {
  if (!(compared > 0)) return null;
  const n = compared;
  const p = Math.min(1, Math.max(0, agreeing / n));
  const z2 = Z * Z;
  const centre = p + z2 / (2 * n);
  const spread = Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denominator = 1 + z2 / n;
  // All right or all wrong: the bound on that side is exactly 1 or 0 (not 0.9999999 from the rounding)
  return { low: agreeing <= 0 ? 0 : Math.max(0, (centre - spread) / denominator), high: agreeing >= n ? 1 : Math.min(1, (centre + spread) / denominator) };
}

/**
 * How `agreeing` of `compared` stands against the target (percent):
 * - below: at least MIN_VERDICT compared, and even the top of the margin is under the target;
 * - watch: the share is under the target, but the margin reaches it (or fewer than MIN_VERDICT are compared);
 * - ok: the share is at the target or above, with at least MIN_VERDICT compared;
 * - early: at the target or above, but fewer than MIN_VERDICT compared: too few to say.
 * Null with nothing compared.
 */
export function verdictOf(compared: number, agreeing: number, target: number): Verdict | null {
  const interval = wilson(compared, agreeing);
  if (!interval) return null;
  const goal = target / 100;
  const share = agreeing / compared;
  // A target of 100% is met only by everything right: the comparison allows for the division's rounding.
  if (share >= goal - 1e-12) return compared >= MIN_VERDICT ? 'ok' : 'early';
  return compared >= MIN_VERDICT && interval.high < goal ? 'below' : 'watch';
}

/** The margin and the verdict of a share, for the wire. */
export function judge(compared: number, agreeing: number, target: number): Judged {
  const interval = wilson(compared, agreeing);
  return { low: interval?.low ?? null, high: interval?.high ?? null, verdict: verdictOf(compared, agreeing, target) };
}

const RANK: Record<Verdict, number> = { below: 3, watch: 2, ok: 1, early: 0 };

/** The most worrying of some verdicts (below, then watch, then ok, then early); null for none. */
export function worst(verdicts: readonly (Verdict | null)[]): Verdict | null {
  let found: Verdict | null = null;
  for (const v of verdicts) if (v !== null && (found === null || RANK[v] > RANK[found])) found = v;
  return found;
}

/** A change of this much between someone's earlier and latest answers is a trend worth showing (0..1). */
export const TREND_STEP = 0.1;
/** Fewer answers than this on either side: no trend. */
export const MIN_TREND = 10;

/**
 * Whether the latest answers are better or worse than the earlier ones: a change of TREND_STEP or more that is also
 * beyond chance (a two-proportion z-test at 95%: ten answers on a good day say little). Otherwise "same": no clear
 * change. Null when either side is too small to say anything.
 */
export function trendOf(earlier: { compared: number; agreeing: number } | null, recent: { compared: number; agreeing: number } | null): 'better' | 'worse' | 'same' | null {
  if (!earlier || !recent || earlier.compared < MIN_TREND || recent.compared < MIN_TREND) return null;
  const change = recent.agreeing / recent.compared - earlier.agreeing / earlier.compared;
  if (Math.abs(change) < TREND_STEP - 1e-12) return 'same';
  const pooled = (recent.agreeing + earlier.agreeing) / (recent.compared + earlier.compared);
  const error = Math.sqrt(pooled * (1 - pooled) * (1 / recent.compared + 1 / earlier.compared));
  if (!(error > 0) || Math.abs(change) / error < Z) return 'same';
  return change > 0 ? 'better' : 'worse';
}
