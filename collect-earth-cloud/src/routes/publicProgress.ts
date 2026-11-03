import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicBaseUrl } from '../accountRules.js';
import { audit } from '../activity.js';
import { isShareToken } from '../auth.js';
import type { Config } from '../config.js';
import { isTimeZone } from '../days.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { PACE_DAYS, progressReport, type Forecast, type ProgressDay, type ProgressTotals } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import type { QualityService } from '../qualityService.js';
import type { Rate } from '../quality.js';
import type { RateLimiter } from '../rateLimit.js';
import type { Store } from '../store/store.js';
import { overallAgreement } from '../weekly.js';
import { DEFAULT_DAYS, MAX_DAYS } from './progress.js';

/** Links not revoked a project may have at once. */
export const MAX_SHARE_LINKS = 20;
export const MAX_LABEL_LENGTH = 100;

/**
 * What a progress link shows (GET /v1/public/progress/:token). Built field by field from the
 * Progress tab's figures, so nothing else can slip in: the project's name, the plot totals, the
 * days, the forecast and one quality figure. Never a name, a username, an answer, a plot id, a
 * file name, a coordinate nor anyone's own counts.
 */
export interface PublicProgress {
  project: { name: string };
  timeZone: string;
  today: string;
  totals: ProgressTotals;
  daily: ProgressDay[];
  forecast: Forecast;
  quality: {
    /** False when this server has no quality figures at hand (nobody opened the Quality tab since it started). */
    available: boolean;
    /** Every check so far compared with its first assessment; rate null under MIN_PLOTS plots. */
    agreement: Rate | null;
    computedAt: number | null;
  };
  /** When the figures are older than the records (a newer state is being worked out). */
  asOf: number | null;
}

/** The label of a POST body, or why it is refused. */
function labelOf(body: unknown): string | { error: 'bad_request'; reason: string } {
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { label?: unknown }).label : undefined;
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return { error: 'bad_request', reason: 'label must be text' };
  const label = raw.trim();
  if (label.length > MAX_LABEL_LENGTH) return { error: 'bad_request', reason: `label must be at most ${MAX_LABEL_LENGTH} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(label)) return { error: 'bad_request', reason: 'label must be one line of text' };
  return label;
}

/** Headers of every answer of the public route (404 and 429 too): not indexed, no referrer, not kept. */
function publicHeaders(reply: FastifyReply): void {
  reply.header('x-robots-tag', 'noindex, nofollow');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('cache-control', 'no-store');
}

const NOT_FOUND = { error: 'not_found' } as const;

/**
 * Read-only progress links for funders (Task 18). Coordinators make, list and revoke them
 * (`/v1/projects/:pid/share-links`, audited link.created / link.revoked); anyone holding a
 * link reads `GET /v1/public/progress/:token` (no session, rate-limited per address in the
 * `public` bucket). An unknown token and a revoked one get the same 404 through the same
 * single lookup. The quality figure comes only from what this server has at hand
 * (QualityService.peek with refresh: false): the link never starts a computation.
 */
export async function registerPublicProgressRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
  limiter: RateLimiter,
  quality: QualityService,
  states: ProjectStateCache,
  now: () => number = Date.now,
): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/share-links', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ links: await store.listShareLinks(request.membership!.projectId) });
  });

  app.post('/v1/projects/:pid/share-links', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const label = labelOf(request.body);
    if (typeof label !== 'string') {
      return reply.code(400).send(label);
    }
    if ((await store.listShareLinks(projectId)).length >= MAX_SHARE_LINKS) {
      return reply.code(409).send({ error: 'too_many_links', reason: `a project has at most ${MAX_SHARE_LINKS} progress links; revoke one first` });
    }
    // A project admin token has no person behind it: made by nobody.
    const { token, link } = await store.createShareLink(projectId, { label, createdBy: request.userId ?? null });
    await audit(store, request, 'link.created', { linkId: link.id, label });
    const path = `/p/${token}`;
    return reply.code(201).send({ token, path, url: `${publicBaseUrl(config, request)}${path}`, link });
  });

  app.delete('/v1/projects/:pid/share-links/:id', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    // The store matches the id within THIS project only: another project's link is a 404.
    const link = await store.revokeShareLink(request.membership!.projectId, id);
    if (!link) {
      return reply.code(404).send(NOT_FOUND);
    }
    await audit(store, request, 'link.revoked', { linkId: link.id, label: link.label });
    return reply.code(204).send();
  });

  await app.register(async (scope) => {
    // Before the rate limiter, so a refusal carries them too.
    scope.addHook('onRequest', async (_request, reply) => publicHeaders(reply));

    scope.get('/v1/public/progress/:token', { preHandler: limiter.guard('public') }, async (request: FastifyRequest, reply: FastifyReply) => {
      const token = (request.params as { token: string }).token;
      // A string that cannot be a token is not looked up; any other goes through the one lookup,
      // which answers an unknown and a revoked link alike.
      const found = isShareToken(token) ? await store.findShareLink(token) : null;
      const project = found ? await store.getProject(found.projectId) : null;
      if (!found || !project) {
        return reply.code(404).send(NOT_FOUND);
      }
      const { projectId, linkId } = found;
      const query = (request.query ?? {}) as { days?: string; tz?: string };
      const asked = Number(query.days ?? DEFAULT_DAYS);
      const days = Number.isInteger(asked) ? Math.min(MAX_DAYS, Math.max(PACE_DAYS, asked)) : DEFAULT_DAYS;
      const timeZone = isTimeZone(query.tz) ? query.tz : 'UTC';
      const at = now();
      const [served, settings, figures] = await Promise.all([
        states.get(projectId, request.log),
        store.getProgressSettings(projectId),
        quality.peek(projectId, request.log, { refresh: false }).catch((err: unknown) => {
          request.log.warn({ err, projectId }, 'progress link: the quality figures could not be had');
          return null;
        }),
      ]);
      const { context, assignments, units } = served.state;
      const progress = progressReport({
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
      });
      try {
        await store.touchShareLink(projectId, linkId, at);
      } catch (err) {
        request.log.warn({ err, projectId }, 'progress link: its last use could not be noted');
      }
      const { totals: t, forecast: f } = progress;
      const body: PublicProgress = {
        project: { name: project.name },
        timeZone: progress.timeZone,
        today: progress.today,
        totals: { plots: t.plots, assigned: t.assigned, notAssigned: t.notAssigned, submitted: t.submitted, started: t.started, notStarted: t.notStarted },
        daily: progress.daily.map((d) => ({ date: d.date, submitted: d.submitted, cumulative: d.cumulative })),
        forecast: {
          target: f.target,
          targetFrom: f.targetFrom,
          remaining: f.remaining,
          pacePerDay: f.pacePerDay,
          paceDays: f.paceDays,
          daysLeft: f.daysLeft,
          endDate: f.endDate,
          deadline: f.deadline,
          daysToDeadline: f.daysToDeadline,
          daysOver: f.daysOver,
          neededPerDay: f.neededPerDay,
        },
        quality: figures
          ? { available: true, agreement: overallAgreement(figures.report), computedAt: figures.computedAt }
          : { available: false, agreement: null, computedAt: null },
        asOf: served.stale ? served.state.builtAt : null,
      };
      return reply.send(body);
    });
  });
}
