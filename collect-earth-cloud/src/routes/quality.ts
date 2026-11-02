import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit } from '../activity.js';
import { answerStats, type AnswerFilter } from '../answerStats.js';
import { isDate, isTimeZone } from '../days.js';
import { FLAG_KINDS, fastSecondsOf, MAX_FAST_SECONDS, MIN_FAST_SECONDS, patternFlags, resubmittedAfterRecheck, seenOf, type DecisionSeen, type FlagKind } from '../flags.js';
import { columnValues, MAX_LISTED_VALUES, plotColumns, plotsWithValue } from '../plotColumns.js';
import { plotFileOf, plotIdsOf } from '../plotFileCache.js';
import { fileKeyCount } from '../rounds.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { checkMargins, pairFields, type Difference, type DifferingPairRef } from '../quality.js';
import { answerOptions, personalReport, teamReport } from '../qualityReports.js';
import { registerPlotPlaceRoutes } from './plotPlaces.js';
import { BULK_RULES, bulkPlots, QUEUE_KINDS, reviewQueue, type BulkRule, type QueueKind } from '../reviewQueue.js';
import { surveyHealth } from '../surveyHealth.js';
import { MAX_CACHED_ANSWER_FILTERS, QualityService, remember, WorkerBusyError, WorkerRestartedError, type ServedReport } from '../qualityService.js';
import type { Store } from '../store/store.js';
import type { DecisionKind, GuidanceNoteInput, QualityDecision, QualitySettings } from '../types.js';

/** Longest decision comment and guidance note, in characters (the tables check it too). */
export const MAX_TEXT = 2000;
/** Longest plot id, question key or answer a decision or note may name. */
export const MAX_NAME = 1000;
const DECISIONS: readonly DecisionKind[] = ['first', 'check', 'recheck'];
/** Plots of the review queue in one answer (the next ones with ?offset=). */
export const MAX_QUEUE_ITEMS = 100;
/** Plots a bulk decision names in its answer (the count is of all). */
export const MAX_BULK_LISTED = 20;

/** A differing pair's identity: its plot and its two records. */
const pairId = (p: Pick<DifferingPairRef, 'plot' | 'first' | 'check'>) =>
  `${p.plot}\u0000${p.first.operator}\u0000${p.first.recordKey}\u0000${p.check.operator}\u0000${p.check.recordKey}`;

type BadRequest = { error: 'bad_request'; reason: string };
const bad = (reason: string): BadRequest => ({ error: 'bad_request', reason });

/** A note's body, or why it is refused. */
function noteInput(body: unknown): GuidanceNoteInput | BadRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const questionKey = typeof b.questionKey === 'string' ? b.questionKey.trim() : '';
  if (!questionKey || questionKey.length > MAX_NAME) {
    return bad(`questionKey must be 1-${MAX_NAME} characters`);
  }
  const value = (name: 'firstValue' | 'checkValue'): string | null | BadRequest => {
    const v = b[name];
    if (v === undefined || v === null || v === '') {
      return null;
    }
    return typeof v === 'string' && v.length <= MAX_NAME ? v : bad(`${name} must be text of at most ${MAX_NAME} characters, or null`);
  };
  const firstValue = value('firstValue');
  const checkValue = value('checkValue');
  for (const v of [firstValue, checkValue]) {
    if (v !== null && typeof v === 'object') {
      return v;
    }
  }
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text || text.length > MAX_TEXT) {
    return bad(`text must be 1-${MAX_TEXT} characters`);
  }
  return { questionKey, firstValue: firstValue as string | null, checkValue: checkValue as string | null, text };
}

/** A decision as clients get it: without what it saw of the records (only the flags read that). */
function publicDecision(d: QualityDecision): Omit<QualityDecision, 'seen'> {
  const { seen: _seen, ...rest } = d;
  return rest;
}

/** The plot of a decision route, or null when it is not 1-MAX_NAME characters. */
function plotOf(request: FastifyRequest): string | null {
  const plot = (request.params as { plot: string }).plot;
  return plot && plot.length <= MAX_NAME ? plot : null;
}

