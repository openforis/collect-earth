import { parseClientAgent } from './clientVersion.js';
import { addDays, localDate, localHour } from './days.js';
import { dailyOf, dayInZone, isQuiet, plotUnits, type OperatorWork, type PlotUnits, type PlotUnitsInput } from './progress.js';
import type { QualityReport, Rate } from './quality.js';
import type { CepInfo, CsvFile, InviteSummary, Member, MemberActivity, ProgressSettings, QualityDecision, Role } from './types.js';

/**
 * The People tab (monitoring Phase 3), pure: one row per person, the week, and each
 * person's page (their days and hours, their files and plots, an estimate of their
 * speed, their sync health and quality). Plots are counted as the Progress tab counts
 * them (plotUnits), so a person's numbers and the totals never disagree: a person's
 * "submitted" are the plots whose first assessment by them is submitted now; the
 * quality-check copies they hold are counted apart, as checks.
 */

const DAY_MS = 86_400_000;
/** Submissions further apart than this are in different working sessions. */
export const SESSION_GAP_MS = 30 * 60_000;
/** A submission this soon after the one before is "very fast". */
export const VERY_FAST_MS = 15_000;
/** The upper ends of the speed distribution's bins (the last is SESSION_GAP_MS). */
export const SPEED_BUCKETS_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000, SESSION_GAP_MS] as const;
/** "Submitted in the last 7 days" and the week: today and the 6 days before. */
export const WEEK_DAYS = 7;
/** The week names this many most active and least active people. */
export const WEEK_PEOPLE = 3;
/** A person's page lists at most this many plots of each file (the counts are of all). */
export const MAX_LISTED_PLOTS = 1000;

export type PersonStatus =
  /** Holds no plots (a coordinator, or someone whose plots were all moved). */
  | { kind: 'noPlots' }
  /** Every plot they hold is submitted and every check copy checked. */
  | { kind: 'finished' }
  /** Holds plots, has sent nothing yet (or never downloaded their plots). */
  | { kind: 'neverStarted' }
  /** Plots left, and neither a sync nor a plot download for more than quietDays days (red after twice that). */
  | { kind: 'quiet'; days: number; level: 'amber' | 'red' }
  | { kind: 'working' };

export interface PersonRow {
  userId: string;
  username: string;
  role: Role;
  plots: {
    /** Plots they hold (whole files given to them, and their plots of divided files). */
    assigned: number;
    /** Plots whose first assessment by them is submitted now (held now or not). */
    submitted: number;
    /** Plots with their first assessment saved, not submitted. */
    started: number;
    /** Plots they hold that nobody has submitted yet. */
    remaining: number;
    /** (assigned − remaining) / assigned, 0..1; null without plots. */
    done: number | null;
  };
  checks: {
    /** Quality-check copies they hold. */
    assigned: number;
    /** Checks by them submitted now. */
    submitted: number;
    /** Copies they hold without their submitted check. */
    remaining: number;
  };
  /** Plots (not checks) first submitted in the last 7 days, today included, in the viewer's time zone. */
  submittedLast7: number;
  /** The median of plots a day over the days they submitted any; null for none. */
  medianPerDay: number | null;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  /** Their latest first submission of a plot or a check. */
  lastSubmittedAt: number | null;
  /** Their plots as first assessor that a check compared; null when the quality figures are not at hand. */
  agreement: Rate | null;
  status: PersonStatus;
}

export interface InviteRow {
  id: string;
  role: Role;
  usedCount: number;
  maxUses: number;
  expiresAt: number | null;
  createdAt: number;
}

export interface WeekSummary {
  /** The last 7 days, today last: plots first submitted that day (as the Progress tab's bars). */
  days: { date: string; submitted: number }[];
  /** Up to WEEK_PEOPLE people with the most plots submitted in those days (at least one). */
  mostActive: { userId: string; username: string; submitted: number }[];
  /** Up to WEEK_PEOPLE people with plots left and the fewest submitted in those days (not among the most active). */
  leastActive: { userId: string; username: string; submitted: number }[];
}

export interface QualityAtHand {
  /** False when no quality figures were at hand (nobody opened the Quality tab since the server started). */
  available: boolean;
  computedAt: number | null;
  stale: boolean;
}

