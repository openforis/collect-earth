import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import {
  attentionKey,
  decodeLogCursor,
  encodeLogCursor,
  idsOfEntry,
  isLogKind,
  kindFilter,
  LOG_PAGE_SIZE,
  LOG_START,
  logPage,
  MAX_LOG_PAGE_SIZE,
  type LogKind,
  type LogRow,
} from '../activityLog.js';
import { isTimeZone, localDate } from '../days.js';
import { DEFAULT_FAST_SECONDS, patternFlags } from '../flags.js';
import { peopleTable } from '../people.js';
import { visibleId } from '../plotShape.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { dayInZone, PACE_DAYS, progressReport, type AttentionItem } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import { pairAt, pairFields, recordResolver } from '../quality.js';
import { answerOptions } from '../qualityReports.js';
import type { QualityService, ServedReport } from '../qualityService.js';
import type { Assessment } from '../rounds.js';
import { InvalidCursorError, type Store } from '../store/store.js';
import type { AuditAction, RecordChange } from '../types.js';
import { isIsoWeek, weekOfDate, weeklySummary } from '../weekly.js';
import { loadPeople } from './people.js';
import type { PlotPlaceReader } from './plotPlaces.js';
import { attentionReader } from './progress.js';
import { MAX_NAME, publicDecision } from './quality.js';

/**
 * The Activity tab, the weekly summary, the downloads and the bell (Task 10, monitoring Phase 6),
 * for coordinators only (reviewers and collectors 403: Decision 3):
 * - `GET /activity?person=&kind=&from=&to=&cursor=&limit=`: the coordinators' actions and what
 *   Collect Earth stored, newest first, one page (activityLog.logPage);
 * - `GET /weekly?week=&tz=`: one ISO week's summary (weekly.ts), from the figures at hand only;
 * - `GET /exports/:kind?tz=`: the rows of a download (people, daily, decisions, differences),
 *   written as CSV in the browser in the person's language; each audited `export.downloaded`;
 * - `GET /attention` and `POST /attention/read`: the bell's "needs attention" items (the Progress
 *   tab's cards) with what this coordinator has read (attention_reads).
 */

