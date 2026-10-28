import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { checkCredentials, checkPassword, isUuid, publicBaseUrl, setupCodesMatch } from '../accountRules.js';
import type { Config } from '../config.js';
import { hashPassword } from '../password.js';
import { requirePlatformAdmin } from '../plugins/projectAuth.js';
import type { RateLimiter } from '../rateLimit.js';
import { UsernameTakenError } from '../store/memory.js';
import type { Store } from '../store/store.js';
import type { ProjectCreation, ServerSettings } from '../types.js';

interface SetupBody {
  setupCode?: string;
  username?: string;
  password?: string;
}

interface SignupBody {
  username?: string;
  password?: string;
  email?: string;
}

interface ResetBody {
  token?: string;
  newPassword?: string;
}

const PROJECT_CREATION_VALUES: ProjectCreation[] = ['anyone', 'platform-admins'];
const RESET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminRouteOptions {
  /** The setup code in force (SETUP_CODE, or the one generated at boot). */
  setupCode: string;
  version: string;
}

/**
 * Server-level routes for the web dashboard: server info, first-run setup, open
 * sign-up, password reset, and the platform admin's settings/users pages. None of
 * these is project-scoped and none returns project data: a platform admin is not a
 * member of any project and sees only accounts and project COUNTS (§4b).
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
  limiter: RateLimiter,
  options: AdminRouteOptions,
): Promise<void> {
  // Public: what the dashboard needs before anyone logs in.
  app.get('/v1/server-info', async (_request: FastifyRequest, reply: FastifyReply) => {
    const settings = await store.getSettings();
    return reply.send({
      needsSetup: !(await store.hasPlatformAdmin()),
      signupOpen: settings.signupOpen,
      projectCreation: settings.projectCreation,
      version: options.version,
    });
  });

  // First-run setup: creates the platform admin. Gated by the setup code so a
  // stranger cannot claim a freshly deployed public server. Once done, always 409.
  app.post('/v1/setup', { preHandler: limiter.guard('setup') }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (await store.hasPlatformAdmin()) {
      return reply.code(409).send({ error: 'already_set_up' });
    }
    const body = (request.body ?? {}) as SetupBody;
    const setupCode = typeof body.setupCode === 'string' ? body.setupCode : '';
    if (!setupCodesMatch(setupCode, options.setupCode)) {
      return reply.code(403).send({ error: 'bad_setup_code' });
    }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rule = checkCredentials(username, password);
    if (rule) {
      return reply.code(400).send(rule);
    }
    let user;
    try {
      user = await store.createFirstPlatformAdmin({ username, passwordHash: await hashPassword(password) });
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        return reply.code(409).send({ error: 'username_taken' });
      }
      throw err;
    }
    if (!user) {
      // Lost a race with a concurrent setup.
      return reply.code(409).send({ error: 'already_set_up' });
    }
    const token = await store.createSession(user.id);
    return reply.code(201).send({ token, userId: user.id, username: user.username });
  });

  // Open sign-up (only when the platform admin turned it on). Accounts made through
  // an invite use /v1/auth/register and are always allowed.
  app.post('/v1/auth/signup', { preHandler: limiter.guard('signup') }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await store.getSettings()).signupOpen) {
      return reply.code(403).send({ error: 'signup_closed' });
    }
    const body = (request.body ?? {}) as SignupBody;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const email = typeof body.email === 'string' && body.email.trim().length > 0 ? body.email.trim() : null;
    const rule = checkCredentials(username, password);
    if (rule) {
      return reply.code(400).send(rule);
    }
    let userId: string;
    try {
      userId = (await store.createUser({ username, passwordHash: await hashPassword(password), email })).id;
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        return reply.code(409).send({ error: 'username_taken' });
      }
      throw err;
    }
    const token = await store.createSession(userId);
    return reply.code(201).send({ token, userId, username });
  });

  // Password reset with a link a platform admin issued. Single use; revokes every
  // session of the user (desktop client included) so a leaked session dies too.
  app.post('/v1/auth/reset', { preHandler: limiter.guard('reset') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as ResetBody;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!token) {
      return reply.code(400).send({ error: 'bad_request', reason: 'token and newPassword are required' });
    }
    // Check the password before consuming, so a too-short attempt does not burn the link.
    const rule = checkPassword(newPassword);
    if (rule) {
      return reply.code(400).send(rule);
    }
    const userId = await store.consumePasswordReset(token, Date.now());
    if (!userId) {
      return reply.code(410).send({ error: 'invalid_reset_token', reason: 'the link is unknown, used or expired' });
    }
    await store.setPassword(userId, await hashPassword(newPassword));
    await store.deleteUserSessions(userId);
    return reply.code(204).send();
  });

  app.get(
    '/v1/admin/settings',
    { preHandler: requirePlatformAdmin(store) },
    async (_request: FastifyRequest, reply: FastifyReply) => reply.send(await store.getSettings()),
  );

  app.put(
    '/v1/admin/settings',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: Partial<ServerSettings> = {};
      if (body.signupOpen !== undefined) {
        if (typeof body.signupOpen !== 'boolean') {
          return reply.code(400).send({ error: 'bad_request', reason: 'signupOpen must be true or false' });
        }
        patch.signupOpen = body.signupOpen;
      }
      if (body.projectCreation !== undefined) {
        if (!PROJECT_CREATION_VALUES.includes(body.projectCreation as ProjectCreation)) {
          return reply.code(400).send({ error: 'bad_request', reason: 'projectCreation must be "anyone" or "platform-admins"' });
        }
        patch.projectCreation = body.projectCreation as ProjectCreation;
      }
      return reply.send(await store.updateSettings(patch));
    },
  );

  // Accounts with a project count only — no project names or ids (§4b).
  app.get(
    '/v1/admin/users',
    { preHandler: requirePlatformAdmin(store) },
    async (_request: FastifyRequest, reply: FastifyReply) => reply.send({ users: await store.listUsers() }),
  );

  // Issue a reset link. Platform admin only: a project admin resetting a user who
  // also belongs to another project would reach across the tenant boundary.
  app.post(
    '/v1/admin/users/:uid/password-reset',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      const user = isUuid(uid) ? await store.getUserById(uid) : null;
      if (!user) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const expiresAt = Date.now() + RESET_TTL_MS;
      const token = await store.createPasswordReset(user.id, expiresAt);
      return reply.code(201).send({ resetUrl: `${publicBaseUrl(config, request)}/reset/${token}`, expiresAt });
    },
  );
}