export interface PeopleTable {
  timeZone: string;
  today: string;
  quietDays: number;
  quality: QualityAtHand;
  people: PersonRow[];
  /** Open invitation links: people invited who have not joined. */
  invites: InviteRow[];
  week: WeekSummary;
}

export type PlotStatus = 'submitted' | 'doneByOther' | 'started' | 'notStarted';

export interface PersonFile {
  csvFileId: string;
  filename: string;
  divided: boolean;
  plots: { total: number; submitted: number; doneByOther: number; started: number; notStarted: number };
  checks: { total: number; submitted: number; started: number; notStarted: number };
  /** Their plots and copies in file order, at most MAX_LISTED_PLOTS. */
  list: { plot: string; kind: 'main' | 'check'; status: PlotStatus }[];
  truncated: boolean;
}

export interface Speed {
  /** Submissions with a known time (record events), plots and checks. */
  submissions: number;
  /** Working sessions: runs of submissions less than SESSION_GAP_MS apart. */
  sessions: number;
  /** Gaps between consecutive submissions inside a session. */
  gaps: number;
  medianGapMs: number | null;
  /** Gaps under VERY_FAST_MS. */
  veryFast: number;
  /** Gaps per bin: [previous upToMs, upToMs). */
  buckets: { upToMs: number; count: number }[];
}

export interface SyncHealth {
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  lastCepDownloadAt: number | null;
  syncsCount: number;
  recordsReceived: number;
  cepUpdatedAt: number | null;
  /** The project file was replaced after their last download of it in Collect Earth. */
  oldProjectFile: boolean;
  /** Their Collect Earth, from its last call; null when it never called. */
  collectEarth: { kind: 'collect-earth' | 'old-collect-earth' | 'unknown'; version: string | null } | null;
}

export interface SentBack {
  plot: string;
  comment: string | null;
  decidedAt: number;
  /** Who decided (left out on My work). */
  decidedBy?: string | null;
}

export interface PersonDetail {
  timeZone: string;
  today: string;
  quietDays: number;
  person: PersonRow;
  /** Days with a submission, oldest first: plots and checks first submitted that day. */
  calendar: { date: string; plots: number; checks: number }[];
  /** Plots and checks first submitted in each hour of the day (0-23), in the viewer's time zone. */
  hours: number[];
  files: PersonFile[];
  speed: Speed;
  sync: SyncHealth;
  quality: QualityAtHand & {
    /** Their plots as first assessor compared by a check (on My work: only plots certainly theirs). */
    asFirst: Rate | null;
    /** The plots they checked (not on My work). */
    asChecker?: Rate | null;
    /** Plots of theirs the coordinator asked to look at again (decision "recheck"), newest first. */
    sentBack: SentBack[];
  };
}

export interface PeopleInput extends PlotUnitsInput {
  now: number;
  timeZone: string;
  settings: ProgressSettings;
  members: readonly Member[];
  activity: readonly MemberActivity[];
  invites: readonly InviteSummary[];
  files: readonly CsvFile[];
  cep: CepInfo | null;
  /** The quality figures at hand (QualityService.peek), or null. */
  quality: { report: QualityReport; computedAt: number; stale: boolean } | null;
  decisions: readonly QualityDecision[];
}

const EMPTY_WORK: OperatorWork = {
  mainSubmitted: new Map(),
  mainDrafts: new Set(),
  checkSubmitted: new Map(),
  checkDrafts: new Set(),
  submissionTimes: [],
  groups: new Set(),
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The status chip: no plots, finished, never started, quiet (amber from quietDays, red from twice that) or working. */
export function statusOf(p: {
  now: number;
  quietDays: number;
  holdsPlots: boolean;
  left: boolean;
  sentAnything: boolean;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
}): PersonStatus {
  if (!p.holdsPlots) return { kind: 'noPlots' };
  if (!p.left) return { kind: 'finished' };
  if (p.lastSyncAt === null && p.lastPlotsDownloadAt === null) return { kind: 'neverStarted' };
  if (isQuiet(p.now, p.quietDays, p.lastSyncAt, p.lastPlotsDownloadAt)) {
    const since = p.now - Math.max(p.lastSyncAt ?? -Infinity, p.lastPlotsDownloadAt ?? -Infinity);
    return { kind: 'quiet', days: Math.floor(since / DAY_MS), level: since > 2 * p.quietDays * DAY_MS ? 'red' : 'amber' };
  }
  if (!p.sentAnything) return { kind: 'neverStarted' };
  return { kind: 'working' };
}

/** Gaps between consecutive submissions inside working sessions (under SESSION_GAP_MS): an estimate of the time per plot. */
export function speedOf(times: readonly number[]): Speed {
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  let sessions = sorted.length > 0 ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap < SESSION_GAP_MS) gaps.push(gap);
    else sessions += 1;
  }
  const buckets = SPEED_BUCKETS_MS.map((upToMs) => ({ upToMs, count: 0 }));
  for (const gap of gaps) {
    const bin = buckets.find((b) => gap < b.upToMs);
    if (bin) bin.count += 1;
  }
  return {
    submissions: sorted.length,
    sessions,
    gaps: gaps.length,
    medianGapMs: median(gaps),
    veryFast: gaps.filter((g) => g < VERY_FAST_MS).length,
    buckets,
  };
}