export const EXPORT_KINDS = ['people', 'daily', 'decisions', 'differences'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
/** The latest time a log's window may end (the largest time a JS Date holds). */
const END_OF_TIME = 8.64e15;
/** At most this many keys are marked read in one request. */
const MAX_READ_KEYS = 50;

type BadRequest = { error: 'bad_request'; reason: string };
const bad = (reason: string): BadRequest => ({ error: 'bad_request', reason });

/** One row of the log as the dashboard gets it. */
export type LogItem =
  | {
      type: 'record';
      id: string;
      /** When Collect Earth saved it (modifiedOn, the collector's clock). */
      at: number;
      receivedAt: number;
      person: string;
      change: RecordChange;
      /** The plot unit (the plot page's id), or null for a record of a plot in no plot file. */
      plot: string | null;
      /** The plot as the collector sees it (the keys hidden from the record list left out). */
      name: string;
      /** Coordinators see whether it is a first assessment or a check (the log is theirs only). */
      assessment: Assessment;
      round: string;
    }
  | {
      type: 'audit';
      id: string;
      at: number;
      /** Who did it; null for a project key, or someone since removed or whose account is gone. */
      person: string | null;
      action: AuditAction;
      details: Record<string, string | number | boolean | null>;
      /** For a decision: the plot as the collector sees it. */
      plotName?: string;
    };

function timeZoneOf(request: FastifyRequest): string {
  const tz = ((request.query ?? {}) as { tz?: string }).tz;
  return isTimeZone(tz) ? tz : 'UTC';
}

async function peekFigures(quality: QualityService, projectId: string, request: FastifyRequest): Promise<ServedReport | null> {
  try {
    return await quality.peek(projectId, request.log);
  } catch (err) {
    request.log.warn({ err, projectId }, 'activity: the quality figures could not be had');
    return null;
  }
}

export async function registerActivityRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService,
  states: ProjectStateCache,
  places: PlotPlaceReader,
  now: () => number = Date.now,
): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const attentionOf = attentionReader(store, quality);

  // --- the log -----------------------------------------------------------------------------

  app.get('/v1/projects/:pid/activity', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const q = (request.query ?? {}) as Record<string, unknown>;
    const kind: LogKind = q.kind === undefined || q.kind === '' ? 'all' : (q.kind as LogKind);
    if (!isLogKind(kind)) return reply.code(400).send(bad('kind is not one the log knows'));
    const person = q.person === undefined || q.person === '' ? null : q.person;
    if (person !== null && (typeof person !== 'string' || person.length > MAX_NAME)) return reply.code(400).send(bad(`person must be 1-${MAX_NAME} characters`));
    const time = (v: unknown, fallback: number): number | null => {
      if (v === undefined || v === '') return fallback;
      const n = Number(v);
      return typeof v === 'string' && /^-?\d{1,16}$/.test(v) && Number.isSafeInteger(n) ? n : null;
    };
    const from = time(q.from, 0);
    const to = time(q.to, END_OF_TIME);
    if (from === null || to === null) return reply.code(400).send(bad('from and to must be times in ms since 1970'));
    const limit = q.limit === undefined ? LOG_PAGE_SIZE : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_PAGE_SIZE) return reply.code(400).send(bad(`limit must be a whole number from 1 to ${MAX_LOG_PAGE_SIZE}`));
    const cursor = q.cursor === undefined || q.cursor === '' ? LOG_START : decodeLogCursor(q.cursor);
    if (cursor === null) return reply.code(400).send(bad('cursor is not one this log gave'));

    const [members, served, facts, files] = await Promise.all([
      store.listMembers(projectId),
      states.get(projectId, request.log),
      places.surveyFacts(projectId, request.log),
      store.listCsvFiles(projectId),
    ]);
    // The person's records by their username; their actions by their account (someone removed has none left).
    const actor = person === null ? undefined : members.find((m) => m.username === person)?.userId;
    const filter = kindFilter(kind);
    const use = { events: filter.changes !== false, audit: filter.actions !== false && (person === null || actor !== undefined) };
    let page: { rows: LogRow[]; next: typeof cursor | null };
    try {
      page = await logPage(
        {
          events: (before, n) =>
            store.listRecordEvents(projectId, {
              from,
              to,
              limit: n,
              before,
              ...(person !== null ? { operator: person } : {}),
              ...(filter.changes ? { changes: filter.changes } : {}),
            }),
          audit: (before, n) =>
            store.listAudit(projectId, { limit: n, before, from, to, ...(actor !== undefined ? { actor } : {}), ...(filter.actions ? { actions: filter.actions } : {}) }),
        },
        cursor,
        limit,
        use,
      );
    } catch (err) {
      if (err instanceof InvalidCursorError) return reply.code(400).send(bad('cursor is not one this log gave'));
      throw err;
    }

    // Names put to the ids at read time: plots as the collector sees them, people and files as
    // they are called now; someone or a file since removed says so.
    const { context } = served.state;
    const resolve = recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders });
    const hidden = facts.hidden;
    const usernames = new Map(members.map((m) => [m.userId, m.username]));
    const peopleIds = new Set<string>();
    const fileIds = new Set<string>();
    const items: LogItem[] = page.rows.map((row) => {
      if (row.source === 'event') {
        const e = row.event;
        const { unit, round } = resolve(e);
        return {
          type: 'record',
          id: `r${e.id}`,
          at: e.modifiedOn,
          receivedAt: e.receivedAt,
          person: e.operator,
          change: e.change,
          plot: unit,
          name: visibleId(e.recordKey, hidden),
          assessment: round.assessment,
          round: round.round,
        };
      }
      const a = row.entry;
      const ids = idsOfEntry(a);
      for (const id of ids.people) peopleIds.add(id);
      for (const id of ids.files) fileIds.add(id);
      const plot = a.details?.plot;
      return {
        type: 'audit',
        id: `a${a.id}`,
        at: a.at,
        person: a.actor,
        action: a.action,
        details: a.details,
        ...(typeof plot === 'string' ? { plotName: visibleId(plot, hidden) } : {}),
      };
    });
    const people: Record<string, { name: string | null; removed: boolean }> = {};
    await Promise.all(
      [...peopleIds].map(async (id) => {
        const name = usernames.get(id);
        if (name !== undefined) {
          people[id] = { name, removed: false };
          return;
        }
        // Not in the project now: their account's name, or none when the account is gone.
        const user = /^[0-9a-f-]{36}$/i.test(id) ? await store.getUserById(id).catch(() => null) : null;
        people[id] = { name: user?.username ?? null, removed: true };
      }),
    );
    const fileNames = new Map(files.map((f) => [f.id, f.filename]));
    const fileOut: Record<string, string | null> = {};
    for (const id of fileIds) fileOut[id] = fileNames.get(id) ?? null;
    return reply.send({
      items,
      next: page.next ? encodeLogCursor(page.next) : null,
      people,
      files: fileOut,
      persons: members.map((m) => m.username).sort(),
    });
  });

  // --- the weekly summary --------------------------------------------------------------------

  app.get('/v1/projects/:pid/weekly', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const at = now();
    const timeZone = timeZoneOf(request);
    const asked = ((request.query ?? {}) as { week?: unknown }).week;
    if (asked !== undefined && asked !== '' && !isIsoWeek(asked)) return reply.code(400).send(bad('week must be an ISO week written YYYY-Www'));
    const week = typeof asked === 'string' && asked !== '' ? asked : weekOfDate(localDate(at, timeZone));
    const served = await states.get(projectId, request.log);
    const input = await loadPeople(store, quality, served, request, at, { invites: false });
    const figures = input.quality as ServedReport | null;
    const summary = weeklySummary({
      week,
      timeZone,
      now: at,
      units: served.state.units,
      people: peopleTable(input),
      decisions: input.decisions,
      quality: figures,
      flags: null,
    });
    if (figures) {
      // The flags of the week, from the figures at hand (never worked out for this page).
      const dayOf = dayInZone(timeZone);
      const flags = patternFlags(figures, input.decisions, { fastSeconds: input.fastSeconds ?? DEFAULT_FAST_SECONDS, when: (t) => { const d = dayOf(t); return d >= summary.start && d <= summary.end; } });
      summary.quality.flags = { counts: flags.counts, total: flags.total };
    }
    return reply.send({ ...summary, asOf: served.stale ? served.state.builtAt : null });
  });

  // --- downloads -----------------------------------------------------------------------------

  app.get('/v1/projects/:pid/exports/:kind', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const kind = (request.params as { kind: string }).kind as ExportKind;
    if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return reply.code(404).send({ error: 'not_found', reason: `downloads are ${EXPORT_KINDS.join(', ')}` });
    const at = now();
    const timeZone = timeZoneOf(request);
    const served = await states.get(projectId, request.log);
    let body: Record<string, unknown>;
    let rows: number;
    if (kind === 'people') {
      const table = peopleTable(await loadPeople(store, quality, served, request, at, { invites: false }));
      body = { today: table.today, timeZone, rows: table.people };
      rows = table.people.length;
    } else if (kind === 'daily') {
      const list = await dailyRows(store, projectId, served.state.units.byOperator, timeZone);
      body = { today: localDate(at, timeZone), timeZone, rows: list };
      rows = list.length;
    } else if (kind === 'decisions') {
      const [decisions, figures, facts] = await Promise.all([store.listQualityDecisions(projectId), peekFigures(quality, projectId, request), places.surveyFacts(projectId, request.log)]);
      const list = decisions
        .map((d) => {
          const p = publicDecision(d, figures?.flags ?? null);
          return {
            plot: d.plot,
            name: visibleId(d.plot, facts.hidden),
            decision: d.decision,
            comment: d.comment,
            decidedBy: d.decidedBy,
            decidedAt: d.decidedAt,
            // Unknown without the figures at hand.
            byAssessor: figures ? p.byAssessor : null,
            bulk: (d.batch ?? null) !== null,
          };
        })
        .sort((a, b) => b.decidedAt - a.decidedAt || (a.plot < b.plot ? -1 : a.plot > b.plot ? 1 : 0));
      body = { today: localDate(at, timeZone), timeZone, rows: list, figures: figures ? { computedAt: figures.computedAt, stale: figures.stale } : null };
      rows = list.length;
    } else {
      const figures = await peekFigures(quality, projectId, request);
      if (!figures) {
        return reply.code(409).send({ error: 'no_figures', reason: 'The differences come from the quality figures: open the Quality tab first, then download them.' });
      }
      const out = await differenceRows(store, quality, projectId, figures, request, places);
      body = { today: localDate(at, timeZone), timeZone, ...out, figures: { computedAt: figures.computedAt, stale: figures.stale } };
      rows = out.rows.length;
    }
    await audit(store, request, 'export.downloaded', { kind, rows });
    return reply.send({ kind, ...body });
  });

  // --- the bell ------------------------------------------------------------------------------

  async function bell(request: FastifyRequest, add: readonly string[] | 'all' | null) {
    const { projectId, userId } = request.membership!;
    const at = now();
    const [served, settings] = await Promise.all([states.get(projectId, request.log), store.getProgressSettings(projectId)]);
    const { context, assignments, units } = served.state;
    const attention = await attentionOf(projectId, served, request, at);
    const items: AttentionItem[] =
      progressReport({
        now: at,
        timeZone: 'UTC',
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
    const keys = items.map(attentionKey);
    let read = new Set(userId ? await store.listAttentionReads(projectId, userId) : []);
    if (add !== null && userId) {
      const asked = add === 'all' ? keys : add;
      // Only keys of items there now: an item whose content changed is unread again, and its old key goes.
      const next = new Set([...read, ...asked].filter((k) => keys.includes(k)));
      await store.setAttentionReads(projectId, userId, [...next]);
      read = next;
    }
    const list = items.map((item, i) => ({ key: keys[i], read: read.has(keys[i]), item }));
    return { items: list, unread: list.filter((x) => !x.read).length };
  }

  app.get('/v1/projects/:pid/attention', admin, async (request: FastifyRequest, reply: FastifyReply) => reply.send(await bell(request, null)));

  app.post('/v1/projects/:pid/attention/read', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.membership!.userId) return reply.code(403).send({ error: 'forbidden', reason: 'what was read is kept per person: sign in as one' });
    const body = request.body as { keys?: unknown; all?: unknown } | undefined;
    if (body?.all === true) return reply.send(await bell(request, 'all'));
    const keys = body?.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_READ_KEYS || !keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 100)) {
      return reply.code(400).send(bad(`the body must be { keys: [1-${MAX_READ_KEYS} item keys] } or { all: true }`));
    }
    return reply.send(await bell(request, keys as string[]));
  });

}

