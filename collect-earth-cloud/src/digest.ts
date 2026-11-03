// Email digests (Task 19, improvement 16). Once a week, for the accounts that asked on their account
// page (off by default) and whose email is confirmed:
// - coordinators get the weekly summary of each project they coordinate: the plots and checks done in
//   the week and in all (Task 10's figures), the people quiet with plots left to do (where "someone
//   stopped syncing" is told: no mail of its own), the differences waiting for a decision (from the
//   figures at hand only) and a link to the weekly page;
// - collectors get their own week, with My work's numbers (plots and checks alike: nothing tells
//   which of their plots are checks), and the plots sent back to them that are waiting. Never an
//   answer, never anyone else's name.
// The job (POST /v1/internal/digest) works for a bounded time and is resumable: each subscription's
// week is marked done (compare and set) before its mail goes, so a retry or a second run at once
// never sends a week twice; a mail that fails is put back for the next run.
import type { FastifyBaseLogger } from 'fastify';
import { addDays, isTimeZone, localDate } from './days.js';
import { fill, longDate, number, oneLine, renderHtml, renderText, DIGEST_WORDS, type MailLine, type WordKey } from './digestText.js';
import type { Mailer, MailMessage } from './mail.js';
import { writeUnsubscribeToken } from './mailLinks.js';
import { personDetail } from './people.js';
import { PACE_DAYS, progressReport, type AttentionItem } from './progress.js';
import type { ProjectStateCache } from './projectState.js';
import type { QualityService } from './qualityService.js';
import { weeklyOf } from './routes/activity.js';
import { loadPeopleFor } from './routes/people.js';
import { attentionReader } from './routes/progress.js';
import type { Store } from './store/store.js';
import type { DigestKind, DueDigest, MailLanguage, Membership } from './types.js';
import { weekMonday, weekOfDate } from './weekly.js';

/** A mail names at most this many projects (sorted by name); the rest are counted. */
export const MAX_DIGEST_PROJECTS = 20;
/** Subscriptions read from the store at a time. */
const PAGE = 50;
/** Defaults of one run: what Cloud Run's request timeout leaves room for. */
export const DEFAULT_BUDGET_MS = 60_000;
export const DEFAULT_MAX_MAILS = 500;
/** The most a caller may ask for. */
export const MAX_BUDGET_MS = 600_000;

/** The ISO week before `week`. */
export function previousWeek(week: string): string {
  return weekOfDate(addDays(weekMonday(week), -7));
}

/** The week a digest tells about: the last whole ISO week in the person's time zone. */
export function dueWeek(now: number, timeZone: string): string {
  return previousWeek(weekOfDate(localDate(now, timeZone)));
}

export interface CoordinatorProject {
  projectId: string;
  name: string;
  submitted: number;
  checks: number;
  /** Plots done by the end of the week, of all the plots in the plot files. */
  byEnd: number;
  plots: number;
  quiet: { days: number; people: string[] } | null;
  /** Null: the quality figures were not at hand (nobody opened the Quality tab on this instance). */
  differencesWaiting: number | null;
  /** True when the project has quality checks (the checks line is shown). */
  hasChecks: boolean;
}

export interface CollectorProject {
  projectId: string;
  name: string;
  /** Plots (and checks alike, as My work counts them) first submitted in the week. */
  submitted: number;
  /** As My work has them now. */
  submittedAll: number;
  assigned: number;
  remaining: number;
  /** Plots sent back to them for another look, not submitted again yet. */
  sentBack: number;
}

export interface DigestContext {
  serverName: string;
  baseUrl: string;
  language: MailLanguage;
  timeZone: string;
  week: string;
  username: string;
  unsubscribeUrl: string;
}

const wordsOf = (language: MailLanguage) => {
  const words = DIGEST_WORDS[language] ?? DIGEST_WORDS.en;
  return (key: WordKey, params: Record<string, string | number> = {}) => fill(words[key], params);
};

function frame(ctx: DigestContext): { start: string; end: string; w: ReturnType<typeof wordsOf>; params: Record<string, string> } {
  const start = weekMonday(ctx.week);
  const end = addDays(start, 6);
  const params = {
    server: oneLine(ctx.serverName),
    name: oneLine(ctx.username),
    start: longDate(start, ctx.language),
    end: longDate(end, ctx.language),
    zone: ctx.timeZone,
  };
  return { start, end, w: wordsOf(ctx.language), params };
}

