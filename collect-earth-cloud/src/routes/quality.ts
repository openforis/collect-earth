import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { QualityReport } from '../quality.js';
import { QualityService } from '../qualityService.js';
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

/**
 * The overlap report's old shape (the dashboard's Data tab reads it until the Quality
 * tab replaces it), from the quality figures: plots checked, plots differing, and each
 * differing pair with both answers by operator.
 */
function overlapShape(report: QualityReport) {
  return {
    plots: report.plotsChecked,
    differing: report.plotsDiffering,
    items: report.differences.map((d) => {
      const first = d.first.operator;
      const check = d.check.operator === first ? `${first} (check)` : d.check.operator;
      return {
        recordKey: d.plot,
        operators: [first, check],
        fields: d.fields.map((f) => ({ key: f.key, values: { [first]: f.first, [check]: f.check } })),
      };
    }),
  };
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
  app.addHook('onClose', async () => {
    await quality.close();
  });

  app.get('/v1/projects/:pid/quality', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [report, decisions, notes, settings] = await Promise.all([
      quality.report(projectId, request.log),
      store.listQualityDecisions(projectId),
      store.listGuidanceNotes(projectId),
      store.getQualitySettings(projectId),
    ]);
    return reply.send({ ...report, decisions, notes, settings });
  });

  // The overlap report of before, kept for the dashboard's Data tab: same shape, now
  // from the quality figures (first assessment against check, by plot unit).
  app.get('/v1/projects/:pid/overlap', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(overlapShape(await quality.report(request.membership!.projectId, request.log)));
  });

  // Number margins (percent, 0-100), only for the number questions of the served survey.
  app.put('/v1/projects/:pid/quality/settings', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { margins?: unknown };
    const margins = body.margins;
    if (!margins || typeof margins !== 'object' || Array.isArray(margins)) {
      return reply.code(400).send(bad('margins must be an object of question key to percent'));
    }
    const outline = await quality.outline(projectId, request.log);
    const numbers = new Set([...(outline?.values() ?? [])].filter((q) => q.kind === 'number' && !q.excluded).map((q) => q.key));
    const clean: Record<string, number> = {};
    for (const [key, value] of Object.entries(margins as Record<string, unknown>)) {
      if (!numbers.has(key)) {
        return reply.code(400).send(bad(`${key} is not a number question of the survey`));
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        return reply.code(400).send(bad(`the margin of ${key} must be a number from 0 to 100`));
      }
      clean[key] = value;
    }
    await store.setQualitySettings(projectId, { margins: clean });
    return reply.send({ margins: clean });
  });

  app.put('/v1/projects/:pid/quality/decisions/:plot', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const plot = (request.params as { plot: string }).plot;
    if (!plot || plot.length > MAX_NAME) {
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
    const plot = (request.params as { plot: string }).plot;
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
