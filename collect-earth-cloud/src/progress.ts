import type { RoundInfo } from './cep.js';
import { holderCount, holderList, type Holders } from './holders.js';
import { parseClientAgent } from './clientVersion.js';
import { addDays, daysBetween, localDate } from './days.js';
import { recordResolver } from './quality.js';
import { keyShape, splitKey } from './rounds.js';
import type { CepInfo, Member, MemberActivity, ProgressSettings } from './types.js';

/**
 * The Progress tab's figures (monitoring Phase 2), pure: the totals per plot unit, the
 * plots submitted per day, the forecast, and what needs the coordinator's attention.
 * Every figure counts the same thing: plot units of the plot files whose first
 * assessment (round 1, not a check) is submitted now.
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

/** A record as listRecordStates gives it. */
export interface ProgressRecord {
  recordKey: string;
  operator: string;
  activelySaved: boolean;
  deleted: boolean;
  modifiedOn: number;
  /** Its first submission (record event `submitted`); null when none is known. */
  firstSubmittedOn: number | null;
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
  /** Differing plots without a decision; null when the project has no checks or no figures are at hand. */
  differencesWaiting: number | null;
}

export interface ProgressInput {
  now: number;
  timeZone: string;
  /** Days in `daily`, today included. */
  days: number;
  /** Every record of the project (listRecordStates). */
  records: readonly ProgressRecord[];
  info: RoundInfo | null;
  /** The plot ids (units) of every plot file (loadPlotContext). */
  units: ReadonlySet<string>;
  /** unit -> usernames holding it only as a quality-check copy. */
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>;
  /** unit -> usernames holding it as a main plot, for every plot of a divided file. */
  mainHolders: ReadonlyMap<string, Holders>;
  /** csv file id -> its units. */
  fileUnits: ReadonlyMap<string, readonly string[]>;
  /** Whole files given to people (the assignment grid). */
  assignments: readonly { csvFileId: string; username: string }[];
  settings: ProgressSettings;
  /** Absent for a reviewer: the cards name people. */
  attention?: AttentionInput;
  /** The records already resolved (ProjectStateCache); else worked out here from `records`. */
  prepared?: PlotUnits;
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
  /** Plots (submitted now) whose first assessment was first submitted that day. */
  submitted: number;
  /** Plots submitted by the end of the day, of those submitted now. */
  cumulative: number;
}

export interface Forecast {
  target: number;
  /** Where the target comes from: the project setting, or every assigned plot. */
  targetFrom: 'setting' | 'assigned';
  remaining: number;
  /** Plots a day over the last paceDays days. */
  pacePerDay: number;
  /** PACE_DAYS, or fewer when the first plot was submitted less than PACE_DAYS days ago. */
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
  /** quiet: their last sync and their last plot download (the later one is what counts). */
  lastSyncAt?: number | null;
  lastPlotsDownloadAt?: number | null;
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
  const plotsOf = input.prepared ?? plotUnits(input);
  const totals = plotsOf.totals;
  // Each plot submitted now, once, on the local day of its first submission.
  const dayOf = dayInZone(input.timeZone);
  const byDay = new Map<string, number>();
  let firstDate: string | null = null;
  for (const ms of plotsOf.firstSubmitted.values()) {
    const date = dayOf(ms);
    byDay.set(date, (byDay.get(date) ?? 0) + 1);
    if (firstDate === null || date < firstDate) firstDate = date;
  }
  const daily = dailyOf(byDay, today, input.days);
  return {
    timeZone: input.timeZone,
    today,
    totals,
    daily,
    forecast: forecastOf(totals, daily, today, input.settings, firstDate),
    attention: input.attention ? attentionOf(input, input.attention, plotsOf) : null,
    settings: input.settings,
  };
}