function footer(ctx: DigestContext, w: ReturnType<typeof wordsOf>, params: Record<string, string>): MailLine[] {
  return [
    { kind: 'rule' },
    { kind: 'para', text: w('why', params) },
    { kind: 'link', label: w('stop'), url: ctx.unsubscribeUrl },
    { kind: 'link', label: w('account'), url: `${ctx.baseUrl}/account` },
  ];
}

function message(ctx: DigestContext, kind: DigestKind, subject: string, lines: MailLine[], to: string): MailMessage {
  return {
    to,
    subject: oneLine(subject),
    text: renderText(lines, ctx.language),
    html: renderHtml(lines, ctx.language),
    tag: `digest.${kind}`,
    // RFC 2369 and RFC 8058: mail programs show an Unsubscribe button that POSTs to the address.
    headers: {
      'List-Unsubscribe': `<${ctx.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    },
  };
}

/** The coordinators' mail: one section per project they coordinate. */
export function coordinatorMail(ctx: DigestContext, projects: readonly CoordinatorProject[], more: number, to: string): MailMessage {
  const { w, params } = frame(ctx);
  const n = (x: number) => number(x, ctx.language);
  const lines: MailLine[] = [{ kind: 'para', text: w('coordinatorIntro', params) }];
  for (const p of projects) {
    lines.push({ kind: 'heading', text: w('project', { name: oneLine(p.name) }) });
    lines.push({ kind: 'value', label: w('plotsWeek'), value: n(p.submitted) });
    if (p.hasChecks) lines.push({ kind: 'value', label: w('checksWeek'), value: n(p.checks) });
    lines.push({ kind: 'value', label: w('plotsAll'), value: w('ofPlots', { done: n(p.byEnd), plots: n(p.plots) }) });
    if (p.differencesWaiting !== null) lines.push({ kind: 'value', label: w('waiting'), value: n(p.differencesWaiting) });
    if (p.quiet && p.quiet.people.length > 0) {
      lines.push({ kind: 'list', label: w('quiet', { days: p.quiet.days }), items: p.quiet.people.map(oneLine) });
    } else if (p.quiet) {
      lines.push({ kind: 'para', text: w('quietNone', { days: p.quiet.days }) });
    }
    lines.push({ kind: 'link', label: w('weeklyLink'), url: `${ctx.baseUrl}/projects/${encodeURIComponent(p.projectId)}/activity/week/${ctx.week}` });
  }
  if (more > 0) lines.push({ kind: 'para', text: `+${n(more)}` });
  lines.push(...footer(ctx, w, params));
  return message(ctx, 'coordinator', w('coordinatorSubject', params), lines, to);
}

/** A collector's mail: their own week in each project, nothing about anyone else. */
export function collectorMail(ctx: DigestContext, projects: readonly CollectorProject[], more: number, to: string): MailMessage {
  const { w, params } = frame(ctx);
  const n = (x: number) => number(x, ctx.language);
  const lines: MailLine[] = [{ kind: 'para', text: w('collectorIntro', params) }];
  for (const p of projects) {
    lines.push({ kind: 'heading', text: w('project', { name: oneLine(p.name) }) });
    lines.push({ kind: 'value', label: w('mySubmitted'), value: n(p.submitted) });
    lines.push({ kind: 'value', label: w('myAll'), value: n(p.submittedAll) });
    lines.push({ kind: 'value', label: w('myLeft'), value: n(p.remaining) });
    if (p.sentBack > 0) lines.push({ kind: 'value', label: w('sentBack'), value: n(p.sentBack) });
    lines.push({ kind: 'link', label: w('myWorkLink'), url: `${ctx.baseUrl}/projects/${encodeURIComponent(p.projectId)}/my-work` });
  }
  if (more > 0) lines.push({ kind: 'para', text: `+${n(more)}` });
  lines.push(...footer(ctx, w, params));
  return message(ctx, 'collector', w('collectorSubject', params), lines, to);
}

export interface ConfirmContext {
  serverName: string;
  language: MailLanguage;
  username: string;
  confirmUrl: string;
}

/** The mail that confirms an address (sent when someone gives their account an email). */
export function confirmMail(ctx: ConfirmContext, to: string): MailMessage {
  const w = wordsOf(ctx.language);
  const params = { server: oneLine(ctx.serverName), name: oneLine(ctx.username) };
  const lines: MailLine[] = [
    { kind: 'para', text: w('confirmIntro', params) },
    { kind: 'link', label: w('confirmAction'), url: ctx.confirmUrl },
    { kind: 'para', text: w('confirmIgnore') },
  ];
  return { to, subject: oneLine(w('confirmSubject', params)), text: renderText(lines, ctx.language), html: renderHtml(lines, ctx.language), tag: 'email.confirm', headers: { 'Auto-Submitted': 'auto-generated' } };
}

export interface DigestDeps {
  store: Store;
  quality: QualityService;
  states: ProjectStateCache;
  mailer: Mailer;
  secret: Buffer;
  log: FastifyBaseLogger;
  now: () => number;
}

export interface DigestRunResult {
  transport: Mailer['transport'];
  /** The ISO week (UTC) the run was for: each person's week is the last whole one in their zone. */
  week: string;
  /** Mails handed to the transport (the log transport: written to the log, sent to nobody). */
  sent: number;
  /** Weeks with nothing to tell (no project with plots or work), marked done without a mail. */
  empty: number;
  /** Subscriptions left alone: no email, not confirmed, account disabled. */
  skipped: number;
  /** Already done for their week (by an earlier run, or another one at the same time). */
  done: number;
  failed: number;
  /** True when the time or the number of mails ran out before the end: call again. */
  more: boolean;
  ms: number;
}

/** Runs the weekly job over the due subscriptions, within `budgetMs` and `maxMails`. */
export async function runDigests(deps: DigestDeps, options: { baseUrl: string; budgetMs?: number; maxMails?: number }): Promise<DigestRunResult> {
  const started = deps.now();
  const budget = Math.min(options.budgetMs ?? DEFAULT_BUDGET_MS, MAX_BUDGET_MS);
  const maxMails = options.maxMails ?? DEFAULT_MAX_MAILS;
  const utcWeek = dueWeek(started, 'UTC');
  // Anyone's due week is the UTC one or the one before (zones west of UTC end their week later):
  // subscriptions already done for the UTC one are not read at all.
  const result: DigestRunResult = { transport: deps.mailer.transport, week: utcWeek, sent: 0, empty: 0, skipped: 0, done: 0, failed: 0, more: false, ms: 0 };
  const settings = await deps.store.getSettings();
  const serverName = settings.serverName ?? 'Collect Earth Cloud';
  const attentionOf = attentionReader(deps.store, deps.quality);
  let after: { userId: string; kind: DigestKind } | null = null;
  let handled = 0;
  outer: for (;;) {
    const page = await deps.store.listDueDigests({ before: utcWeek, after, limit: PAGE });
    if (page.length === 0) break;
    for (const row of page) {
      if (deps.now() - started >= budget || handled >= maxMails) {
        result.more = true;
        break outer;
      }
      after = { userId: row.userId, kind: row.kind };
      const timeZone = row.timeZone !== null && isTimeZone(row.timeZone) ? row.timeZone : 'UTC';
      const week = dueWeek(deps.now(), timeZone);
      if (row.lastSentWeek !== null && row.lastSentWeek >= week) {
        result.done += 1;
        continue;
      }
      if (row.disabled || row.email === null || !row.emailConfirmed) {
        result.skipped += 1;
        continue;
      }
      handled += 1;
      // A real transport: the week is marked done first, so a second run never sends it again.
      if (deps.mailer.delivers && !(await deps.store.claimDigest(row.userId, row.kind, week, row.lastSentWeek))) {
        result.done += 1;
        continue;
      }
      try {
        const mail = await buildDigest(deps, attentionOf, row, { week, timeZone, serverName, baseUrl: options.baseUrl });
        if (mail === null) {
          result.empty += 1;
          continue;
        }
        await deps.mailer.send(mail);
        if (deps.mailer.delivers) await deps.store.markDigestSent(row.userId, row.kind, deps.now());
        result.sent += 1;
      } catch (err) {
        result.failed += 1;
        if (deps.mailer.delivers) await deps.store.releaseDigest(row.userId, row.kind, week, row.lastSentWeek);
        deps.log.warn({ err: { message: (err as Error).message }, userId: row.userId, kind: row.kind, week }, 'digest: the mail could not be sent; the next run tries again');
      }
    }
    if (page.length < PAGE) break;
  }
  result.ms = deps.now() - started;
  return result;
}

/** One subscription's mail for its week, or null when there is nothing to tell. */
async function buildDigest(
  deps: DigestDeps,
  attentionOf: ReturnType<typeof attentionReader>,
  row: DueDigest,
  at: { week: string; timeZone: string; serverName: string; baseUrl: string },
): Promise<MailMessage | null> {
  const memberships = (await deps.store.listMemberships(row.userId))
    .filter((m) => (row.kind === 'coordinator' ? m.role === 'admin' : m.role !== 'admin'))
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || (a.projectId < b.projectId ? -1 : 1));
  const ctx: DigestContext = {
    serverName: at.serverName,
    baseUrl: at.baseUrl,
    language: row.language ?? 'en',
    timeZone: at.timeZone,
    week: at.week,
    username: row.username,
    unsubscribeUrl: `${at.baseUrl}/v1/unsubscribe/${writeUnsubscribeToken(row.userId, row.kind, deps.secret)}`,
  };
  const now = deps.now();
  if (row.kind === 'coordinator') {
    const projects: CoordinatorProject[] = [];
    for (const m of memberships) {
      const p = await coordinatorProject(deps, attentionOf, m, at.week, at.timeZone, now);
      if (p.plots > 0 || p.submitted > 0 || p.checks > 0) projects.push(p);
    }
    if (projects.length === 0) return null;
    return coordinatorMail(ctx, projects.slice(0, MAX_DIGEST_PROJECTS), Math.max(0, projects.length - MAX_DIGEST_PROJECTS), row.email!);
  }
  const projects: CollectorProject[] = [];
  for (const m of memberships) {
    const p = await collectorProject(deps, m, row.userId, at.week, at.timeZone, now);
    if (p && (p.assigned > 0 || p.submitted > 0 || p.sentBack > 0)) projects.push(p);
  }
  if (projects.length === 0) return null;
  return collectorMail(ctx, projects.slice(0, MAX_DIGEST_PROJECTS), Math.max(0, projects.length - MAX_DIGEST_PROJECTS), row.email!);
}

async function coordinatorProject(
  deps: DigestDeps,
  attentionOf: ReturnType<typeof attentionReader>,
  m: Membership,
  week: string,
  timeZone: string,
  now: number,
): Promise<CoordinatorProject> {
  const { store, quality, states, log } = deps;
  const served = await states.get(m.projectId, log);
  const summary = await weeklyOf(store, quality, served, { projectId: m.projectId, timeZone, log }, week, now);
  const [attention, settings] = await Promise.all([attentionOf(m.projectId, served, { log }, now), store.getProgressSettings(m.projectId)]);
  const { context, assignments, units } = served.state;
  const items: AttentionItem[] =
    progressReport({
      now,
      timeZone,
      days: PACE_DAYS,
      records: [],
      prepared: units,
      info: context.info,
      units: context.units,
      copyHolders: context.copyHolders,
      mainHolders: context.mainHolders,
      fileUnits: context.fileUnits,
      assignments,
      settings,
      attention,
    }).attention ?? [];
  const quiet = items.find((i): i is Extract<AttentionItem, { kind: 'quiet' }> => i.kind === 'quiet');
  return {
    projectId: m.projectId,
    name: m.projectName,
    submitted: summary.progress.submitted,
    checks: summary.progress.checks,
    byEnd: summary.progress.byEnd,
    plots: summary.progress.totals.plots,
    quiet: { days: quiet?.quietDays ?? settings.quietDays, people: (quiet?.people ?? []).map((p) => p.username).sort() },
    differencesWaiting: attention.differencesWaiting,
    hasChecks: context.copyHolders.size > 0 || summary.progress.checks > 0,
  };
}

async function collectorProject(deps: DigestDeps, m: Membership, userId: string, week: string, timeZone: string, now: number): Promise<CollectorProject | null> {
  const { store, quality, states, log } = deps;
  const served = await states.get(m.projectId, log);
  const input = await loadPeopleFor(store, quality, served, { projectId: m.projectId, timeZone, log }, now, { activityOf: userId, invites: false, sentBackOf: userId });
  // My work's own figures (self: true): copies counted as plots, no check named.
  const detail = personDetail(input, userId, { self: true });
  if (!detail) return null;
  const start = weekMonday(week);
  const end = addDays(start, 6);
  return {
    projectId: m.projectId,
    name: m.projectName,
    submitted: detail.calendar.filter((d) => d.date >= start && d.date <= end).reduce((sum, d) => sum + d.plots, 0),
    submittedAll: detail.person.plots.submitted,
    assigned: detail.person.plots.assigned,
    remaining: detail.person.plots.remaining,
    sentBack: detail.quality.sentBack.filter((s) => !s.submittedAgain).length,
  };
}