/** What a client is told when the figures fail: the details (a stack, a query) are only logged. */
export const QUALITY_FAILED = {
  error: 'quality_failed',
  reason: 'The quality figures could not be worked out. Try again in a few minutes.',
} as const;

/**
 * The figures; or a 503 when the worker already has as many jobs as it takes, or was
 * restarted under this job because of another; or a 500 with a plain message when
 * they failed (logged with the details).
 */
async function served(quality: QualityService, projectId: string, request: FastifyRequest, reply: FastifyReply): Promise<ServedReport | null> {
  try {
    return await quality.report(projectId, request.log);
  } catch (err) {
    if (err instanceof WorkerBusyError || err instanceof WorkerRestartedError) {
      void reply.code(503).header('retry-after', '10').send({ error: 'busy', reason: 'the quality figures of other projects are being computed; try again in a moment' });
      return null;
    }
    request.log.error({ err, projectId }, 'quality: the figures could not be worked out');
    void reply.code(500).send(QUALITY_FAILED);
    return null;
  }
}

/**
 * The Quality tab's routes (admin): the figures with the decisions and notes, the
 * number margins, a decision per differing plot, and guidance notes. Decisions are kept
 * by plot unit, as the figures pair records (Difference.plot); "recheck" is only
 * recorded for now (sending the plot back waits on the monitoring plan).
 */
