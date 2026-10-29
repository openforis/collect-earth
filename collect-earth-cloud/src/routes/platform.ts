import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicBaseUrl } from '../accountRules.js';
import { addRound, CepError, roundInfoOf } from '../cep.js';
import type { Config } from '../config.js';
import { checkUploadFits } from '../limits.js';
import { requireProjectMembership, requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { Role, RoundInfo } from '../types.js';

interface InviteBody {
  role?: Role;
  maxUses?: number;
  expiresInDays?: number;
}

interface RoleBody {
  role?: Role;
}

const TOO_LARGE = {
  error: 'too_large',
  reason: 'the project file unzips to more than the server accepts (at most 2,000 files and 200 MB)',
} as const;

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

  // Create an invite (admin). Returns the token, the relative joinPath and an
  // absolute joinUrl (PUBLIC_BASE_URL, else RENDER_EXTERNAL_URL, else derived from
  // this request's host). The token is shown only here; listings carry an id.
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
        joinUrl: `${publicBaseUrl(config, request)}${joinPath}`,
        role,
        maxUses,
        expiresAt,
      });
    },
  );

  // Open invites of the project (admin): not revoked, expired or used up.
  app.get(
    '/v1/projects/:pid/invites',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ invites: await store.listInvites(request.membership!.projectId, Date.now()) });
    },
  );

  // Revoke an invite (admin). The store matches the id within THIS project only, so
  // an invite id of another project is a 404 like any unknown id.
  app.delete(
    '/v1/projects/:pid/invites/:id',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = (request.params as { id: string }).id;
      if (!(await store.revokeInvite(request.membership!.projectId, id))) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.code(204).send();
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
      valid: !expired && !exhausted && !invite.revoked,
    });
  });

  // CEP upload (admin). Raw zip body (application/zip or octet-stream).
  // Before collection (no records, deleted ones included), an id-only survey gets a
  // hidden round key: the project serves that copy and keeps the upload. Once records
  // exist the file is stored as uploaded, but a project the server added round to
  // cannot drop it: its records' keys are "17,1" and the new file would make "17".
  app.put(
    '/v1/projects/:pid/cep',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const cep = request.body;
      if (!Buffer.isBuffer(cep) || cep.length === 0) {
        return reply.code(400).send({ error: 'bad_request', reason: 'expected a non-empty zip body' });
      }
      const previous = await store.getRoundInfo(projectId);
      let served = cep;
      let original: Buffer | null = null;
      let info: RoundInfo;
      try {
        if (!(await store.hasRecords(projectId))) {
          const result = addRound(cep, new Date());
          if (result.info.refusal === 'too_large') {
            return reply.code(413).send(TOO_LARGE);
          }
          info = result.info;
          if (info.state === 'added') {
            served = result.cep;
            original = cep;
          }
        } else {
          info = roundInfoOf(cep);
          if (previous?.state === 'added' && info.state !== 'own') {
            return reply.code(409).send({
              error: 'round_removed',
              reason:
                'records were collected with the round key the server added, and this project file has none: ' +
                'upload a file whose survey keeps the round key',
            });
          }
        }
      } catch (e) {
        if (e instanceof CepError && e.code === 'too_large') {
          return reply.code(413).send(TOO_LARGE);
        }
        throw e;
      }
      // A re-assessment code the coordinator chose stays while the new file still has it.
      const chosen = previous?.state === 'own' ? previous.reassessmentCode : null;
      if (info.state === 'own' && chosen !== null && info.roundCodes.some((c) => c.code === chosen)) {
        info = { ...info, reassessmentCode: chosen };
      }
      const over = await checkUploadFits(store, projectId, { kind: 'cep' }, served.length + (original?.length ?? 0));
      if (over) {
        return reply.code(413).send(over);
      }
      await store.putCep(projectId, served, info, original);
      return reply.send({ ok: true, bytes: cep.length, round: info });
    },
  );

  // The project file as the coordinator uploaded it (admin), before the server added round.
  app.get(
    '/v1/projects/:pid/cep/original',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cep = await store.getOriginalCep(request.membership!.projectId);
      if (!cep) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.header('content-type', 'application/zip').send(cep);
    },
  );

  // What the server did about round (admin): RoundInfo, or null before any upload.
  app.get(
    '/v1/projects/:pid/round',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send(await store.getRoundInfo(request.membership!.projectId));
    },
  );

  // Which code of a survey's own round marks re-assessments (admin): one of its codes,
  // or null for none. Only for surveys with their own round; the added one is always 2.
  app.put(
    '/v1/projects/:pid/round',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const body = (request.body ?? {}) as { reassessmentCode?: unknown };
      const code = body.reassessmentCode;
      if (code !== null && typeof code !== 'string') {
        return reply.code(400).send({ error: 'bad_request', reason: 'reassessmentCode must be a code or null' });
      }
      const info = await store.getRoundInfo(projectId);
      if (info?.state !== 'own') {
        return reply.code(400).send({
          error: 'bad_request',
          reason: 'the re-assessment code can only be chosen for a survey with its own round',
        });
      }
      if (code !== null && !info.roundCodes.some((c) => c.code === code)) {
        return reply.code(400).send({ error: 'bad_request', reason: 'reassessmentCode is not one of the round codes' });
      }
      await store.setReassessmentCode(projectId, code);
      return reply.send({ ...info, reassessmentCode: code });
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
