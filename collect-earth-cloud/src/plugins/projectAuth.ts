import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
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