/** The hour of the day in a zone, cached per quarter of an hour (zone offsets are whole quarters). */
function hourInZone(timeZone: string): (ms: number) => number {
  const cache = new Map<number, number>();
  const SLOT = 15 * 60_000;
  return (ms) => {
    const slot = Math.floor(ms / SLOT);
    let hour = cache.get(slot);
    if (hour === undefined) {
      hour = localHour(slot * SLOT, timeZone);
      cache.set(slot, hour);
    }
    return hour;
  };
}

/** What both the table and a person's page work from: the plots resolved once, per person. */
interface Prepared {
  input: PeopleInput;
  units: PlotUnits;
  today: string;
  dayOf: (ms: number) => string;
  weekStart: string;
  activity: Map<string, MemberActivity>;
}

function prepare(input: PeopleInput): Prepared {
  const today = localDate(input.now, input.timeZone);
  return {
    input,
    units: plotUnits(input, true),
    today,
    dayOf: dayInZone(input.timeZone),
    weekStart: addDays(today, -(WEEK_DAYS - 1)),
    activity: new Map(input.activity.map((a) => [a.userId, a])),
  };
}

function rowOf(p: Prepared, m: Member, agreement: Rate | null): PersonRow {
  const { input, units } = p;
  const work = units.byOperator.get(m.username) ?? EMPTY_WORK;
  const held = new Set(units.held.get(m.username) ?? []);
  const copies = new Set(units.copies.get(m.username) ?? []);
  let remaining = 0;
  for (const unit of held) {
    if (!units.firstSubmitted.has(unit)) remaining += 1;
  }
  let checksDone = 0;
  for (const unit of copies) {
    if (work.checkSubmitted.has(unit)) checksDone += 1;
  }
  let started = 0;
  for (const unit of work.mainDrafts) {
    if (!work.mainSubmitted.has(unit)) started += 1;
  }
  const perDay = new Map<string, number>();
  let last7 = 0;
  let lastSubmittedAt: number | null = null;
  for (const at of work.mainSubmitted.values()) {
    const date = p.dayOf(at);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    if (date >= p.weekStart) last7 += 1;
    if (lastSubmittedAt === null || at > lastSubmittedAt) lastSubmittedAt = at;
  }
  for (const at of work.checkSubmitted.values()) {
    if (lastSubmittedAt === null || at > lastSubmittedAt) lastSubmittedAt = at;
  }
  const act = p.activity.get(m.userId);
  const lastSyncAt = act?.lastSyncAt ?? null;
  const lastPlotsDownloadAt = act?.lastPlotsDownloadAt ?? null;
  const checksLeft = copies.size - checksDone;
  const sentAnything = work.mainSubmitted.size + work.mainDrafts.size + work.checkSubmitted.size + work.checkDrafts.size > 0;
  return {
    userId: m.userId,
    username: m.username,
    role: m.role,
    plots: {
      assigned: held.size,
      submitted: work.mainSubmitted.size,
      started,
      remaining,
      done: held.size > 0 ? (held.size - remaining) / held.size : null,
    },
    checks: { assigned: copies.size, submitted: work.checkSubmitted.size, remaining: checksLeft },
    submittedLast7: last7,
    medianPerDay: median([...perDay.values()]),
    lastSyncAt,
    lastPlotsDownloadAt,
    lastSubmittedAt,
    agreement,
    status: statusOf({
      now: input.now,
      quietDays: input.settings.quietDays,
      holdsPlots: held.size > 0 || copies.size > 0,
      left: remaining > 0 || checksLeft > 0,
      sentAnything,
      lastSyncAt,
      lastPlotsDownloadAt,
    }),
  };
}

