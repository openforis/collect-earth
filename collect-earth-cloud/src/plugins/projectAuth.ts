import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { isUuid } from '../accountRules.js';
import { bearerToken } from '../auth.js';
import type { Store, TokenMembership } from '../store/store.js';
import type { Role } from '../types.js';

/** What a resolved request principal is: a project membership, optionally tied to a user. */
export interface RequestMembership extends TokenMembership {
  userId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    membership?: RequestMembership;
    /** Set for session-authenticated (logged-in user) routes. */
    userId?: string;
  }
}

/**
 * preHandler that enforces the tenant boundary for `/v1/projects/:pid/*` routes.
 * Accepts two token kinds, transparently:
 *   - a Phase-0 project-scoped token (admin/operator), or
 *   - a Phase-A user session token, whose access comes from a project_members row.
 *
 *  - Missing / unrecognised token             -> 401.
 *  - Valid token, but no access to this :pid   -> 404 (a non-member must not even
 *                                                 learn the project id exists).
 *  - Has access, but role insufficient         -> 403.
 */
export function requireProjectMembership(store: Store, requiredRole?: Role): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const pid = (request.params as { pid?: string }).pid ?? '';
    const membership = await resolveMembership(store, token, pid);
    if (membership === 'invalid') {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (membership === 'no_access') {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (requiredRole && !roleSatisfies(membership.role, requiredRole)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    // Coordinators' pages, when the server requires two-step sign-in of coordinators and the person has not set it up
    if (requiredRole === 'admin' && membership.userId && (await secondStepMissing(store, membership.userId))) {
      return reply.code(403).send(TWO_FACTOR_REQUIRED);
    }
    const refusal = await statusRefusal(store, request, membership.projectId);
    if (refusal) {
      return reply.code(409).send(refusal);
    }
    request.membership = membership;
    if (membership.userId) {
      request.userId = membership.userId;
    }
    return undefined;
  };
}

/**
 * preHandler for user-only routes (no project in the path): requires a valid
 * session token and attaches request.userId. Project tokens are rejected here —
 * these routes are about the human account, which project tokens do not represent.
 */
export function requireSession(store: Store): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const session = await store.resolveSession(token);
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.userId = session.userId;
    return undefined;
  };
}

/**
 * preHandler for the server-administration routes (/v1/admin/*): a valid session
 * whose user is a platform admin. Being a platform admin grants NO project access
 * (§4b) — these routes never return project data, only accounts and settings.
 *  - Missing / invalid session -> 401; a session of a non-admin -> 403.
 */
export function requirePlatformAdmin(store: Store): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request.headers.authorization);
    const session = token ? await store.resolveSession(token) : null;
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const user = await store.getUserById(session.userId);
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!user.isPlatformAdmin) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (await secondStepMissing(store, user.id)) {
      return reply.code(403).send(TWO_FACTOR_REQUIRED);
    }
    request.userId = user.id;
    return undefined;
  };
}

export const TWO_FACTOR_REQUIRED = {
  error: 'two_factor_required',
  message: 'This server requires two-step sign-in of coordinators and administrators: set it up on your account page.',
};

/** The server requires two-step sign-in of coordinators and the account has not set it up. */
async function secondStepMissing(store: Store, userId: string): Promise<boolean> {
  if (!(await store.getSettings()).twoFactorForCoordinators) return false;
  const state = await store.getTwoFactor(userId);
  return !(state?.enabledAt && state.secretEnc);
}

/**
 * The changes a closed (or archived) project still takes: its status itself, its deletion, a copy
 * of it (a template: the copy is another project), and requests that only read or are the person's own (the bell's read marks, a backup
 * link, plot places, the AI assistant's analysis, usage events).
 */
const OPEN_WHEN_CLOSED = new Set([
  'PUT /v1/projects/:pid/status',
  'POST /v1/projects/:pid/copy',
  'DELETE /v1/projects/:pid',
  'POST /v1/projects/:pid/attention/read',
  'POST /v1/projects/:pid/exports/collect-backup/link',
  'POST /v1/projects/:pid/quality/places',
  'POST /v1/projects/:pid/ai/runs',
  'POST /v1/projects/:pid/telemetry',
]);
const RECORDS_BATCH = 'POST /v1/projects/:pid/records:batch';

/**
 * Why the project's status refuses this request, or null. Reading (GET, HEAD) is never refused.
 * Collect Earth shows the reason of a refused sync and keeps the records to send later.
 */
async function statusRefusal(store: Store, request: FastifyRequest, projectId: string): Promise<{ error: string; reason: string } | null> {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const route = `${request.method} ${request.routeOptions?.url ?? ''}`;
  if (OPEN_WHEN_CLOSED.has(route)) return null;
  const status = await store.getProjectStatus(projectId);
  if (status === 'closed' || status === 'archived') {
    return { error: 'project_closed', reason: 'This project is closed: it takes no new records or changes. Ask its coordinator to reopen it.' };
  }
  if (status === 'draft' && route === RECORDS_BATCH) {
    return { error: 'project_draft', reason: 'This project is still being set up: records can be sent once its coordinator makes it active.' };
  }
  return null;
}

type MembershipResolution = RequestMembership | 'invalid' | 'no_access';

async function resolveMembership(store: Store, token: string, pid: string): Promise<MembershipResolution> {
  // A token is either a project token or a user session token — never both
  // (both are 24 random bytes). Try the project token first.
  const projectToken = await store.resolveToken(token);
  if (projectToken) {
    return projectToken.projectId === pid ? projectToken : 'no_access';
  }
  const session = await store.resolveSession(token);
  if (!session) {
    return 'invalid';
  }
  if (!isUuid(pid)) {
    return 'no_access';
  }
  const membership = await store.getMembership(pid, session.userId);
  if (!membership) {
    return 'no_access';
  }
  return { ...membership, userId: session.userId };
}

/** admin satisfies any requirement; otherwise the role must match exactly. */
function roleSatisfies(actual: Role, required: Role): boolean {
  return actual === 'admin' || actual === required;
}
