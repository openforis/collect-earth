import type { RoundInfo } from './cep.js';
import { parseClientAgent } from './clientVersion.js';
import { addDays, daysBetween, localDate } from './days.js';
import { recordResolver } from './quality.js';
import { keyShape, splitKey } from './rounds.js';
import type { CepInfo, Member, MemberActivity, ProgressSettings } from './types.js';

/**
 * The Progress tab's figures (monitoring Phase 2), pure: the totals per plot unit, the
 * plots submitted per day, the forecast, and what needs the coordinator's attention.
 */

const DAY_MS = 86_400_000;
/** The forecast's pace is the plots submitted in this many days, today included, a day. */
export const PACE_DAYS = 14;
/** Unsent work is old when the median time between saving and the server receiving it is over this. */
export const OLD_UNSENT_MS = 2 * DAY_MS;
/** A storage limit is near from this share on (as the dashboard's storage bar says). */
export const NEARLY_FULL = 0.9;
/** At most this many people are named in a card (its count says how many there are). */
export const MAX_ATTENTION_PEOPLE = 50;

export interface ProgressRecord {
  recordKey: string;
  operator: string;
  activelySaved: boolean;
  deleted: boolean;
}

/** One operator's median of received_at − modified_on over their recent uploads. */
export interface UnsentDelay {
  operator: string;
  medianMs: number;
  uploads: number;
}

export interface AttentionInput {
  members: readonly Member[];
  activity: readonly MemberActivity[];
  unsentDelays: readonly UnsentDelay[];
  cep: CepInfo | null;
  storage: { usedBytes: number; limitBytes: number | null } | null;
  /** Differing plots without a decision; null when the project has no checks or the figures could not be had. */
  differencesWaiting: number | null;
}

export interface ProgressInput {
  now: number;
  timeZone: string;
  /** Days in `daily`, today included. */
  days: number;
  /** Every record of the project (listRecordSummaries). */
  records: readonly ProgressRecord[];
  info: RoundInfo | null;
  /** The plot ids (units) of every plot file (loadPlotContext). */
  units: ReadonlySet<string>;
  /** unit -> usernames holding it only as a quality-check copy. */
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>;
  /** unit -> usernames holding it as a main plot, for every plot of a divided file. */
  mainHolders: ReadonlyMap<string, ReadonlySet<string>>;
  /** csv file id -> its units. */
  fileUnits: ReadonlyMap<string, readonly string[]>;
  /** Whole files given to people (the assignment grid). */
  assignments: readonly { csvFileId: string; username: string }[];
  /** First submissions (record_events `submitted`) per local day, as the store counts them. */
  submittedByDay: readonly { date: string; count: number }[];
  settings: ProgressSettings;
  /** Absent for a reviewer: the cards name people. */
  attention?: AttentionInput;
}

export interface ProgressTotals {
  /** Plot units of the plot files, checks (the reassessment round of an own round) left out. */
  plots: number;
  assigned: number;
  notAssigned: number;
  /** Plots whose first assessment is submitted now. */
  submitted: number;
  /** Plots with a first assessment saved but not submitted. */
  started: number;
  notStarted: number;
}

export interface ProgressDay {
  date: string;
  /** Records submitted for the first time that day (checks included). */
  submitted: number;
  /** Plots submitted by the end of the day, as things are now (see dailyOf). */
  cumulative: number;
}

export interface Forecast {
  target: number;
  /** Where the target comes from: the project setting, or every assigned plot. */
  targetFrom: 'setting' | 'assigned';
  remaining: number;
  /** Plots a day over the last PACE_DAYS days. */
  pacePerDay: number;
  paceDays: number;
  /** Days until the rest is done at that pace; 0 when done; null without a pace. */
  daysLeft: number | null;
  /** today + daysLeft; null without a pace. */
  endDate: string | null;
  deadline: string | null;
  /** Days from today to the deadline (negative once it has passed). */
  daysToDeadline: number | null;
  /** endDate − deadline in days: over 0 is late. Null without a deadline or a pace. */
  daysOver: number | null;
  /** Plots a day needed to finish by the deadline; null when done, without a deadline or once it has passed. */
  neededPerDay: number | null;
}

export interface AttentionPerson {
  username: string;
  /** quiet: their last sync (or plot download when they never synced). */
  lastSyncAt?: number | null;
  /** oldUnsentWork: the median wait between saving and the server receiving it. */
  medianDelayMs?: number;
}

export type AttentionItem =
  | { kind: 'quiet'; count: number; quietDays: number; people: AttentionPerson[] }
  | { kind: 'neverDownloaded'; count: number; people: AttentionPerson[] }
  | { kind: 'notAssigned'; count: number }
  | { kind: 'oldUnsentWork'; count: number; people: AttentionPerson[] }
  | { kind: 'differencesWaiting'; count: number }
  | { kind: 'storage'; count: number; level: 'nearlyFull' | 'over'; usedBytes: number; limitBytes: number }
  | { kind: 'oldProjectFile'; count: number; people: AttentionPerson[] }
  | { kind: 'oldCollectEarth'; count: number; unknownVersion: number; people: AttentionPerson[] };