function qualityAtHand(input: PeopleInput): QualityAtHand {
  return input.quality
    ? { available: true, computedAt: input.quality.computedAt, stale: input.quality.stale }
    : { available: false, computedAt: null, stale: false };
}

const NO_RATE: Rate = { compared: 0, agreeing: 0, rate: null };

/** A coordinator's view of someone's agreement: their checked plots as first assessor. */
function agreementOf(input: PeopleInput, username: string): Rate | null {
  if (!input.quality) return null;
  return input.quality.report.people.find((q) => q.username === username)?.asFirst ?? NO_RATE;
}

const byUsername = (a: { username: string }, b: { username: string }) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);

/** The People tab's table: one row per member, the open invitation links, and the week. */
export function peopleTable(input: PeopleInput): PeopleTable {
  const p = prepare(input);
  const people = [...input.members].sort(byUsername).map((m) => rowOf(p, m, agreementOf(input, m.username)));
  const byDay = new Map<string, number>();
  for (const at of p.units.firstSubmitted.values()) {
    const date = p.dayOf(at);
    if (date >= p.weekStart) byDay.set(date, (byDay.get(date) ?? 0) + 1);
  }
  const brief = (r: PersonRow) => ({ userId: r.userId, username: r.username, submitted: r.submittedLast7 });
  const most = people
    .filter((r) => r.submittedLast7 > 0)
    .sort((a, b) => b.submittedLast7 - a.submittedLast7 || byUsername(a, b))
    .slice(0, WEEK_PEOPLE);
  const named = new Set(most.map((r) => r.userId));
  const least = people
    .filter((r) => !named.has(r.userId) && (r.plots.remaining > 0 || r.checks.remaining > 0))
    .sort((a, b) => a.submittedLast7 - b.submittedLast7 || byUsername(a, b))
    .slice(0, WEEK_PEOPLE);
  return {
    timeZone: input.timeZone,
    today: p.today,
    quietDays: input.settings.quietDays,
    quality: qualityAtHand(input),
    people,
    invites: input.invites.map((i) => ({ id: i.id, role: i.role, usedCount: i.usedCount, maxUses: i.maxUses, expiresAt: i.expiresAt, createdAt: i.createdAt })),
    week: {
      days: dailyOf(byDay, p.today, WEEK_DAYS).map((d) => ({ date: d.date, submitted: d.submitted })),
      mostActive: most.map(brief),
      leastActive: least.map(brief),
    },
  };
}

function filesOf(p: Prepared, username: string, work: OperatorWork): PersonFile[] {
  const { input, units } = p;
  const whole = new Set(input.assignments.filter((a) => a.username === username).map((a) => a.csvFileId));
  const result: PersonFile[] = [];
  for (const file of input.files) {
    const fileUnits = input.fileUnits.get(file.id);
    if (!fileUnits) continue;
    const divided = file.distribution != null;
    if (!divided && !whole.has(file.id)) continue;
    const entry: PersonFile = {
      csvFileId: file.id,
      filename: file.filename,
      divided,
      plots: { total: 0, submitted: 0, doneByOther: 0, started: 0, notStarted: 0 },
      checks: { total: 0, submitted: 0, started: 0, notStarted: 0 },
      list: [],
      truncated: false,
    };
    for (const unit of fileUnits) {
      let kind: 'main' | 'check' | null = null;
      if (!divided) kind = 'main';
      else if (input.mainHolders.get(unit)?.has(username)) kind = 'main';
      else if (input.copyHolders.get(unit)?.has(username)) kind = 'check';
      if (kind === null) continue;
      let status: PlotStatus;
      if (kind === 'main') {
        status = work.mainSubmitted.has(unit)
          ? 'submitted'
          : units.firstSubmitted.has(unit)
            ? 'doneByOther'
            : work.mainDrafts.has(unit)
              ? 'started'
              : 'notStarted';
        entry.plots.total += 1;
        entry.plots[status] += 1;
      } else {
        status = work.checkSubmitted.has(unit) ? 'submitted' : work.checkDrafts.has(unit) ? 'started' : 'notStarted';
        entry.checks.total += 1;
        entry.checks[status as 'submitted' | 'started' | 'notStarted'] += 1;
      }
      if (entry.list.length < MAX_LISTED_PLOTS) entry.list.push({ plot: unit, kind, status });
      else entry.truncated = true;
    }
    if (entry.plots.total + entry.checks.total > 0) result.push(entry);
  }
  return result;
}

