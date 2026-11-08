import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { isPseudonym, nextPseudonym } from '../anonymize.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import type { Store } from '../store/store.js';

/**
 * The people who collected in a project and are no longer in it, and anonymising their work (src/anonymize.ts):
 *  - GET  /v1/projects/:pid/former-members: each one's name as on their records, and how many records it is on;
 *    the anonymised ones (former-member-N) are listed apart;
 *  - POST /v1/projects/:pid/former-members/anonymize {operator}: their name becomes former-member-N on all of it.
 * Coordinators only. Someone still in the project cannot be anonymised: remove them first. It cannot be undone; the
 * audit log keeps that it was done and on how many records, never the name.
 */
export async function registerFormerMemberRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  const former = async (projectId: string, log: FastifyRequest['log']) => {
    const [records, served] = await Promise.all([store.listRecordStates(projectId), states.get(projectId, log)]);
    const members = new Set(served.members.map((m) => m.username));
    const counts = new Map<string, number>();
    for (const r of records) if (r.operator && !members.has(r.operator)) counts.set(r.operator, (counts.get(r.operator) ?? 0) + 1);
    return counts;
  };

  app.get('/v1/projects/:pid/former-members', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const counts = await former(request.membership!.projectId, request.log);
    const list = [...counts].map(([operator, records]) => ({ operator, records, anonymized: isPseudonym(operator) }));
    list.sort((a, b) => Number(a.anonymized) - Number(b.anonymized) || a.operator.localeCompare(b.operator));
    return reply.header('cache-control', 'no-store').send({ formerMembers: list });
  });

  app.post('/v1/projects/:pid/former-members/anonymize', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const operator = String((request.body as { operator?: unknown } | null)?.operator ?? '');
    if (!operator || isPseudonym(operator)) return reply.code(400).send({ error: 'bad_request', reason: 'give the name of a former member' });
    const counts = await former(projectId, request.log);
    if (!counts.has(operator)) {
      // A member (remove them first), or a name on no record
      return reply.code(409).send({ error: 'not_a_former_member', reason: 'only someone no longer in the project, with records, can be anonymised' });
    }
    const pseudonym = nextPseudonym((await store.listRecordStates(projectId)).map((r) => r.operator));
    // Their account (if the name is still one's): the project's log entries about it stop pointing at it
    const account = await store.getUserByUsername(operator);
    const records = await store.anonymizeOperator(projectId, operator, pseudonym, account?.id ?? null);
    await audit(store, request, 'member.anonymized', { records });
    // The figures are worked out again without the name
    states.forget(projectId);
    return reply.send({ operator: pseudonym, records });
  });
}
