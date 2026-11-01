import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicBaseUrl } from '../accountRules.js';
import { audit, noteActivity } from '../activity.js';
import { addRound, CepError, roundInfoOf, type RefusalCode } from '../cep.js';
import type { Config } from '../config.js';
import { checkUploadFits } from '../limits.js';
import { fileKeyCount } from '../rounds.js';
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

/** Why the server could not add round to a file, in plain words. */
const CANNOT_ADD_ROUND: Record<RefusalCode, string> = {
  not_a_zip: 'it is not a zip file the server can read',
  too_large: 'it unzips to more than the server accepts',
  no_survey: 'it has no survey',
  survey_unreadable: 'its survey cannot be read',
  several_entities: 'its survey has more than one main entity',
  several_keys: 'its survey has more than one key',
  round_not_key: 'its survey has a round field that is not a key',
  balloon_missing: 'it has no balloon',
  balloon_marker_missing: 'its balloon lacks the line where the extra plot data goes',
  balloon_ids_missing: 'its balloon lacks the list of id fields (EXTRA_ID_ATTRIBUTES)',
  template_missing: 'it has no KML template',
  template_marker_missing: 'its KML template lacks the line where the extra plot data goes',
};

/** A survey's keys in plain words, for the key_shape_changed reason. */
function keysInWords(info: RoundInfo): string {
  if (info.keyCount === 0) return 'a survey the server cannot read';
  const keys = `${info.keyCount} key${info.keyCount === 1 ? '' : 's'}`;
  return info.roundIndex === null ? `${keys} and no round key` : `${keys}, round being key ${info.roundIndex + 1}`;
}

type StoredUpload = { served: Buffer; original: Buffer | null; info: RoundInfo };
type UploadRefusal = { error: 'round_removed' | 'round_codes_changed' | 'key_shape_changed'; reason: string };

/**
 * What to store for an upload once the project has records. Their keys (e.g. "17,1") come
 * from the served survey, so its key shape (how many keys, where round is) must stay:
 * - the server added round: an id-only file gets it added again, and the served file
 *   uploaded back (round as the second key, codes 1 and 2) keeps state 'added'; round as
 *   the second key without code 1 or 2 is refused (round_codes_changed);
 * - otherwise the file is stored as uploaded, unless its key shape differs.
 * A previous file whose survey could not be read (no keys) is not compared.
 */
function uploadOnceRecordsExist(cep: Buffer, previous: RoundInfo | null, date: Date): StoredUpload | UploadRefusal {
  let info: RoundInfo;
  if (previous?.state === 'added') {
    const result = addRound(cep, date);
    if (result.info.state === 'added') return { served: result.cep, original: cep, info: result.info };
    info = result.info;
    if (info.state === 'none') {
      return {
        error: 'round_removed',
        reason:
          'records were collected with the round key the server added, and the server cannot add it to this ' +
          `project file: ${CANNOT_ADD_ROUND[info.refusal ?? 'survey_unreadable']}. Upload a file whose survey ` +
          'keeps the round key, or an id-only file the server can add it to',
      };
    }
    if (info.keyCount === 2 && info.roundIndex === 1) {
      const codes = new Set(info.roundCodes.map((c) => c.code));
      if (!codes.has('1') || !codes.has('2')) {
        // The collected keys end in 1 or 2: they must keep meaning the same rounds.
        return {
          error: 'round_codes_changed',
          reason:
            'records were collected with the round key the server added, whose codes are 1 (First assessment) ' +
            'and 2 (Re-assessment), and the round in this project file lacks one of them: the round codes must ' +
            'stay 1 First assessment and 2 Re-assessment',
        };
      }
      // The served file uploaded back, or one like it: round stays the one the server added.
      return { served: cep, original: null, info: { ...info, state: 'added', reassessmentCode: '2' } };
    }
  } else {
    info = roundInfoOf(cep);
  }
  const shapeChanged =
    !!previous &&
    previous.keyCount > 0 &&
    (info.keyCount !== previous.keyCount || info.roundIndex !== previous.roundIndex);
  if (previous && shapeChanged) {
    return {
      error: 'key_shape_changed',
      reason:
        `records were collected with a survey of ${keysInWords(previous)}, and this project file has ` +
        `${keysInWords(info)}: the records would no longer match their plots. Upload a file whose survey ` +
        'has the same keys',
    };
  }
  return { served: cep, original: null, info };
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
        // A Phase-0 project admin token has no user behind it: made by nobody.
        createdBy: request.userId ?? null,
      });
      await audit(store, request, 'invite.created', { role, maxUses });
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
      await audit(store, request, 'invite.revoked', { inviteId: id });
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
  // exist, the survey's key shape must stay (see uploadOnceRecordsExist): records keyed
  // "17,1" would not match a file that makes "17".
  //
  // The records check and the write are not one transaction: a record that arrives in
  // between (milliseconds) was collected with the previous served file, and the new one
  // is stored as if there were none. Closing that window would mean every record write
  // taking a per-project lock; it is left open, since records only come from Collect
  // Earth after it has downloaded a file, and coordinators upload before collecting.
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
      const date = new Date();
      let served = cep;
      let original: Buffer | null = null;
      let info: RoundInfo;
      try {
        if (!(await store.hasRecords(projectId))) {
          const result = addRound(cep, date);
          info = result.info;
          if (info.state === 'added') {
            served = result.cep;
            original = cep;
          }
        } else {
          const upload = uploadOnceRecordsExist(cep, previous, date);
          if ('error' in upload) return reply.code(409).send(upload);
          ({ served, original, info } = upload);
        }
      } catch (e) {
        // The message names the limit this upload had.
        if (e instanceof CepError && e.code === 'too_large') {
          return reply.code(413).send({ error: 'too_large', reason: e.message });
        }
        throw e;
      }
      // A re-assessment code the coordinator chose stays while the new file still has it.
      const chosen = previous?.state === 'own' ? previous.reassessmentCode : null;
      if (info.state === 'own' && chosen !== null && info.roundCodes.some((c) => c.code === chosen)) {
        info = { ...info, reassessmentCode: chosen };
      }
      // Plot files are read with as many key columns as the survey has (less the round
      // the server added). A file that changes that would orphan the divided plots,
      // held by their old ids: refused while any file is divided.
      const keyCountBefore = fileKeyCount(previous);
      const keyCountAfter = fileKeyCount(info);
      if (keyCountBefore !== keyCountAfter) {
        const files = await store.listCsvFiles(projectId);
        if (files.some((f) => f.distribution)) {
          const columns = (n: number) => `${n} key column${n === 1 ? '' : 's'}`;
          return reply.code(409).send({
            error: 'plots_divided',
            reason:
              `This project file reads plots with ${columns(keyCountAfter)} instead of ${keyCountBefore}, ` +
              "which would undo how the plots are divided. Set the divided plot files back to 'whole file' first, " +
              'then upload it again.',
          });
        }
      }
      const over = await checkUploadFits(store, projectId, { kind: 'cep' }, served.length + (original?.length ?? 0));
      if (over) {
        return reply.code(413).send(over);
      }
      await store.putCep(projectId, served, info, original);
      if (keyCountBefore !== keyCountAfter) {
        await store.recountPlots(projectId, keyCountAfter);
      }
      await audit(store, request, 'cep.replaced', { bytes: cep.length });
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
      await audit(store, request, 'settings.changed', { setting: 'round' });
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
      noteActivity(request, { cepDownload: true }, { desktop: true });
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
      await audit(store, request, 'member.role', { userId: uid, role: body.role });
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
      await audit(store, request, 'member.removed', { userId: uid });
      return reply.code(204).send();
    },
  );
}
