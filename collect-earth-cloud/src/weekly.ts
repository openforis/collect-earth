import { addDays } from './days.js';
import type { FlagCounts } from './flags.js';
import type { PeopleTable } from './people.js';
import { dayInZone, type PlotUnits } from './progress.js';
import { isoWeek, MIN_PLOTS, overallAgreement, type QualityReport, type Rate } from './quality.js';
import type { QualityDecision } from './types.js';
import type { WeeklyPerson, WeeklySummary } from './wire/activity.js';

export type { WeeklyPerson, WeeklySummary } from './wire/activity.js';

/**
 * The weekly summary (Task 10, monitoring Phase 6), pure: one ISO week (Monday to Sunday) of the
 * viewer's calendar, as a printable page: the plots done that week and in all, each person's
 * week, and the quality of the week from the figures at hand (never worked out for it).
 */

/** Whether `text` is an ISO week written YYYY-Www that exists (week 53 only in years that have it). */
export function isIsoWeek(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const m = /^(\d{4})-W(\d{2})$/.exec(text);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= 53 && weekOfDate(weekMonday(text)) === text;
}

/** The ISO week of a calendar day. */
export function weekOfDate(date: string): string {
  return isoWeek(Date.parse(`${date}T00:00:00Z`));
}

/** The Monday of an ISO week (week 1 is the week with the year's first Thursday, so with 4 January). */
export function weekMonday(week: string): string {
  const year = Number(week.slice(0, 4));
  const n = Number(week.slice(6, 8));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = (jan4.getUTCDay() + 6) % 7; // Monday 0
  const monday1 = addDays(`${year}-01-04`, -weekday);
  return addDays(monday1, (n - 1) * 7);
}

export interface WeeklyInput {
  week: string;
  timeZone: string;
  now: number;
  /** The project state's units, with byOperator (ProjectStateCache). */
  units: PlotUnits;
  /** The People table as it is now (its rows give the status and the plots). */
  people: PeopleTable;
  decisions: readonly QualityDecision[];
  quality: { report: QualityReport; computedAt: number; stale: boolean } | null;
  /** The flags of the week (patternFlags with `when`); null without figures. */
  flags: { counts: FlagCounts; total: number } | null;
  /** The reference plots (Task 14): their checks are counted apart, their decisions (made before they were marked) not at all. */
  reference?: { has(unit: string): boolean } | null;
}

const rateOf = (compared: number, agreeing: number): Rate => ({ compared, agreeing, rate: compared >= MIN_PLOTS ? agreeing / compared : null });

/** The week's summary. */
export function weeklySummary(input: WeeklyInput): WeeklySummary {
  const start = weekMonday(input.week);
  const end = addDays(start, 6);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const dayOf = dayInZone(input.timeZone);
  const inWeek = (date: string) => date >= start && date <= end;

  const plotsByDay = new Map<string, number>();
  let before = 0;
  let byEnd = 0;
  for (const at of input.units.firstSubmitted.values()) {
    const date = dayOf(at);
    if (date < start) before += 1;
    if (date <= end) byEnd += 1;
    if (inWeek(date)) plotsByDay.set(date, (plotsByDay.get(date) ?? 0) + 1);
  }
  const reference = input.reference ?? null;
  const checksByDay = new Map<string, number>();
  let referenceMeasurements = 0;
  const people: WeeklyPerson[] = input.people.people.map((row) => {
    const work = input.units.byOperator.get(row.username);
    let submitted = 0;
    let checks = 0;
    let measurements = 0;
    for (const at of work?.mainSubmitted.values() ?? []) if (inWeek(dayOf(at))) submitted += 1;
    for (const [unit, at] of work?.checkSubmitted ?? []) {
      const date = dayOf(at);
      if (!inWeek(date)) continue;
      if (reference?.has(unit)) {
        measurements += 1;
        continue;
      }
      checks += 1;
      checksByDay.set(date, (checksByDay.get(date) ?? 0) + 1);
    }
    referenceMeasurements += measurements;
    return { userId: row.userId, username: row.username, role: row.role, submitted, checks, referenceMeasurements: measurements, status: row.status, plots: row.plots };
  });
  people.sort((a, b) => b.submitted - a.submitted || b.checks - a.checks || (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));

  const decided = { first: 0, check: 0, recheck: 0, total: 0 };
  for (const d of input.decisions) {
    if (reference?.has(d.plot)) continue;
    if (inWeek(dayOf(d.decidedAt))) {
      decided[d.decision] += 1;
      decided.total += 1;
    }
  }
  const report = input.quality?.report ?? null;
  const weekRow = report?.weeks.find((w) => w.week === input.week) ?? null;
  const days = dates.map((date) => ({ date, submitted: plotsByDay.get(date) ?? 0, checks: checksByDay.get(date) ?? 0 }));
  return {
    week: input.week,
    timeZone: input.timeZone,
    start,
    end,
    current: inWeek(dayOf(input.now)),
    progress: {
      days,
      submitted: days.reduce((s, d) => s + d.submitted, 0),
      checks: days.reduce((s, d) => s + d.checks, 0),
      referenceMeasurements,
      before,
      byEnd,
      totals: input.units.totals,
    },
    people,
    quality: {
      available: input.quality !== null,
      computedAt: input.quality?.computedAt ?? null,
      stale: input.quality?.stale ?? false,
      week: report ? rateOf(weekRow?.compared ?? 0, weekRow?.agreeing ?? 0) : null,
      overall: report ? overallAgreement(report) : null,
      decided,
      flags: input.flags,
    },
  };
}
