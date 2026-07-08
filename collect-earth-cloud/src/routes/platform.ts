import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { requireProjectMembership, requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { Role } from '../types.js';

interface InviteBody {
  role?: Role;
  maxUses?: number;
  expiresInDays?: number;
}

interface RoleBody {
  role?: Role;
}

const VALID_ROLES: Role[] = ['admin', 'reviewer', 'operator'];

/**
 * Phase-A coordination routes: the caller's project list, invite creation and
 * public preview, CEP download/upload, and member management. All project-scoped
 * routes go through requireProjectMembership so the §4b tenant boundary holds.
 */
export async function registerPlatformRoutes(app: FastifyInstance, store: Store, config: Config): Promise<void> {
  // The logged-in user's projects (dashboard home). Session-only: returns strictly
  // the caller's memberships — there is no global project listing.
  app.get(
    '/v1/projects',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ projects: await store.listMemberships(request.userId!) });
    },
  );

  // Create an invite (admin). Returns the token and a join URL (absolute if
  // PUBLIC_BASE_URL is configured, otherwise a relative path the client resolves).
  app.post(
    '/v1/projects/:pid/invites',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as InviteBody;
      const role: Role = body.role && VALID_ROLES.includes(body.role) ? body.role : 'operator';
      const maxUses = Number.isInteger(body.maxUses) && body.maxUses! > 0 ? body.maxUses! : 1;
      const expiresAt =
        typeof body.expiresInDays === 'number' && body.expiresInDays > 0
          ? Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000
          : null;
      const token = await store.createInvite({
        projectId: request.membership!.projectId,
        role,
        maxUses,
        expiresAt,
        createdBy: request.userId ?? request.membership!.projectId,
      });
      const joinPath = `/join/${token}`;
      return reply.code(201).send({
        inviteToken: token,
        joinPath,
        joinUrl: config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/+$/, '')}${joinPath}` : null,
        role,
        maxUses,
        expiresAt,
      });
    },
  );

  // Public invite preview: the joining operator sees which project and role the
  // invite grants before registering. No auth (holding the token is the capability).
  app.get('/v1/join/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.params as { token: string }).token;
    const invite = await store.getInvite(token);
    if (!invite) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const expired = invite.expiresAt !== null && invite.expiresAt < Date.now();
    const exhausted = invite.usedCount >= invite.maxUses;
    return reply.send({
      projectId: invite.projectId,
      projectName: invite.projectName,
      role: invite.role,
      valid: !expired && !exhausted,
    });
  });

  // CEP upload (admin). Raw zip body (application/zip or octet-stream).
  app.put(
    '/v1/projects/:pid/cep',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cep = request.body;
      if (!Buffer.isBuffer(cep) || cep.length === 0) {
        return reply.code(400).send({ error: 'bad_request', reason: 'expected a non-empty zip body' });
      }
      await store.putCep(request.membership!.projectId, cep);
      return reply.send({ ok: true, bytes: cep.length });
    },
  );

  // CEP download (any member) — the join flow fetches this to configure the client.
  app.get(
    '/v1/projects/:pid/cep',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cep = await store.getCep(request.membership!.projectId);
      if (!cep) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.header('content-type', 'application/zip').send(cep);
    },
  );

  // Member listing (admin).
  app.get(
    '/v1/projects/:pid/members',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ members: await store.listMembers(request.membership!.projectId) });
    },
  );

  // Change a member's role (admin). Demoting the last admin is refused so a project
  // can never be orphaned.
  app.put(
    '/v1/projects/:pid/members/:uid',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const uid = (request.params as { uid: string }).uid;
      const body = (request.body ?? {}) as RoleBody;
      if (!body.role || !VALID_ROLES.includes(body.role)) {
        return reply.code(400).send({ error: 'bad_request', reason: 'valid role required' });
      }
      const current = await store.getMembership(projectId, uid);
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (current.role === 'admin' && body.role !== 'admin' && (await store.countAdmins(projectId)) <= 1) {
        return reply.code(409).send({ error: 'last_admin' });
      }
      await store.setMemberRole(projectId, uid, body.role);
      return reply.send({ ok: true });
    },
  );

  // Remove a member (admin). Removing the last admin is refused.
  app.delete(
    '/v1/projects/:pid/members/:uid',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const uid = (request.params as { uid: string }).uid;
      const current = await store.getMembership(projectId, uid);
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (current.role === 'admin' && (await store.countAdmins(projectId)) <= 1) {
        return reply.code(409).send({ error: 'last_admin' });
      }
      await store.removeMember(projectId, uid);
      return reply.code(204).send();
    },
  );
}