export async function registerQualityRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService = new QualityService(store),
): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const member = { preHandler: requireProjectMembership(store) };
  app.addHook('onClose', async () => {
    await quality.close();
  });
  // Where the differing plots are, for the Quality tab's Google Earth links.
  await registerPlotPlaceRoutes(app, store);

  app.get('/v1/projects/:pid/quality', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [figures, decisions, notes, settings, outline] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listQualityDecisions(projectId),
      store.listGuidanceNotes(projectId),
      store.getQualitySettings(projectId),
      quality.outline(projectId, request.log),
    ]);
    if (!figures) {
      return reply;
    }
    // The answer options of the questions shown, so the tab shows "Forest", not "F".
    const options = answerOptions(outline, [...figures.report.questions.map((q) => q.key), ...notes.map((n) => n.questionKey)]);
    // Every differing pair is for the review queue and the bulk decisions only.
    const { pairs: _pairs, ...report } = figures.report;
    return reply.send({ ...report, computedAt: figures.computedAt, stale: figures.stale, decisions: decisions.map(publicDecision), notes, settings, options });
  });

  // Answers per person (Task 4), for coordinators and reviewers (never collectors, never
  // My work): the first assessments' answers by question, for the team and each person,
  // with the shares far from the rest of the team. Filters: person, file (a plot file),
  // column + value (the plots with that value in a column of that file), from / to
  // (days, in tz, of when the plot was last saved). The answer table comes with the
  // quality figures (same worker job, same cache and version, stale while refreshed);
  // the figures for a filter are worked out here from it and kept for a few filters.
  app.get('/v1/projects/:pid/quality/answers', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const q = (request.query ?? {}) as Record<string, unknown>;
    const text = (name: string): string | null => (typeof q[name] === 'string' && q[name] !== '' ? (q[name] as string) : null);
    const person = text('person');
    const fileId = text('file');
    const columnText = text('column');
    const value = typeof q.value === 'string' ? q.value : null;
    const from = text('from');
    const to = text('to');
    const timeZone = isTimeZone(q.tz) ? q.tz : 'UTC';
    if (person !== null && person.length > MAX_NAME) return reply.code(400).send(bad(`person must be at most ${MAX_NAME} characters`));
    if ((from !== null && !isDate(from)) || (to !== null && !isDate(to))) return reply.code(400).send(bad('from and to must be days written YYYY-MM-DD'));
    if (from !== null && to !== null && from > to) return reply.code(400).send(bad('from must not be after to'));
    if ((columnText !== null) !== (value !== null)) return reply.code(400).send(bad('column and value go together'));
    if (columnText !== null && fileId === null) return reply.code(400).send(bad('a column needs its plot file (file)'));
    if (value !== null && value.length > MAX_NAME) return reply.code(400).send(bad(`value must be at most ${MAX_NAME} characters`));
    const [files, info] = await Promise.all([store.listCsvFiles(projectId), store.getRoundInfo(projectId)]);
    let units: Set<string> | null = null;
    let column: number | null = null;
    if (fileId !== null) {
      const meta = isUuid(fileId) ? files.find((f) => f.id === fileId) : undefined;
      const file = meta ? await store.getCsvFile(projectId, meta.id) : null;
      if (!file) return reply.code(400).send(bad('no such plot file in this project'));
      const keyCount = fileKeyCount(info);
      if (columnText === null) {
        units = new Set(plotIdsOf(file, keyCount));
      } else {
        const plotFile = plotFileOf(file, keyCount);
        column = /^\d{1,4}$/.test(columnText) ? Number(columnText) : -1;
        // The id column (0) gives every plot its own value: no filter.
        if (column < 1 || column >= plotFile.columnCount) return reply.code(400).send(bad(`column must be a column of the plot file, 1 to ${plotFile.columnCount - 1}`));
        // As for dividing a file: a column of over MAX_LISTED_VALUES values is not offered, nor taken.
        const distinct = new Set(columnValues(plotFile, column)).size;
        if (distinct > MAX_LISTED_VALUES) return reply.code(400).send(bad(`that column has over ${MAX_LISTED_VALUES} different values`));
        units = plotsWithValue(plotFile, column, value!);
      }
    }
    const figures = await served(quality, projectId, request, reply);
    if (!figures) {
      return reply;
    }
    const key = JSON.stringify([person, fileId, column, value, from, to, from !== null || to !== null ? timeZone : null]);
    let stats = figures.answerStats.get(key);
    if (!stats) {
      const filter: AnswerFilter = { person, units, from, to, timeZone };
      stats = answerStats(figures.answers, filter);
    }
    remember(figures.answerStats, key, stats, MAX_CACHED_ANSWER_FILTERS);
    return reply.send({
      ...stats,
      computedAt: figures.computedAt,
      stale: figures.stale,
      timeZone,
      filters: {
        people: [...figures.answers.operators].sort(),
        files: files.map((f) => ({ id: f.id, filename: f.filename })).sort((a, b) => a.filename.localeCompare(b.filename)),
      },
    });
  });

  // Pattern flags (Task 5), for coordinators and reviewers (never collectors, never My
  // work): plots worth a look, found without any check. Worked out from the figures of the
  // quality worker (same job, cache and version, stale while refreshed) with the decisions
  // and the threshold as they are now. Filters: person (a username), kind.
  app.get('/v1/projects/:pid/quality/flags', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const q = (request.query ?? {}) as Record<string, unknown>;
    const person = typeof q.person === 'string' && q.person !== '' ? q.person : null;
    const kind = typeof q.kind === 'string' && q.kind !== '' ? q.kind : null;
    if (person !== null && person.length > MAX_NAME) return reply.code(400).send(bad(`person must be at most ${MAX_NAME} characters`));
    if (kind !== null && !(FLAG_KINDS as readonly string[]).includes(kind)) return reply.code(400).send(bad(`kind must be one of ${FLAG_KINDS.join(', ')}`));
    const [figures, decisions, settings] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listQualityDecisions(projectId),
      store.getQualitySettings(projectId),
    ]);
    if (!figures) {
      return reply;
    }
    const flags = patternFlags(figures, decisions, { fastSeconds: fastSecondsOf(settings), person, kind: kind as FlagKind | null });
    return reply.send({ ...flags, computedAt: figures.computedAt, stale: figures.stale });
  });

  // Survey health (Task 6), for coordinators and reviewers (never collectors): per question,
  // how often the first assessments leave it empty or answer "other", how far the checks
  // agree, and how often a decision for the check changed it; the questions worth
  // rewording first. From the quality worker's figures (same job, cache and version) with
  // the decisions as they are now.
  app.get('/v1/projects/:pid/quality/survey-health', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [figures, decisions] = await Promise.all([served(quality, projectId, request, reply), store.listQualityDecisions(projectId)]);
    if (!figures) {
      return reply;
    }
    return reply.send({ ...surveyHealth(figures, decisions), computedAt: figures.computedAt, stale: figures.stale });
  });

  // The review queue (Task 7), for coordinators and reviewers (never collectors): differences
  // without a decision, then plots with flags, then plots submitted again after "both need
  // another look", each plot once with what is known of it. Filters: person (anyone whose
  // record is shown), kind (a part or a kind of flag); offset for the next plots. A plot
  // beyond the report's listed differences has its two records read here for its answers.
  app.get('/v1/projects/:pid/quality/queue', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const q = (request.query ?? {}) as Record<string, unknown>;
    const person = typeof q.person === 'string' && q.person !== '' ? q.person : null;
    const kind = typeof q.kind === 'string' && q.kind !== '' ? q.kind : null;
    const offsetText = typeof q.offset === 'string' && q.offset !== '' ? q.offset : '0';
    if (person !== null && person.length > MAX_NAME) return reply.code(400).send(bad(`person must be at most ${MAX_NAME} characters`));
    if (kind !== null && !(QUEUE_KINDS as readonly string[]).includes(kind)) return reply.code(400).send(bad(`kind must be one of ${QUEUE_KINDS.join(', ')}`));
    if (!/^\d{1,7}$/.test(offsetText)) return reply.code(400).send(bad('offset must be a whole number of plots'));
    const offset = Number(offsetText);
    const [figures, decisions, settings, outline] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listQualityDecisions(projectId),
      store.getQualitySettings(projectId),
      quality.outline(projectId, request.log),
    ]);
    if (!figures) {
      return reply;
    }
    const flagKind = kind !== null && (FLAG_KINDS as readonly string[]).includes(kind) ? (kind as FlagKind) : null;
    const flags = patternFlags(figures, decisions, { fastSeconds: fastSecondsOf(settings), person, kind: flagKind });
    const queue = reviewQueue(
      {
        pairs: figures.report.pairs,
        flags: flags.flags,
        resubmitted: resubmittedAfterRecheck(figures.flags, decisions),
        decided: new Map(decisions.map((d) => [d.plot, d.decision])),
      },
      { person, kind: kind as QueueKind | null },
    );
    const page = queue.items.slice(offset, offset + MAX_QUEUE_ITEMS);
    // The answers of each pair shown: the report's listed difference, else its two records as they are now.
    const listed = new Map(figures.report.differences.map((d) => [pairId(d), d]));
    const margins = settings.margins ?? {};
    const toRead = page.flatMap((item) => item.pairs).filter((p) => !listed.has(pairId(p)));
    const read = await Promise.all(
      toRead.map(async (p): Promise<Difference> => {
        const [first, check] = await Promise.all([store.getRecord(projectId, p.first.recordKey, p.first.operator), store.getRecord(projectId, p.check.recordKey, p.check.operator)]);
        const fields = first && check && !first.deleted && !check.deleted ? pairFields(first.summary, check.summary, outline, margins) : [];
        return { plot: p.plot, first: p.first, check: p.check, fields };
      }),
    );
    for (const d of read) listed.set(pairId(d), d);
    const byPlot = new Map(decisions.map((d) => [d.plot, d]));
    const items = page.map((item) => {
      const decision = byPlot.get(item.plot);
      return {
        plot: item.plot,
        section: item.section,
        people: item.people,
        differences: item.pairs.map((p) => listed.get(pairId(p))!),
        flags: item.flags,
        resubmitted: item.resubmitted,
        decision: decision ? publicDecision(decision) : null,
      };
    });
    // The questions shown, by their labels and answer options ("Forest", not "F").
    const keys = new Set(items.flatMap((i) => i.differences.flatMap((d) => d.fields.map((f) => f.key))));
    const known = new Map(figures.report.questions.map((x) => [x.key, x.label]));
    const labels: Record<string, string> = {};
    for (const key of keys) labels[key] = outline?.get(key)?.label ?? known.get(key) ?? key;
    return reply.send({
      items,
      offset,
      total: queue.items.length,
      counts: queue.counts,
      people: queue.people,
      // The flags looked at are the newest MAX_LISTED_FLAGS of those matching the filters.
      flagsCapped: flags.total > flags.flags.length,
      labels,
      options: answerOptions(outline, keys),
      computedAt: figures.computedAt,
      stale: figures.stale,
    });
  });

  // Bulk decisions (Task 7, coordinators): every differing plot without a decision where
  // the first assessment (first_by_reviewer) or the latest check (check_by_reviewer) is a
  // reviewer's or a coordinator's, and the other side is not (bulkPlots). ?dryRun=1 only
  // counts them (the confirmation's number). In one transaction; a plot decided meanwhile
  // keeps its decision. Each keeps what it saw of the plot's records, as a single decision.
  app.post('/v1/projects/:pid/quality/decisions:bulk', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const rule = ((request.body ?? {}) as { rule?: unknown }).rule;
    if (typeof rule !== 'string' || !(BULK_RULES as readonly string[]).includes(rule)) {
      return reply.code(400).send(bad(`rule must be one of ${BULK_RULES.join(', ')}`));
    }
    const dryRunText = (request.query as { dryRun?: unknown } | undefined)?.dryRun;
    const dryRun = dryRunText === '1' || dryRunText === 'true';
    const [figures, decisions, members] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listQualityDecisions(projectId),
      store.listMembers(projectId),
    ]);
    if (!figures) {
      return reply;
    }
    const trusted = new Set(members.filter((m) => m.role === 'reviewer' || m.role === 'admin').map((m) => m.username));
    const plots = bulkPlots(figures.report.pairs, new Map(decisions.map((d) => [d.plot, d.decision])), trusted, rule as BulkRule);
    const decision: DecisionKind = rule === 'first_by_reviewer' ? 'first' : 'check';
    if (dryRun) {
      return reply.send({ rule, decision, count: plots.length, plots: plots.slice(0, MAX_BULK_LISTED).map((p) => p.plot), dryRun: true });
    }
    const added = await store.addQualityDecisions(
      projectId,
      plots.map((p) => ({ plot: p.plot, decision: p.decision, seen: seenOf(figures.flags, p.plot) })),
      null,
      request.membership!.userId ?? null,
    );
    if (added.length > 0) {
      await audit(store, request, 'decision.bulk', { rule, decision, count: added.length });
    }
    return reply.send({ rule, decision, count: added.length, plots: added.slice(0, MAX_BULK_LISTED), dryRun: false });
  });

  // The columns of a plot file and their values, to filter the answers by one (reviewers too).
  app.get('/v1/projects/:pid/quality/answers/columns', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const id = (request.query as { file?: unknown } | undefined)?.file;
    const file = typeof id === 'string' && isUuid(id) ? await store.getCsvFile(projectId, id) : null;
    if (!file) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const plotFile = plotFileOf(file, fileKeyCount(await store.getRoundInfo(projectId)));
    return reply.send({ hasHeader: plotFile.header !== null, columns: plotColumns(plotFile).filter((c) => c.index > 0) });
  });

  // A collector's own report (any member signed in as a person; a project token is no
  // one): their checks as first assessor and their mix-ups, never who checked.
  app.get('/v1/projects/:pid/my-quality', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, userId } = request.membership!;
    const user = userId ? await store.getUserById(userId) : null;
    if (!user) {
      return reply.code(403).send({ error: 'forbidden', reason: 'the personal report needs a signed-in person, not a project token' });
    }
    const [figures, notes, outline] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listGuidanceNotes(projectId),
      quality.outline(projectId, request.log),
    ]);
    if (!figures) {
      return reply;
    }
    return reply.send({ ...personalReport(figures.report, user.username, notes, outline), computedAt: figures.computedAt, stale: figures.stale });
  });

  // The team report for training (admin): mix-ups, examples, notes and agreement, no names.
  app.get('/v1/projects/:pid/quality/team-report', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [figures, notes, outline] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listGuidanceNotes(projectId),
      quality.outline(projectId, request.log),
    ]);
    if (!figures) {
      return reply;
    }
    return reply.send({ ...teamReport(figures.report, notes, outline), computedAt: figures.computedAt, stale: figures.stale });
  });

  // Number margins (percent, 0-100), only for the number questions of the served survey,
  // and the "very fast" flag's threshold (whole seconds, MIN_FAST_SECONDS-MAX_FAST_SECONDS).
  // Either may be left out: the one left out stays as it is.
  app.put('/v1/projects/:pid/quality/settings', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { margins?: unknown; fastSeconds?: unknown };
    if (typeof body !== 'object' || Array.isArray(body) || (body.margins === undefined && body.fastSeconds === undefined)) {
      return reply.code(400).send(bad('send margins, fastSeconds or both'));
    }
    const patch: Partial<QualitySettings> = {};
    if (body.margins !== undefined) {
      const checked = checkMargins(body.margins, await quality.outline(projectId, request.log));
      if ('reason' in checked) {
        return reply.code(400).send(bad(checked.reason));
      }
      patch.margins = checked.margins;
    }
    if (body.fastSeconds !== undefined) {
      const f = body.fastSeconds;
      if (typeof f !== 'number' || !Number.isInteger(f) || f < MIN_FAST_SECONDS || f > MAX_FAST_SECONDS) {
        return reply.code(400).send(bad(`fastSeconds must be whole seconds from ${MIN_FAST_SECONDS} to ${MAX_FAST_SECONDS}`));
      }
      patch.fastSeconds = f;
    }
    // One write that keeps what is not sent: a margins save and a threshold save at the same time both stay.
    const saved = await store.patchQualitySettings(projectId, patch);
    await audit(store, request, 'settings.changed', { setting: 'quality' });
    return reply.send(saved);
  });

  // Decisions: coordinators and reviewers (they work the review queue, Decision 3); audited with who.
  app.put('/v1/projects/:pid/quality/decisions/:plot', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const plot = plotOf(request);
    if (plot === null) {
      return reply.code(400).send(bad(`the plot must be 1-${MAX_NAME} characters`));
    }
    const body = (request.body ?? {}) as { decision?: unknown; comment?: unknown };
    if (!DECISIONS.includes(body.decision as DecisionKind)) {
      return reply.code(400).send(bad(`decision must be one of ${DECISIONS.join(', ')}`));
    }
    let comment: string | null = null;
    if (body.comment !== undefined && body.comment !== null) {
      if (typeof body.comment !== 'string' || body.comment.trim().length > MAX_TEXT) {
        return reply.code(400).send(bad(`comment must be text of at most ${MAX_TEXT} characters`));
      }
      comment = body.comment.trim() || null;
    }
    // What the coordinator or reviewer decided on: the plot's records as the figures at hand show them
    // (never computed here), for "saved again after a decision" (pattern flags).
    let seen: DecisionSeen[] | null = null;
    try {
      const figures = await quality.peek(projectId, request.log);
      seen = figures ? seenOf(figures.flags, plot) : null;
    } catch (err) {
      request.log.warn({ err, projectId }, 'quality: the figures at hand could not be read for a decision');
    }
    const decision = await store.setQualityDecision(projectId, plot, body.decision as DecisionKind, comment, request.membership!.userId ?? null, seen);
    await audit(store, request, 'decision.set', { plot, decision: decision.decision });
    return reply.send(publicDecision(decision));
  });

  app.delete('/v1/projects/:pid/quality/decisions/:plot', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const plot = plotOf(request);
    if (plot === null) {
      return reply.code(400).send(bad(`the plot must be 1-${MAX_NAME} characters`));
    }
    const deleted = await store.deleteQualityDecision(request.membership!.projectId, plot);
    if (deleted) {
      await audit(store, request, 'decision.deleted', { plot });
    }
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/v1/projects/:pid/quality/notes', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ notes: await store.listGuidanceNotes(request.membership!.projectId) });
  });

  app.post('/v1/projects/:pid/quality/notes', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const input = noteInput(request.body);
    if ('error' in input) {
      return reply.code(400).send(input);
    }
    const note = await store.createGuidanceNote(request.membership!.projectId, input, request.membership!.userId ?? null);
    return reply.code(201).send(note);
  });

  app.put('/v1/projects/:pid/quality/notes/:id', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const input = noteInput(request.body);
    if ('error' in input) {
      return reply.code(400).send(input);
    }
    const id = (request.params as { id: string }).id;
    const note = await store.updateGuidanceNote(request.membership!.projectId, id, input, request.membership!.userId ?? null);
    return note ? reply.send(note) : reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/v1/projects/:pid/quality/notes/:id', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const deleted = await store.deleteGuidanceNote(request.membership!.projectId, id);
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });
}
