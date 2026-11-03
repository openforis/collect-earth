import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { isDate, isTimeZone } from '../days.js';
import { storageLimitBytes } from '../limits.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { differencesWaiting, PACE_DAYS, progressReport, type AttentionInput } from '../progress.js';
import type { ProjectStateCache, ServedState } from '../projectState.js';
import { remember, type QualityService } from '../qualityService.js';
import type { Store } from '../store/store.js';
import { totalStorageBytes, type ProgressSettings } from '../types.js';

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
export async function registerProgressRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService,
  states: ProjectStateCache,
  now: () => number = Date.now,
): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const attentionOf = attentionReader(store, quality);
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

    // The plots and the records resolved come from the project's state (kept between
    // requests); only the settings and the cards' inputs are read each time.
    const [served, settings] = await Promise.all([states.get(projectId, request.log), store.getProgressSettings(projectId)]);
    const { context, assignments, units } = served.state;
    const attention = coordinator ? await attentionOf(projectId, served, request, at) : undefined;
    return reply.send({
      ...progressReport({
        now: at,
        timeZone,
        days,
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
      }),
      // When the figures are older than the records (a newer state is being worked out).
      asOf: served.stale ? served.state.builtAt : null,
    });
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
 * What the "needs attention" cards are worked out from (the Progress tab's and the bell's), read
 * each time: the members' activity, the unsent work, the project file's date, the storage (its
 * bytes kept per project state and project file: summing the records takes tens of ms on a large
 * project) and the differences waiting (from the figures at hand only).
 */
export function attentionReader(store: Store, quality: QualityService) {
  const used = new Map<string, { key: string; bytes: number }>();
  const storageOf = async (projectId: string, version: string) => {
    const [cep, settings] = await Promise.all([store.getCepInfo(projectId), store.getSettings()]);
    const key = `${version} ${cep?.bytes ?? ''} ${cep?.updatedAt ?? ''}`;
    let hit = used.get(projectId);
    if (hit?.key !== key) {
      hit = { key, bytes: totalStorageBytes(await store.getProjectStorage(projectId)) };
    }
    remember(used, projectId, hit, 16);
    return { usedBytes: hit.bytes, limitBytes: storageLimitBytes(settings) };
  };
  return async (projectId: string, served: ServedState, request: { log: FastifyBaseLogger }, at: number): Promise<AttentionInput> => {
    const { context } = served.state;
    const [activity, unsentDelays, cep, storage, waiting] = await Promise.all([
      store.listMemberActivity(projectId),
      store.unsentDelays(projectId, at - UNSENT_WINDOW_DAYS * DAY_MS),
      store.getCepInfo(projectId),
      storageOf(projectId, served.state.version),
      context.copyHolders.size > 0 || (context.info?.reassessmentCode ?? null) !== null ? waitingDecisions(store, quality, projectId, request) : null,
    ]);
    return { members: served.members, activity, unsentDelays, cep, storage, differencesWaiting: waiting };
  };
}

/**
 * Differing plots without a decision, from the quality figures this server has at hand
 * (QualityService.peek): the Progress tab never waits for them nor starts them; an
 * out-of-date report is refreshed behind as the Quality tab would. Null when there are
 * none yet (nobody opened the Quality tab) or they cannot be had: the card is left out.
 */
async function waitingDecisions(store: Store, quality: QualityService, projectId: string, request: { log: FastifyBaseLogger }): Promise<number | null> {
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