export interface Progress {
  timeZone: string;
  today: string;
  totals: ProgressTotals;
  daily: ProgressDay[];
  forecast: Forecast;
  /** Null for a reviewer. */
  attention: AttentionItem[] | null;
  settings: ProgressSettings;
}

export function progressReport(input: ProgressInput): Progress {
  const today = localDate(input.now, input.timeZone);
  const plotsOf = plotUnits(input);
  const totals = plotsOf.totals;
  const daily = dailyOf(input.submittedByDay, today, input.days, totals.submitted);
  return {
    timeZone: input.timeZone,
    today,
    totals,
    daily,
    forecast: forecastOf(totals, daily, today, input.settings),
    attention: input.attention ? attentionOf(input, input.attention, plotsOf) : null,
    settings: input.settings,
  };
}

interface PlotUnits {
  totals: ProgressTotals;
  submitted: ReadonlySet<string>;
  /** username -> the plots they hold as main plots (whole files and divided ones). */
  held: Map<string, string[]>;
}

function plotUnits(input: ProgressInput): PlotUnits {
  const { info, units } = input;
  const shape = keyShape(info);
  const code = info?.state === 'own' && shape.roundIndex !== null ? info.reassessmentCode : null;
  // An own round's file may list the re-assessment of a plot as a unit of its own: a check, not a plot.
  const isPlot = (unit: string) => code === null || splitKey(unit, shape.count, shape.roundIndex).round !== code;
  const plots = new Set<string>();
  for (const unit of units) {
    if (isPlot(unit)) plots.add(unit);
  }

  const held = new Map<string, string[]>();
  const hold = (username: string, unit: string) => {
    let list = held.get(username);
    if (!list) {
      list = [];
      held.set(username, list);
    }
    list.push(unit);
  };
  const assigned = new Set<string>();
  for (const a of input.assignments) {
    for (const unit of input.fileUnits.get(a.csvFileId) ?? []) {
      if (plots.has(unit)) {
        assigned.add(unit);
        hold(a.username, unit);
      }
    }
  }
  for (const [unit, users] of input.mainHolders) {
    if (users.size === 0 || !plots.has(unit)) continue;
    assigned.add(unit);
    for (const u of users) hold(u, unit);
  }

  // Each record resolved as the quality figures and the export do; only first
  // assessments of the files' plots count (checks, unknown rounds and records of plots
  // in no file do not).
  const resolve = recordResolver({ info, units, copyHolders: input.copyHolders });
  const submitted = new Set<string>();
  const saved = new Set<string>();
  for (const r of input.records) {
    if (r.deleted) continue;
    const { unit, round } = resolve(r);
    if (unit === null || round.assessment !== 'main' || !plots.has(unit)) continue;
    (r.activelySaved ? submitted : saved).add(unit);
  }
  let started = 0;
  for (const unit of saved) {
    if (!submitted.has(unit)) started += 1;
  }
  return {
    totals: {
      plots: plots.size,
      assigned: assigned.size,
      notAssigned: plots.size - assigned.size,
      submitted: submitted.size,
      started,
      notStarted: plots.size - submitted.size - started,
    },
    submitted,
    held,
  };
}

/**
 * The last `days` days, today included. Days after today (a collector's clock ahead)
 * count as today.
 *
 * `submitted` counts the record events `submitted` of the day: each record's first
 * submission, checks included. The cumulative line is worked out backwards from the
 * plots submitted now (totals.submitted): each day ends at that total less what was
 * submitted after it. So it always ends at the headline number; the days before the
 * window, plots submitted again after being changed (`resubmitted`), plots taken back
 * or deleted since, checks and records of plots in no file are what makes the sum of
 * the bars differ from it, and they are absorbed in its start (never below 0).
 */
export function dailyOf(byDay: readonly { date: string; count: number }[], today: string, days: number, submittedNow: number): ProgressDay[] {
  const first = addDays(today, -(days - 1));
  const counts = new Map<string, number>();
  for (const { date, count } of byDay) {
    if (date < first) continue;
    const day = date > today ? today : date;
    counts.set(day, (counts.get(day) ?? 0) + count);
  }
  const result: ProgressDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i);
    result.push({ date, submitted: counts.get(date) ?? 0, cumulative: 0 });
  }
  let total = submittedNow;
  for (let i = result.length - 1; i >= 0; i--) {
    result[i].cumulative = Math.max(0, total);
    total -= result[i].submitted;
  }
  return result;
}

