import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { parseSamplingRule, samplingActive } from '../sampling.js';
import type { SamplingService } from '../samplingService.js';
import type { Store } from '../store/store.js';

/**
 * The automatic check sampling (Task 13), coordinators only:
 * - `GET /v1/projects/:pid/sampling`: the rule, the last draw, what a draw now would add, the
 *   divided files (and the whole ones, which cannot hold checks) and each person's checks;
 * - `PUT /v1/projects/:pid/sampling`: the rule (`parseSamplingRule`), audited as
 *   `settings.changed` `{ setting: 'sampling' }` (it draws nothing by itself: "Draw now" applies
 *   it to the plots already submitted, the next first submissions do it automatically);
 * - `POST /v1/projects/:pid/sampling/draw`: "Draw now", audited as `sampling.drawn` with its counts.
 */
export async function registerSamplingRoutes(app: FastifyInstance, store: Store, sampling: SamplingService): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/sampling', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await sampling.view(request.membership!.projectId, request.log));
  });

  app.put('/v1/projects/:pid/sampling', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [members, files, stored] = await Promise.all([store.listMembers(projectId), store.listCsvFiles(projectId), store.getSampling(projectId)]);
    const parsed = parseSamplingRule(request.body, {
      members: new Set(members.map((m) => m.userId)),
      divided: new Set(files.filter((f) => f.distribution).map((f) => f.id)),
      seed: stored.rule?.seed ?? null,
      newSeed: () => randomInt(0, 2 ** 31),
    });
    if ('reason' in parsed) {
      return reply.code(400).send({ error: 'bad_request', reason: parsed.reason });
    }
    const active = samplingActive(parsed);
    await store.setSamplingRule(projectId, parsed, active);
    await audit(store, request, 'settings.changed', { setting: 'sampling', active, firstN: parsed.firstN, percent: parsed.percent });
    return reply.send(await sampling.view(projectId, request.log));
  });

  app.post('/v1/projects/:pid/sampling/draw', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const outcome = await sampling.draw(projectId, { userId: request.membership!.userId ?? null }, request.log);
    if (!outcome) {
      return reply.code(409).send({ error: 'no_rule', reason: 'Turn on "the first plots of every person" or "a share of the plots" first: there is nothing to draw.' });
    }
    return reply.send({ draw: outcome.draw, view: await sampling.view(projectId, request.log) });
  });
}