/** One person's records, resolved as the totals count them (plotUnits with perOperator). */
export interface OperatorWork {
  /** Plots (units of the files) whose first assessment by them is submitted -> its first submission. */
  mainSubmitted: Map<string, number>;
  /** Plots whose first assessment by them is saved and not submitted. */
  mainDrafts: Set<string>;
  /** Units they checked (a check by them submitted) -> its first submission. */
  checkSubmitted: Map<string, number>;
  /** Units with a check by them saved and not submitted. */
  checkDrafts: Set<string>;
  /** The first submissions of their records known from the record events (main and checks), unsorted. */
  submissionTimes: number[];
  /**
   * Each submitted first assessment of theirs: its first submission, or for a record older
   * than the events its modifiedOn (as the pattern flags order them), unsorted.
   */
  mainSubmissionTimes: number[];
}

export interface PlotUnits {
  totals: ProgressTotals;
  /** Each plot submitted now -> the earliest first submission among its submitted first assessments. */
  firstSubmitted: ReadonlyMap<string, number>;
  /** Plots with a first assessment saved, none submitted (the totals' `started`). */
  started: ReadonlySet<string>;
  /** username -> the plots they hold as main plots (whole files and divided ones). */
  held: Map<string, string[]>;
  /** username -> the plots they hold as quality-check copies. */
  copies: Map<string, string[]>;
  /** `${operator}\n${unit}`: a check submitted now by that person on that plot. */
  checksDone: ReadonlySet<string>;
  /** operator -> their records, resolved as the totals count them (only when asked for: the People tab). */
  byOperator: Map<string, OperatorWork>;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** What plotUnits reads of the Progress input. */
export type PlotUnitsInput = Pick<ProgressInput, 'info' | 'units' | 'copyHolders' | 'mainHolders' | 'fileUnits' | 'assignments' | 'records'>;

function workOf(byOperator: Map<string, OperatorWork>, operator: string): OperatorWork {
  let work = byOperator.get(operator);
  if (!work) {
    work = { mainSubmitted: new Map(), mainDrafts: new Set(), checkSubmitted: new Map(), checkDrafts: new Set(), submissionTimes: [], mainSubmissionTimes: [] };
    byOperator.set(operator, work);
  }
  return work;
}

/**
 * Whether a unit of the plot files is a plot: an own round's file may list the
 * re-assessment of a plot as a unit of its own (its round is the reassessment code),
 * which is a check, not a plot.
 */
export function isPlotUnit(info: RoundInfo | null): (unit: string) => boolean {
  const shape = keyShape(info);
  const code = info?.state === 'own' && shape.roundIndex !== null ? info.reassessmentCode : null;
  return (unit) => code === null || splitKey(unit, shape.count, shape.roundIndex).round !== code;
}

/**
 * The plots of the files, who holds which, and each plot's state, counted per plot unit
 * (the Progress tab's totals). With `perOperator`, also each person's records resolved
 * the same way (the People tab), so a person's numbers and the totals never disagree.
 */
export function plotUnits(input: PlotUnitsInput, perOperator = false): PlotUnits {
  const { info, units } = input;
  const isPlot = isPlotUnit(info);
  const plots = new Set<string>();
  for (const unit of units) {
    if (isPlot(unit)) plots.add(unit);
  }

  const held = new Map<string, string[]>();
  const assigned = new Set<string>();
  for (const a of input.assignments) {
    for (const unit of input.fileUnits.get(a.csvFileId) ?? []) {
      if (plots.has(unit)) {
        assigned.add(unit);
        push(held, a.username, unit);
      }
    }
  }
  for (const [unit, users] of input.mainHolders) {
    if (holderCount(users) === 0 || !plots.has(unit)) continue;
    assigned.add(unit);
    for (const u of holderList(users)) push(held, u, unit);
  }
  const copies = new Map<string, string[]>();
  for (const [unit, users] of input.copyHolders) {
    for (const u of users) push(copies, u, unit);
  }

  // Each record resolved as the quality figures and the export do; only first
  // assessments of the files' plots count (checks, unknown rounds and records of plots
  // in no file do not).
  const resolve = recordResolver({ info, units, copyHolders: input.copyHolders });
  const firstSubmitted = new Map<string, number>();
  const saved = new Set<string>();
  const checksDone = new Set<string>();
  const byOperator = new Map<string, OperatorWork>();
  for (const r of input.records) {
    if (r.deleted) continue;
    const { unit, round } = resolve(r);
    const work = perOperator ? workOf(byOperator, r.operator) : null;
    if (unit === null) continue;
    // A submitted record with no event `submitted` (stored before events were kept): its time.
    const at = r.firstSubmittedOn ?? r.modifiedOn;
    if (round.assessment === 'check') {
      if (r.activelySaved) {
        checksDone.add(`${r.operator}\n${unit}`);
        if (work) {
          work.checkSubmitted.set(unit, Math.min(work.checkSubmitted.get(unit) ?? Infinity, at));
          if (r.firstSubmittedOn !== null) work.submissionTimes.push(r.firstSubmittedOn);
        }
      } else {
        work?.checkDrafts.add(unit);
      }
      continue;
    }
    if (round.assessment !== 'main' || !plots.has(unit)) continue;
    if (r.activelySaved) {
      firstSubmitted.set(unit, Math.min(firstSubmitted.get(unit) ?? Infinity, at));
      if (work) {
        work.mainSubmitted.set(unit, Math.min(work.mainSubmitted.get(unit) ?? Infinity, at));
        if (r.firstSubmittedOn !== null) work.submissionTimes.push(r.firstSubmittedOn);
        work.mainSubmissionTimes.push(at);
      }
    } else {
      saved.add(unit);
      work?.mainDrafts.add(unit);
    }
  }
  const started = new Set<string>();
  for (const unit of saved) {
    if (!firstSubmitted.has(unit)) started.add(unit);
  }
  return {
    totals: {
      plots: plots.size,
      assigned: assigned.size,
      notAssigned: plots.size - assigned.size,
      submitted: firstSubmitted.size,
      started: started.size,
      notStarted: plots.size - firstSubmitted.size - started.size,
    },
    firstSubmitted,
    started,
    held,
    copies,
    checksDone,
    byOperator,
  };
}

const SLOT_MS = 15 * 60_000;

/**
 * localDate in a time zone, cached per quarter of an hour: zone offsets and their
 * changes are whole quarters of an hour, so a local day never starts inside one. 100,000
 * plots cost a few thousand Intl calls.
 */
export function dayInZone(timeZone: string): (ms: number) => string {
  const cache = new Map<number, string>();
  return (ms) => {
    const slot = Math.floor(ms / SLOT_MS);
    let date = cache.get(slot);
    if (date === undefined) {
      date = localDate(slot * SLOT_MS, timeZone);
      cache.set(slot, date);
    }
    return date;
  };
}

/**
 * The last `days` days, today included, from the plots submitted now counted on the day
 * of their first submission. Days after today (a collector's clock ahead) count as
 * today. The cumulative line starts with the plots first submitted before the window,
 * so it ends at the plots submitted now (totals.submitted).
 */
export function dailyOf(byDay: ReadonlyMap<string, number>, today: string, days: number): ProgressDay[] {
  const first = addDays(today, -(days - 1));
  const counts = new Map<string, number>();
  let total = 0;
  for (const [date, count] of byDay) {
    if (date < first) {
      total += count;
      continue;
    }
    const day = date > today ? today : date;
    counts.set(day, (counts.get(day) ?? 0) + count);
  }
  const result: ProgressDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i);
    const submitted = counts.get(date) ?? 0;
    total += submitted;
    result.push({ date, submitted, cumulative: total });
  }
  return result;
}

