import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { isPseudonym, nextPseudonym } from '../anonymize.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import type { Store } from '../store/store.js';
import type { AnonymizedAnswer, FormerMember, FormerMembersAnswer, GivenAnswer } from '../wire/account.js';

/**
 * The people who collected in a project and are no longer in it, and anonymising their work (src/anonymize.ts):
 *  - GET  /v1/projects/:pid/former-members: each one's name as on their records, and how many records it is on;
 *    the anonymised ones (former-member-N) are listed apart;
 *  - POST /v1/projects/:pid/former-members/anonymize {operator}: their name becomes former-member-N on all of it;
 *  - POST /v1/projects/:pid/former-members/give {operator, username}: a name typed in Collect Earth (no account's: a
 *    backup's, a CEO project's, an older Collect Earth's) gives its plots to a person of the project, so they count as
 *    theirs; a plot the person has their own record of keeps both (docs/plans/2026-11-15-workflow-review.md).
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
    const projectId = request.membership!.projectId;
    const counts = await former(projectId, request.log);
    // A typed name is no account's: neither exactly nor (usernames are case-sensitive) in other letters, unless those
    // other letters are a person of the project's ("Marta" typed, marta in the project: hers to be given)
    const memberNames = new Set((await store.listMembers(projectId)).map((m) => m.username.toLowerCase()));
    const typed = async (operator: string) =>
      !isPseudonym(operator) &&
      (await store.getUserByUsername(operator)) === null &&
      (!(await store.isAccountUsername(operator)) || memberNames.has(operator.toLowerCase()));
    const list: FormerMember[] = await Promise.all(
      [...counts].map(async ([operator, records]) => ({ operator, records, anonymized: isPseudonym(operator), typed: await typed(operator) })),
    );
    list.sort((a, b) => Number(a.anonymized) - Number(b.anonymized) || a.operator.localeCompare(b.operator));
    return reply.header('cache-control', 'no-store').send({ formerMembers: list } satisfies FormerMembersAnswer);
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
    return reply.send({ operator: pseudonym, records } satisfies AnonymizedAnswer);
  });

  app.post('/v1/projects/:pid/former-members/give', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { operator?: unknown; username?: unknown };
    const operator = typeof body.operator === 'string' ? body.operator : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!operator || !username) return reply.code(400).send({ error: 'bad_request', reason: 'give the typed name and the username to give its plots to' });
    if (isPseudonym(operator)) return reply.code(400).send({ error: 'bad_request', reason: 'an anonymised name stays anonymous' });
    const counts = await former(projectId, request.log);
    if (!counts.has(operator)) {
      return reply.code(409).send({ error: 'not_a_typed_name', reason: 'no plot of the project is under that name, or it is the name of someone in the project' });
    }
    // An account's name (a person who left, a deleted account) is a person's work, not a typed name: never given. The
    // person's own username in other letter case is theirs ("Marta" typed, the account marta), as when they sync.
    if ((await store.isAccountUsername(operator)) && operator.toLowerCase() !== username.toLowerCase()) {
      return reply.code(409).send({ error: 'name_is_account', reason: `"${operator}" is the name of an account: its plots are that person's` });
    }
    const member = (await store.listMembers(projectId)).find((m) => m.username === username);
    if (!member) return reply.code(400).send({ error: 'not_a_member', reason: `${username} is not in the project: invite them first` });
    const { moved, kept } = await store.giveOperatorRecords(projectId, operator, member.username);
    await audit(store, request, 'records.given', { records: moved, kept, userId: member.userId });
    // The figures are worked out again with the plots under the person
    states.forget(projectId);
    return reply.send({ operator, username: member.username, moved, kept } satisfies GivenAnswer);
  });
}