/** The daily activity download: per local day and person, what Collect Earth stored. */
export interface DailyRow {
  date: string;
  person: string;
  /** Plots (first assessments) first submitted that day, as the Progress tab counts them. */
  plots: number;
  /** Checks first submitted that day. */
  checks: number;
  /** Plots submitted again after being taken back to edit (record events). */
  submittedAgain: number;
  /** Saves not submitted: a draft saved, first or again (record events, autosaves included). */
  drafts: number;
  /** Submitted plots opened again and changed (not submitted now). */
  reopened: number;
  deleted: number;
}

async function dailyRows(store: Store, projectId: string, byOperator: ReadonlyMap<string, { mainSubmitted: ReadonlyMap<string, number>; checkSubmitted: ReadonlyMap<string, number> }>, timeZone: string): Promise<DailyRow[]> {
  const dayOf = dayInZone(timeZone);
  const rows = new Map<string, DailyRow>();
  const rowOf = (date: string, person: string) => {
    const key = `${date}\u0000${person}`;
    let r = rows.get(key);
    if (!r) {
      r = { date, person, plots: 0, checks: 0, submittedAgain: 0, drafts: 0, reopened: 0, deleted: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const [person, work] of byOperator) {
    for (const at of work.mainSubmitted.values()) rowOf(dayOf(at), person).plots += 1;
    for (const at of work.checkSubmitted.values()) rowOf(dayOf(at), person).checks += 1;
  }
  for (const c of await store.recordEventCounts(projectId, { from: 0, to: END_OF_TIME })) {
    const r = rowOf(dayOf(c.at), c.operator);
    if (c.change === 'resubmitted') r.submittedAgain += c.count;
    else if (c.change === 'created' || c.change === 'updated') r.drafts += c.count;
    else if (c.change === 'unsubmitted') r.reopened += c.count;
    else if (c.change === 'deleted') r.deleted += c.count;
  }
  return [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.person < b.person ? -1 : a.person > b.person ? 1 : 0));
}

/** The differences download: one row per question that differs, of every differing pair of the figures at hand. */
async function differenceRows(store: Store, quality: QualityService, projectId: string, figures: ServedReport, request: FastifyRequest, places: PlotPlaceReader) {
  const { report } = figures;
  const [outline, settings, decisions, facts] = await Promise.all([
    quality.outline(projectId, request.log),
    store.getQualitySettings(projectId),
    store.listQualityDecisions(projectId),
    places.surveyFacts(projectId, request.log),
  ]);
  const decided = new Map(decisions.map((d) => [d.plot, d.decision]));
  const id = (recordKey: string, operator: string) => `${recordKey}\u0000${operator}`;
  // The listed differences have their answers; the pairs beyond them are read from the records.
  const listed = new Map(report.differences.map((d) => [`${d.plot}\u0001${id(d.first.recordKey, d.first.operator)}\u0001${id(d.check.recordKey, d.check.operator)}`, d.fields]));
  const pairs = report.pairs;
  let summaries: Map<string, { summary: Record<string, string>; deleted: boolean }> | null = null;
  if (pairs.plot.length > listed.size) {
    summaries = new Map((await store.listRecordSummaries(projectId)).map((r) => [id(r.recordKey, r.operator), r]));
  }
  const rows: { plot: string; name: string; first: string; check: string; latest: boolean; decision: string | null; key: string; firstAnswer: string; checkAnswer: string }[] = [];
  for (let i = 0; i < pairs.plot.length; i++) {
    const p = pairAt(pairs, i);
    let fields = listed.get(`${p.plot}\u0001${id(p.first.recordKey, p.first.operator)}\u0001${id(p.check.recordKey, p.check.operator)}`);
    if (!fields && summaries) {
      const first = summaries.get(id(p.first.recordKey, p.first.operator));
      const check = summaries.get(id(p.check.recordKey, p.check.operator));
      fields = first && check ? pairFields(first.summary, check.summary, outline, settings.margins ?? {}) : [];
    }
    for (const f of fields ?? []) {
      rows.push({
        plot: p.plot,
        name: visibleId(p.plot, facts.hidden),
        first: p.first.operator,
        check: p.check.operator,
        latest: p.latest,
        decision: decided.get(p.plot) ?? null,
        key: f.key,
        firstAnswer: f.first,
        checkAnswer: f.check,
      });
    }
  }
  const keys = new Set(rows.map((r) => r.key));
  const labels: Record<string, string> = {};
  for (const key of keys) labels[key] = outline?.get(key)?.label ?? key;
  return { rows, labels, options: answerOptions(outline, keys) };
}
