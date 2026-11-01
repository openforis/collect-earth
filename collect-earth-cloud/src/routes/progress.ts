import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { isDate, isTimeZone } from '../days.js';
import { storageSummary } from '../limits.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { differencesWaiting, PACE_DAYS, progressReport, type AttentionInput } from '../progress.js';
import { loadPlotContext, type QualityService } from '../qualityService.js';
import type { Store } from '../store/store.js';
import type { ProgressSettings } from '../types.js';

const DAY_MS = 86_400_000;
export const DEFAULT_DAYS = 90;
export const MAX_DAYS = 366;
/** Old unsent work is judged on the uploads received in this many days. */
export const UNSENT_WINDOW_DAYS = 14;
export const MAX_TARGET = 10_000_000;
export const MAX_QUIET_DAYS = 365;

type BadRequest = { error: 'bad_request'; reason: string };
const bad = (reason: string): BadRequest => ({ error: 'bad_request', reason });

/** The settings of a PUT body, or why they are refused. Missing fields are null (quietDays: 3). */
export function settingsInput(body: unknown): ProgressSettings | BadRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return bad('the body must be an object: { deadline, targetPlots, quietDays }');
  }
  const b = body as Record<string, unknown>;
  const deadline = b.deadline === undefined || b.deadline === null || b.deadline === '' ? null : b.deadline;
  if (deadline !== null && !isDate(deadline)) {
    return bad('deadline must be a date written YYYY-MM-DD, or null');
  }
  const target = b.targetPlots === undefined || b.targetPlots === null ? null : b.targetPlots;
  if (target !== null && !(Number.isInteger(target) && (target as number) >= 1 && (target as number) <= MAX_TARGET)) {
    return bad(`targetPlots must be a whole number from 1 to ${MAX_TARGET}, or null`);
  }
  const quiet = b.quietDays === undefined || b.quietDays === null ? 3 : b.quietDays;
  if (!(Number.isInteger(quiet) && (quiet as number) >= 1 && (quiet as number) <= MAX_QUIET_DAYS)) {
    return bad(`quietDays must be a whole number from 1 to ${MAX_QUIET_DAYS}`);
  }
  return { deadline: deadline as string | null, targetPlots: target as number | null, quietDays: quiet as number };
}

/**
 * The Progress tab (monitoring Phase 2): `GET /progress?days=90&tz=Europe/Rome` for
 * coordinators and reviewers (reviewers without the cards that name people), and the
 * progress settings for coordinators.
 */
export async function registerProgressRoutes(app: FastifyInstance, store: Store, quality: QualityService, now: () => number = Date.now): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/progress', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, role } = request.membership!;
    const query = (request.query ?? {}) as { days?: string; tz?: string };
    const asked = Number(query.days ?? DEFAULT_DAYS);
    // At least the forecast's pace days, so the pace is over days the chart shows.
    const days = Number.isInteger(asked) ? Math.min(MAX_DAYS, Math.max(PACE_DAYS, asked)) : DEFAULT_DAYS;
    const timeZone = isTimeZone(query.tz) ? query.tz : 'UTC';
    const at = now();
    const coordinator = role === 'admin';

    const [records, context, assignments, settings] = await Promise.all([
      store.listRecordStates(projectId),
      loadPlotContext(store, projectId, request.log),
      store.listAssignments(projectId),
      store.getProgressSettings(projectId),
    ]);
    let attention: AttentionInput | undefined;
    if (coordinator) {
      const [members, activity, unsentDelays, cep, storage, waiting] = await Promise.all([
        store.listMembers(projectId),
        store.listMemberActivity(projectId),
        store.unsentDelays(projectId, at - UNSENT_WINDOW_DAYS * DAY_MS),
        store.getCepInfo(projectId),
        storageSummary(store, projectId),
        context.copyHolders.size > 0 || (context.info?.reassessmentCode ?? null) !== null ? waitingDecisions(store, quality, projectId, request) : null,
      ]);
      attention = { members, activity, unsentDelays, cep, storage, differencesWaiting: waiting };
    }
    return reply.send(
      progressReport({
        now: at,
        timeZone,
        days,
        records,
        info: context.info,
        units: context.units,
        copyHolders: context.copyHolders,
        mainHolders: context.mainHolders,
        fileUnits: context.fileUnits,
        assignments,
        settings,
        attention,
      }),
    );
  });

  app.get('/v1/projects/:pid/progress/settings', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await store.getProgressSettings(request.membership!.projectId));
  });

  app.put('/v1/projects/:pid/progress/settings', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const input = settingsInput(request.body);
    if ('error' in input) {
      return reply.code(400).send(input);
    }
    await store.setProgressSettings(request.membership!.projectId, input);
    await audit(store, request, 'settings.changed', { setting: 'progress' });
    return reply.send(input);
  });
}

/**
 * Differing plots without a decision, from the quality figures this server has at hand
 * (QualityService.peek): the Progress tab never waits for them nor starts them; an
 * out-of-date report is refreshed behind as the Quality tab would. Null when there are
 * none yet (nobody opened the Quality tab) or they cannot be had: the card is left out.
 */
async function waitingDecisions(store: Store, quality: QualityService, projectId: string, request: FastifyRequest): Promise<number | null> {
  try {
    const served = await quality.peek(projectId, request.log);
    if (!served) {
      return null;
    }
    const decisions = await store.listQualityDecisions(projectId);
    return differencesWaiting(served.report, new Set(decisions.map((d) => d.plot)));
  } catch (err) {
    request.log.warn({ err, projectId }, 'progress: the quality figures could not be had for the differences card');
    return null;
  }
}
