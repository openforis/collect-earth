import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { checkMargins, type QualityReport } from '../quality.js';
import { personalReport, teamReport } from '../qualityReports.js';
import { registerPlotPlaceRoutes } from './plotPlaces.js';
import { QualityService, WorkerBusyError, WorkerRestartedError, type ServedReport } from '../qualityService.js';
import type { Store } from '../store/store.js';
import type { DecisionKind, GuidanceNoteInput } from '../types.js';

/** Longest decision comment and guidance note, in characters (the tables check it too). */
export const MAX_TEXT = 2000;
/** Longest plot id, question key or answer a decision or note may name. */
export const MAX_NAME = 1000;
const DECISIONS: readonly DecisionKind[] = ['first', 'check', 'recheck'];

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

/** The plot of a decision route, or null when it is not 1-MAX_NAME characters. */
function plotOf(request: FastifyRequest): string | null {
  const plot = (request.params as { plot: string }).plot;
  return plot && plot.length <= MAX_NAME ? plot : null;
}

/**
 * The overlap report's old shape (the dashboard's Data tab reads it until the Quality
 * tab replaces it), from the quality figures: plots checked, plots differing, and each
 * differing plot once, with the first assessment and every check that differs from it
 * (answers by operator; someone checking their own plot is "name (check)").
 */
function overlapShape(report: QualityReport) {
  const items = new Map<string, { recordKey: string; operators: string[]; fields: Map<string, Record<string, string>> }>();
  for (const d of report.differences) {
    let item = items.get(d.plot);
    if (!item) {
      item = { recordKey: d.plot, operators: [], fields: new Map() };
      items.set(d.plot, item);
    }
    const first = d.first.operator;
    const check = d.check.operator === first ? `${first} (check)` : d.check.operator;
    for (const who of [first, check]) {
      if (!item.operators.includes(who)) {
        item.operators.push(who);
      }
    }
    for (const f of d.fields) {
      let values = item.fields.get(f.key);
      if (!values) {
        values = {};
        item.fields.set(f.key, values);
      }
      values[first] = f.first;
      values[check] = f.check;
    }
  }
  return {
    plots: report.plotsChecked,
    differing: report.plotsDiffering,
    items: [...items.values()].map((item) => ({
      recordKey: item.recordKey,
      operators: item.operators,
      fields: [...item.fields].map(([key, values]) => ({ key, values })),
    })),
  };
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
  const member = { preHandler: requireProjectMembership(store) };
  app.addHook('onClose', async () => {
    await quality.close();
  });
  // Where the differing plots are, for the Quality tab's Google Earth links.
  await registerPlotPlaceRoutes(app, store);

  app.get('/v1/projects/:pid/quality', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [figures, decisions, notes, settings] = await Promise.all([
      served(quality, projectId, request, reply),
      store.listQualityDecisions(projectId),
      store.listGuidanceNotes(projectId),
      store.getQualitySettings(projectId),
    ]);
    if (!figures) {
      return reply;
    }
    return reply.send({ ...figures.report, computedAt: figures.computedAt, stale: figures.stale, decisions, notes, settings });
  });

  // The overlap report of before, kept for the dashboard's Data tab: same shape, now
  // from the quality figures (first assessment against check, by plot unit).
  app.get('/v1/projects/:pid/overlap', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const figures = await served(quality, request.membership!.projectId, request, reply);
    if (!figures) {
      return reply;
    }
    return reply.send(overlapShape(figures.report));
  });

  // A collector's own report (any member signed in as a person; a project token is no
  // one): their checks as first assessor and their mix-ups, never who checked.
  app.get('/v1/projects/:pid/my-quality', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, userId } = request.membership!;
    const user = userId ? await store.getUserById(userId) : null;
    if (!user) {
      return reply.code(403).send({ error: 'forbidden', reason: 'the personal report needs a signed-in person, not a project token' });
    }
    const [figures, notes] = await Promise.all([served(quality, projectId, request, reply), store.listGuidanceNotes(projectId)]);
    if (!figures) {
      return reply;
    }
    return reply.send({ ...personalReport(figures.report, user.username, notes), computedAt: figures.computedAt, stale: figures.stale });
  });

  // The team report for training (admin): mix-ups, examples, notes and agreement, no names.
  app.get('/v1/projects/:pid/quality/team-report', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [figures, notes] = await Promise.all([served(quality, projectId, request, reply), store.listGuidanceNotes(projectId)]);
    if (!figures) {
      return reply;
    }
    return reply.send({ ...teamReport(figures.report, notes), computedAt: figures.computedAt, stale: figures.stale });
  });

  // Number margins (percent, 0-100), only for the number questions of the served survey.
  app.put('/v1/projects/:pid/quality/settings', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { margins?: unknown };
    const checked = checkMargins(body.margins, await quality.outline(projectId, request.log));
    if ('reason' in checked) {
      return reply.code(400).send(bad(checked.reason));
    }
    await store.setQualitySettings(projectId, { margins: checked.margins });
    return reply.send({ margins: checked.margins });
  });

  app.put('/v1/projects/:pid/quality/decisions/:plot', admin, async (request: FastifyRequest, reply: FastifyReply) => {
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
    const decision = await store.setQualityDecision(projectId, plot, body.decision as DecisionKind, comment, request.membership!.userId ?? null);
    return reply.send(decision);
  });

  app.delete('/v1/projects/:pid/quality/decisions/:plot', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const plot = plotOf(request);
    if (plot === null) {
      return reply.code(400).send(bad(`the plot must be 1-${MAX_NAME} characters`));
    }
    const deleted = await store.deleteQualityDecision(request.membership!.projectId, plot);
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
