import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bearerToken } from '../auth.js';
import { hashPassword, verifyPassword } from '../password.js';
import { requireSession } from '../plugins/projectAuth.js';
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

/** Account registration (invite-gated), login, logout and the /me profile. */
export async function registerAuthRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/v1/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
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
    if (!invite) {
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

  app.post('/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as LoginBody;
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    if (!username || !password) {
      return reply.code(400).send({ error: 'bad_request', reason: 'username and password are required' });
    }
    const user = await store.getUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
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
      return reply.send({ userId: user.id, username: user.username, memberships });
    },
  );
}