/**
 * `firstDate`: the day the first plot was first submitted (null for none). A collection
 * that started less than PACE_DAYS days ago has its pace over the days since.
 */
export function forecastOf(totals: ProgressTotals, daily: readonly ProgressDay[], today: string, settings: ProgressSettings, firstDate: string | null): Forecast {
  const target = settings.targetPlots ?? totals.assigned;
  const remaining = Math.max(0, target - totals.submitted);
  const paceDays = firstDate === null ? PACE_DAYS : Math.min(PACE_DAYS, Math.max(1, daysBetween(firstDate, today) + 1));
  const pacePerDay = daily.slice(-paceDays).reduce((sum, d) => sum + d.submitted, 0) / paceDays;
  const daysLeft = remaining === 0 ? 0 : pacePerDay > 0 ? Math.ceil(remaining / pacePerDay) : null;
  const endDate = daysLeft === null ? null : addDays(today, daysLeft);
  const deadline = settings.deadline;
  const daysToDeadline = deadline === null ? null : daysBetween(today, deadline);
  return {
    target,
    targetFrom: settings.targetPlots !== null ? 'setting' : 'assigned',
    remaining,
    pacePerDay,
    paceDays,
    daysLeft,
    endDate,
    deadline,
    daysToDeadline,
    daysOver: deadline !== null && endDate !== null ? daysBetween(deadline, endDate) : null,
    // The deadline day counts as a working day; a deadline today leaves one.
    neededPerDay: remaining > 0 && daysToDeadline !== null && daysToDeadline >= 0 ? Math.ceil(remaining / (daysToDeadline + 1)) : null,
  };
}