/**
 * One person's page, or null when they are not a member. `self`: the person's own "My
 * work" page: their agreement only over plots certainly theirs (as "My quality"), and
 * neither the plots they checked nor who decided.
 */
export function personDetail(input: PeopleInput, userId: string, options: { self: boolean }): PersonDetail | null {
  const member = input.members.find((m) => m.userId === userId);
  if (!member) return null;
  const p = prepare(input);
  const quality = input.quality?.report.people.find((q) => q.username === member.username) ?? null;
  const asFirst = input.quality ? ((options.self ? quality?.personal.asFirst : quality?.asFirst) ?? NO_RATE) : null;
  const person = rowOf(p, member, asFirst);
  const work = p.units.byOperator.get(member.username) ?? EMPTY_WORK;

  const days = new Map<string, { plots: number; checks: number }>();
  const hours = new Array<number>(24).fill(0);
  const hourOf = hourInZone(input.timeZone);
  const count = (at: number, kind: 'plots' | 'checks') => {
    const raw = p.dayOf(at);
    const date = raw > p.today ? p.today : raw;
    const day = days.get(date) ?? { plots: 0, checks: 0 };
    day[kind] += 1;
    days.set(date, day);
    hours[hourOf(at)] += 1;
  };
  for (const at of work.mainSubmitted.values()) count(at, 'plots');
  for (const at of work.checkSubmitted.values()) count(at, 'checks');
  const calendar = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, ...d }));

  const act = p.activity.get(userId);
  const agent = act && act.clientAgent !== null ? parseClientAgent(act.clientAgent) : null;
  const usedCollectEarth = act !== undefined && (act.lastSyncAt !== null || act.lastPlotsDownloadAt !== null || act.lastCepDownloadAt !== null);
  const sync: SyncHealth = {
    lastSeenAt: act?.lastSeenAt ?? null,
    lastSyncAt: act?.lastSyncAt ?? null,
    lastPlotsDownloadAt: act?.lastPlotsDownloadAt ?? null,
    lastCepDownloadAt: act?.lastCepDownloadAt ?? null,
    syncsCount: act?.syncsCount ?? 0,
    recordsReceived: act?.recordsReceived ?? 0,
    cepUpdatedAt: input.cep?.updatedAt ?? null,
    oldProjectFile: input.cep !== null && act?.lastCepDownloadAt != null && act.lastCepDownloadAt < input.cep.updatedAt,
    collectEarth: !usedCollectEarth
      ? null
      : agent === null || agent.kind === 'unknown'
        ? { kind: 'unknown', version: null }
        : agent.kind === 'old-collect-earth'
          ? { kind: 'old-collect-earth', version: null }
          : { kind: 'collect-earth', version: agent.version },
  };

  const sentBack: SentBack[] = input.decisions
    .filter((d) => d.decision === 'recheck' && work.groups.has(d.plot))
    .sort((a, b) => b.decidedAt - a.decidedAt)
    .map((d) => (options.self ? { plot: d.plot, comment: d.comment, decidedAt: d.decidedAt } : { plot: d.plot, comment: d.comment, decidedAt: d.decidedAt, decidedBy: d.decidedBy }));

  return {
    timeZone: input.timeZone,
    today: p.today,
    quietDays: input.settings.quietDays,
    person,
    calendar,
    hours,
    files: filesOf(p, member.username, work),
    speed: speedOf(work.submissionTimes),
    sync,
    quality: {
      ...qualityAtHand(input),
      asFirst,
      ...(options.self ? {} : { asChecker: input.quality ? (quality?.asChecker ?? NO_RATE) : null }),
      sentBack,
    },
  };
}
