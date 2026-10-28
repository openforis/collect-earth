import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bearerToken } from '../auth.js';
import { hashPassword, verifyPassword } from '../password.js';
import { checkPassword } from '../accountRules.js';
import { requireSession } from '../plugins/projectAuth.js';
import { RATE_LIMITED, type RateLimiter } from '../rateLimit.js';
import { UsernameTakenError } from '../store/memory.js';
import type { Store } from '../store/store.js';

interface RegisterBody {
  username?: string;
  password?: string;
  inviteToken?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
}

interface PasswordChangeBody {
  currentPassword?: string;
  newPassword?: string;
}

/**
 * Account registration (invite-gated), login, logout, the /me profile and password
 * change. register/login are what the desktop client calls: their contract
 * (accepted inputs, error codes, response shape) must not change — only the rate
 * limit is added in front of them.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  store: Store,
  limiter: RateLimiter,
  loginFailures: RateLimiter,
): Promise<void> {
  app.post('/v1/auth/register', { preHandler: limiter.guard('register') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as RegisterBody;
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const inviteToken = (body.inviteToken ?? '').trim();
    if (!username || !password || !inviteToken) {
      return reply.code(400).send({ error: 'bad_request', reason: 'username, password and inviteToken are required' });
    }

    // Fast pre-check so an obvious duplicate does not consume an invite use.
    if (await store.getUserByUsername(username)) {
      return reply.code(409).send({ error: 'username_taken' });
    }
    const invite = await store.getInvite(inviteToken);
    // A revoked invite answers exactly like an unknown one.
    if (!invite || invite.revoked) {
      return reply.code(400).send({ error: 'invalid_invite' });
    }
    // Atomic gate: one use per successful registration. On a lost dup race below we
    // over-consume by one use (admin can raise max_uses); we never orphan a user.
    const consumed = await store.consumeInvite(inviteToken, Date.now());
    if (!consumed) {
      return reply.code(410).send({ error: 'invite_exhausted' });
    }

    let userId: string;
    try {
      const user = await store.createUser({ username, passwordHash: await hashPassword(password), email: null });
      userId = user.id;
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        return reply.code(409).send({ error: 'username_taken' });
      }
      throw err;
    }

    await store.addMembership(invite.projectId, userId, invite.role);
    const token = await store.createSession(userId);
    return reply.code(201).send({
      token,
      userId,
      username,
      projectId: invite.projectId,
      projectName: invite.projectName,
      role: invite.role,
    });
  });

  app.post('/v1/auth/login', { preHandler: limiter.guard('login') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as LoginBody;
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    if (!username || !password) {
      return reply.code(400).send({ error: 'bad_request', reason: 'username and password are required' });
    }
    // Failed logins are counted per account, whatever IP they come from
    const failureKey = username.toLowerCase();
    if (loginFailures.blocked(failureKey)) {
      return reply.code(429).header('retry-after', '60').send(RATE_LIMITED);
    }
    const user = await store.getUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      loginFailures.hit(failureKey);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const token = await store.createSession(user.id);
    return reply.send({ token, userId: user.id, username: user.username });
  });

  app.post(
    '/v1/auth/logout',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = bearerToken(request.headers.authorization);
      if (token) {
        await store.deleteSession(token);
      }
      return reply.code(204).send();
    },
  );

  app.get(
    '/v1/me',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await store.getUserById(request.userId!);
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const memberships = await store.listMemberships(user.id);
      return reply.send({
        userId: user.id,
        username: user.username,
        isPlatformAdmin: user.isPlatformAdmin,
        memberships,
      });
    },
  );

  // Change the caller's own password. Other sessions stay valid (the desktop
  // client's session is not logged out by a change made in the dashboard).
  app.put(
    '/v1/me/password',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as PasswordChangeBody;
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const user = await store.getUserById(request.userId!);
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const rule = checkPassword(newPassword);
      if (rule) {
        return reply.code(400).send(rule);
      }
      await store.setPassword(user.id, await hashPassword(newPassword));
      return reply.code(204).send();
    },
  );
}