export function forecastOf(totals: ProgressTotals, daily: readonly ProgressDay[], today: string, settings: ProgressSettings): Forecast {
  const target = settings.targetPlots ?? totals.assigned;
  const remaining = Math.max(0, target - totals.submitted);
  const recent = daily.slice(-PACE_DAYS);
  const pacePerDay = recent.reduce((sum, d) => sum + d.submitted, 0) / PACE_DAYS;
  const daysLeft = remaining === 0 ? 0 : pacePerDay > 0 ? Math.ceil(remaining / pacePerDay) : null;
  const endDate = daysLeft === null ? null : addDays(today, daysLeft);
  const deadline = settings.deadline;
  const daysToDeadline = deadline === null ? null : daysBetween(today, deadline);
  return {
    target,
    targetFrom: settings.targetPlots !== null ? 'setting' : 'assigned',
    remaining,
    pacePerDay,
    paceDays: PACE_DAYS,
    daysLeft,
    endDate,
    deadline,
    daysToDeadline,
    daysOver: deadline !== null && endDate !== null ? daysBetween(deadline, endDate) : null,
    // The deadline day counts as a working day; a deadline today leaves one.
    neededPerDay: remaining > 0 && daysToDeadline !== null && daysToDeadline >= 0 ? Math.ceil(remaining / (daysToDeadline + 1)) : null,
  };
}

const byName = (a: AttentionPerson, b: AttentionPerson) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);
const capped = (people: AttentionPerson[]) => people.sort(byName).slice(0, MAX_ATTENTION_PEOPLE);

function attentionOf(input: ProgressInput, a: AttentionInput, plotsOf: PlotUnits): AttentionItem[] {
  const items: AttentionItem[] = [];
  const activity = new Map(a.activity.map((x) => [x.userId, x]));
  const { held, submitted } = plotsOf;
  const quietDays = input.settings.quietDays;

  const quiet: AttentionPerson[] = [];
  const never: AttentionPerson[] = [];
  const oldFile: AttentionPerson[] = [];
  const oldCe: AttentionPerson[] = [];
  let unknownVersion = 0;
  // Who holds plots at all (main plots or quality-check copies): the people Collect Earth's version matters for.
  const holdsAny = new Set(held.keys());
  for (const users of input.copyHolders.values()) for (const u of users) holdsAny.add(u);
  const usesChecks = input.copyHolders.size > 0;

  for (const m of a.members) {
    const act = activity.get(m.userId);
    const plots = held.get(m.username) ?? [];
    const downloaded = act?.lastPlotsDownloadAt ?? null;
    const synced = act?.lastSyncAt ?? null;
    if (plots.length > 0 && downloaded === null && synced === null) {
      never.push({ username: m.username });
    } else if (plots.some((u) => !submitted.has(u))) {
      // Plots left to do, and no sync for quietDays (or, never synced, since the plots came).
      const last = synced ?? downloaded;
      if (last !== null && input.now - last > quietDays * DAY_MS) {
        quiet.push({ username: m.username, lastSyncAt: last });
      }
    }
    if (a.cep && act?.lastCepDownloadAt != null && act.lastCepDownloadAt < a.cep.updatedAt) {
      oldFile.push({ username: m.username });
    }
    const usedCollectEarth = act !== undefined && (synced !== null || downloaded !== null || act.lastCepDownloadAt !== null);
    if (usesChecks && holdsAny.has(m.username) && usedCollectEarth) {
      const kind = parseClientAgent(act.clientAgent).kind;
      if (kind === 'old-collect-earth') oldCe.push({ username: m.username });
      else if (kind === 'unknown') unknownVersion += 1;
    }
  }

  if (quiet.length > 0) items.push({ kind: 'quiet', count: quiet.length, quietDays, people: capped(quiet) });
  if (never.length > 0) items.push({ kind: 'neverDownloaded', count: never.length, people: capped(never) });
  if (plotsOf.totals.notAssigned > 0) items.push({ kind: 'notAssigned', count: plotsOf.totals.notAssigned });
  const late = a.unsentDelays.filter((d) => d.medianMs > OLD_UNSENT_MS).map((d) => ({ username: d.operator, medianDelayMs: d.medianMs }));
  if (late.length > 0) items.push({ kind: 'oldUnsentWork', count: late.length, people: capped(late) });
  if (a.differencesWaiting !== null && a.differencesWaiting > 0) items.push({ kind: 'differencesWaiting', count: a.differencesWaiting });
  const s = a.storage;
  if (s && s.limitBytes !== null && s.limitBytes > 0 && s.usedBytes >= s.limitBytes * NEARLY_FULL) {
    items.push({ kind: 'storage', count: 1, level: s.usedBytes > s.limitBytes ? 'over' : 'nearlyFull', usedBytes: s.usedBytes, limitBytes: s.limitBytes });
  }
  if (oldFile.length > 0) items.push({ kind: 'oldProjectFile', count: oldFile.length, people: capped(oldFile) });
  // Unknown versions are said apart and never counted as old.
  if (oldCe.length > 0 || unknownVersion > 0) {
    items.push({ kind: 'oldCollectEarth', count: oldCe.length, unknownVersion, people: capped(oldCe) });
  }
  return items;
}

/** Differing plots without a decision: listed plots without one, plus those beyond the list (assumed waiting). */
export function differencesWaiting(report: { plotsDiffering: number; differences: readonly { plot: string }[] }, decided: ReadonlySet<string>): number {
  const listed = new Set(report.differences.map((d) => d.plot));
  let decidedListed = 0;
  for (const plot of listed) {
    if (decided.has(plot)) decidedListed += 1;
  }
  return Math.max(0, report.plotsDiffering - decidedListed);
}