/**
 * Someone with plots left is quiet when neither a sync nor a plot download (the later
 * one) came for more than quietDays days. Never either: not quiet (they never
 * downloaded their plots; the cards say that apart).
 */
export function isQuiet(now: number, quietDays: number, lastSyncAt: number | null, lastPlotsDownloadAt: number | null): boolean {
  const last = Math.max(lastSyncAt ?? -Infinity, lastPlotsDownloadAt ?? -Infinity);
  return last > -Infinity && now - last > quietDays * DAY_MS;
}

const byName = (a: AttentionPerson, b: AttentionPerson) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);
const capped = (people: AttentionPerson[]) => people.sort(byName).slice(0, MAX_ATTENTION_PEOPLE);

function attentionOf(input: ProgressInput, a: AttentionInput, plotsOf: PlotUnits): AttentionItem[] {
  const items: AttentionItem[] = [];
  const activity = new Map(a.activity.map((x) => [x.userId, x]));
  const { held, copies, checksDone, firstSubmitted } = plotsOf;
  const quietDays = input.settings.quietDays;
  const usesChecks = input.copyHolders.size > 0;

  const quiet: AttentionPerson[] = [];
  const never: AttentionPerson[] = [];
  const oldFile: AttentionPerson[] = [];
  const oldCe: AttentionPerson[] = [];
  let unknownVersion = 0;

  for (const m of a.members) {
    const act = activity.get(m.userId);
    const mains = held.get(m.username) ?? [];
    const checks = copies.get(m.username) ?? [];
    const holdsPlots = mains.length > 0 || checks.length > 0;
    const downloaded = act?.lastPlotsDownloadAt ?? null;
    const synced = act?.lastSyncAt ?? null;
    const left = mains.some((u) => !firstSubmitted.has(u)) || checks.some((u) => !checksDone.has(`${m.username}\n${u}`));
    if (m.disabled) {
      // The server owner disabled the account: not quiet nor "never downloaded" (the People
      // tab says "disabled"); their plots wait until it is enabled.
    } else if (holdsPlots && downloaded === null && synced === null) {
      never.push({ username: m.username });
    } else if (left) {
      // Plots left to do, and neither a sync nor a plot download for quietDays. When
      // plots were given is not stored for divided files, so their download (Collect
      // Earth gets new plots that way) stands for it: someone given plots after their
      // last sync is not quiet until quietDays after they downloaded them.
      if (isQuiet(input.now, quietDays, synced, downloaded)) {
        quiet.push({ username: m.username, lastSyncAt: synced, lastPlotsDownloadAt: downloaded });
      }
    }
    // The project file and Collect Earth's version matter for people who collect: who
    // holds plots or has synced (a coordinator's own use of the dashboard does not count).
    if (!holdsPlots && synced === null) continue;
    if (a.cep && act?.lastCepDownloadAt != null && act.lastCepDownloadAt < a.cep.updatedAt) {
      oldFile.push({ username: m.username });
    }
    const usedCollectEarth = act !== undefined && (synced !== null || downloaded !== null || act.lastCepDownloadAt !== null);
    if (usesChecks && holdsPlots && usedCollectEarth) {
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
