// The server page's operations (stage C), for server administrators only:
// - the projects directory, by id only, never a name (§4b): archive or restore one, hand one to a coordinator;
// - the server activity log (migration 041), filtered by person and kind, and as CSV;
// - the Collect Earth versions the accounts use.
// The mail check and test email are in routes/mail.ts, beside the mailer.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import type { Config } from '../config.js';
import { requirePlatformAdmin } from '../plugins/projectAuth.js';
import { logServerAction } from '../serverActivity.js';
import {
  activityCsv,
  collectEarthVersions,
  coordinatorsActiveSince,
  parseProjectQuery,
  queryProjects,
  versionsSince,
} from '../serverOps.js';
import type { Store } from '../store/store.js';
import type { ProjectArchivedAnswer, ProjectHandedAnswer, ServerActivityPage } from '../wire/serverAdmin.js';
import { SERVER_ACTION_KINDS, type ServerActionKind } from '../types.js';

/** The activity log's largest page; its CSV takes at most this many entries. */
const MAX_ACTIVITY_PAGE = 200;
const MAX_ACTIVITY_CSV = 50_000;

export async function registerServerOpsRoutes(app: FastifyInstance, store: Store, config: Config, now: () => number = Date.now): Promise<void> {
  const admin = { preHandler: requirePlatformAdmin(store) };
  const projectIdOf = (request: FastifyRequest) => (request.params as { pid: string }).pid;

  // Every project by id: its status, when made and last active, its space, people and coordinators; those without an
  // active coordinator flagged. ?q= (part of an id) &filter= &sort= &desc= &page= &pageSize=
  app.get('/v1/admin/projects', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projects = await store.listAdminProjects(coordinatorsActiveSince(now()));
    return reply.header('cache-control', 'no-store').send(queryProjects(projects, parseProjectQuery(request.query)));
  });

  // Archives a project (any status: no syncs, out of its people's normal list), or restores an archived one as closed
  // (its coordinator reopens it). { archived: boolean }
  app.post('/v1/admin/projects/:pid/archive', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = projectIdOf(request);
    const archived = ((request.body ?? {}) as { archived?: unknown }).archived;
    if (typeof archived !== 'boolean') return reply.code(400).send({ error: 'bad_request', reason: 'archived must be true or false' });
    const from = isUuid(projectId) ? await store.getProjectStatus(projectId) : null;
    if (!from) return reply.code(404).send({ error: 'not_found' });
    const to = archived ? 'archived' : 'closed';
    if (archived === (from === 'archived')) return reply.send({ projectId, status: from } satisfies ProjectArchivedAnswer);
    await store.setProjectStatus(projectId, to);
    await store.appendAudit(projectId, { actorUserId: request.userId ?? null, action: 'settings.changed', details: { setting: 'status', from, status: to, byServerAdmin: true } });
    await logServerAction(store, request, { action: archived ? 'project.archived' : 'project.restored', projectId, details: { from } });
    return reply.send({ projectId, status: to } satisfies ProjectArchivedAnswer);
  });

  // Hands a project to a coordinator the administrator names (an enabled account): made a member as coordinator, or a
  // member made coordinator. The project's own log says the server administrator did it. { username }
  app.post('/v1/admin/projects/:pid/coordinator', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = projectIdOf(request);
    if (!isUuid(projectId) || !(await store.getProjectStatus(projectId))) return reply.code(404).send({ error: 'not_found' });
    const username = ((request.body ?? {}) as { username?: unknown }).username;
    if (typeof username !== 'string' || username.trim() === '') return reply.code(400).send({ error: 'bad_request', reason: 'username required' });
    const user = await store.getUserByUsername(username.trim());
    if (!user) return reply.code(404).send({ error: 'no_such_account', reason: 'no account has this username' });
    if (user.disabledAt) return reply.code(409).send({ error: 'account_disabled', reason: 'enable the account first' });
    const member = await store.getMembership(projectId, user.id);
    if (member?.role === 'admin') return reply.code(409).send({ error: 'already_coordinator', reason: 'this account already coordinates the project' });
    if (member) await store.setMemberRole(projectId, user.id, 'admin');
    else await store.addMembership(projectId, user.id, 'admin');
    await store.appendAudit(projectId, { actorUserId: request.userId ?? null, action: 'member.role', details: { userId: user.id, role: 'admin', byServerAdmin: true } });
    await request.server.referenceSync?.(projectId, request.log);
    await logServerAction(store, request, { action: 'project.coordinator', projectId, targetUserId: user.id, targetName: user.username, details: { wasMember: member !== null } });
    return reply.send({ projectId, userId: user.id, username: user.username, wasMember: member !== null } satisfies ProjectHandedAnswer);
  });

  const activityQuery = (query: unknown) => {
    const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
    const kind = (SERVER_ACTION_KINDS as readonly unknown[]).includes(q.kind) ? (q.kind as ServerActionKind) : null;
    const actor = typeof q.actor === 'string' && q.actor.trim() !== '' ? q.actor.trim().slice(0, 100) : null;
    const num = (v: unknown, fallback: number, max: number) => (typeof v === 'string' && /^\d+$/.test(v) ? Math.max(1, Math.min(max, Number(v))) : fallback);
    return { kind, actor, page: num(q.page, 1, 1_000_000), pageSize: num(q.pageSize, 50, MAX_ACTIVITY_PAGE) };
  };

  // The server activity log, newest first: ?actor= (a username) &kind= (settings, account, project, mail) &page= &pageSize=
  app.get('/v1/admin/activity', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = activityQuery(request.query);
    const first = await store.listServerActivity({ actor: q.actor, kind: q.kind, offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
    const pages = Math.max(1, Math.ceil(first.total / q.pageSize));
    // A page past the end (entries filtered away meanwhile): the last one
    const page = Math.min(q.page, pages);
    const { entries, total } = page === q.page ? first : await store.listServerActivity({ actor: q.actor, kind: q.kind, offset: (page - 1) * q.pageSize, limit: q.pageSize });
    return reply.header('cache-control', 'no-store').send({ entries, total, page, pages, pageSize: q.pageSize, actors: await store.listServerActivityActors() } satisfies ServerActivityPage);
  });

  app.get('/v1/admin/activity.csv', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = activityQuery(request.query);
    const { entries } = await store.listServerActivity({ actor: q.actor, kind: q.kind, offset: 0, limit: MAX_ACTIVITY_CSV });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="server-activity.csv"')
      .header('cache-control', 'no-store')
      .send(activityCsv(entries));
  });

  // The Collect Earth versions used in the last VERSIONS_DAYS, by how many accounts, the outdated ones flagged.
  app.get('/v1/admin/versions', admin, async (_request: FastifyRequest, reply: FastifyReply) => {
    const uses = await store.listClientUses(versionsSince(now()));
    return reply.header('cache-control', 'no-store').send(collectEarthVersions(uses, config.collectEarthLatestVersion ?? null));
  });
}
