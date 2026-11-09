import { twoFactorKey } from '../twoFactor.js';
import { checkSecondStep, twoFactorEnabled } from './twoFactor.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bearerToken } from '../auth.js';
import { hashPassword, verifyPassword } from '../password.js';
import { checkPassword } from '../accountRules.js';
import { requireSession } from '../plugins/projectAuth.js';
import { RATE_LIMITED, type RateLimiter } from '../rateLimit.js';
import type { ServerCounters } from '../serverCounters.js';
import { UsernameTakenError } from '../store/memory.js';
import type { Store } from '../store/store.js';
import type { AccountMailHooks } from './mail.js';

interface RegisterBody {
  username?: string;
  password?: string;
  inviteToken?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
  /** The second step, for an account with two-step sign-in: the authenticator app's code, or a recovery code. */
  code?: string;
}

interface PasswordChangeBody {
  currentPassword?: string;
  newPassword?: string;
  /** The page's language, for the notice mailed after the change. */
  language?: string;
}

interface ProjectRef {
  projectId: string;
  name: string;
}

/** What deleting an account would do, worked out from its memberships. */
interface AccountDeletionPlan {
  /** Projects the user is the only coordinator of while others are in them: refusal. */
  soleCoordinator: ProjectRef[];
  /** Projects where the user is the only member and coordinator: deleted with the account. */
  deletedWithAccount: ProjectRef[];
  /** The last platform admin cannot leave: the server would have no owner. */
  lastPlatformAdmin: boolean;
}

async function accountDeletionPlan(store: Store, userId: string, isPlatformAdmin: boolean): Promise<AccountDeletionPlan> {
  const plan: AccountDeletionPlan = { soleCoordinator: [], deletedWithAccount: [], lastPlatformAdmin: false };
  for (const m of await store.listMemberships(userId)) {
    if (m.role !== 'admin') {
      // Not a coordinator: leaving takes nothing away from the project.
      continue;
    }
    const members = await store.listMembers(m.projectId);
    const ref = { projectId: m.projectId, name: m.projectName };
    if (members.length <= 1) {
      plan.deletedWithAccount.push(ref);
    } else if (members.filter((x) => x.role === 'admin').length <= 1) {
      plan.soleCoordinator.push(ref);
    }
  }
  plan.lastPlatformAdmin = isPlatformAdmin && (await store.countPlatformAdmins()) <= 1;
  return plan;
}

/** What a disabled account's login answers (403), shown as it is by Collect Earth's login dialog. */
export const ACCOUNT_DISABLED = {
  error: 'account_disabled',
  reason: 'This account has been disabled by the administrator of this server. Ask them to enable it again.',
};

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
  counters?: ServerCounters,
  /** Filled in by the mail routes (registered later): the notice mailed after a password change. */
  accountMail?: AccountMailHooks,
  /** The key two-step sign-in's secrets are encrypted with (src/twoFactor.ts). */
  twoFactorKeyBuf: Buffer = twoFactorKey({}),
  /** Wrong passwords for one account from every address together (server.ts, ACCOUNT_LOGIN_FAILURES). */
  accountFailures?: RateLimiter,
): Promise<void> {
  // An unknown username is checked against a password hash all the same, so that its answer
  // takes as long as a wrong password's and does not tell that the username is free.
  let dummyHash: Promise<string> | null = null;
  const unknownUser = async (password: string): Promise<void> => {
    dummyHash ??= hashPassword(`no account ${Math.random()}`);
    await verifyPassword(password, await dummyHash);
  };

  app.post('/v1/auth/register', { preHandler: limiter.guard('register') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as RegisterBody;
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const inviteToken = (body.inviteToken ?? '').trim();
    if (!username || !password || !inviteToken) {
      return reply.code(400).send({ error: 'bad_request', reason: 'username, password and inviteToken are required' });
    }

    // The password rule of the dashboard's accounts applies to an invitation's too (security review,
    // 2026-11): collectors' accounts reach their project's records and plot files. Collect Earth
    // shows the reason when it refuses.
    const weak = checkPassword(password);
    if (weak) {
      return reply.code(400).send(weak);
    }
    // The invitation first: whether a username is taken is said only to someone holding a valid
    // one, not to anyone asking with a made-up token.
    const invite = await store.getInvite(inviteToken);
    // A revoked invite answers exactly like an unknown one.
    if (!invite || invite.revoked) {
      return reply.code(400).send({ error: 'invalid_invite' });
    }
    // Fast pre-check so an obvious duplicate does not consume an invite use.
    if (await store.getUserByUsername(username)) {
      return reply.code(409).send({ error: 'username_taken' });
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
    // Failed logins are counted per account and client IP: guessing from one place
    // stops, while someone else's wrong guesses never lock the real user out.
    const failureKey = `${username.toLowerCase()} ${request.ip}`;
    // ...and per account from every address together, at a higher limit: many addresses, each under
    // its own limit, guessing one account (a temporary lock of that account on this instance)
    const accountKey = username.toLowerCase();
    if (loginFailures.blocked(failureKey) || accountFailures?.blocked(accountKey)) {
      counters?.count('rateLimited');
      return reply.code(429).header('retry-after', '60').send(RATE_LIMITED);
    }
    const user = await store.getUserByUsername(username);
    if (!user) await unknownUser(password);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      loginFailures.hit(failureKey);
      accountFailures?.hit(accountKey);
      counters?.count('failedLogin');
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    // Said only to someone who knows the password: a wrong one answers as above.
    if (user.disabledAt) {
      return reply.code(403).send(ACCOUNT_DISABLED);
    }
    // Two-step sign-in: the password was right; without a code, say a code is needed (the dashboard and Collect Earth
    // then ask for it and send both again); a wrong code counts as a failed login, as a wrong password does
    if (await twoFactorEnabled(store, user.id)) {
      const code = typeof body.code === 'string' ? body.code : '';
      if (!code.trim()) return reply.code(401).send({ error: 'second_step_required' });
      const check = await checkSecondStep(store, twoFactorKeyBuf, user.id, code);
      if (check !== 'ok') {
        loginFailures.hit(failureKey);
        accountFailures?.hit(accountKey);
        counters?.count('failedLogin');
        return reply.code(401).send({ error: check === 'unreadable' ? 'second_step_unreadable' : 'invalid_second_step' });
      }
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

  // Sign out everywhere else: every other session of the account ends (a laptop lost, a computer shared), this one stays.
  app.post(
    '/v1/auth/logout-others',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = bearerToken(request.headers.authorization);
      if (token) {
        await store.deleteUserSessionsExcept(request.userId!, token);
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
      const enabled = await twoFactorEnabled(store, user.id);
      const settings = await store.getSettings();
      const required = settings.twoFactorForCoordinators && (user.isPlatformAdmin || memberships.some((m) => m.role === 'admin'));
      return reply.send({
        userId: user.id,
        username: user.username,
        isPlatformAdmin: user.isPlatformAdmin,
        memberships,
        twoFactor: { enabled, required },
        // The server owner's announcement, while it lasts (the dashboard lets each person dismiss it).
        announcement: settings.announcement && (settings.announcementUntil === null || settings.announcementUntil > Date.now())
          ? { text: settings.announcement, until: settings.announcementUntil }
          : null,
      });
    },
  );

  // What deleting the caller's account would do, so the dashboard can warn first.
  app.get(
    '/v1/me/deletion',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await store.getUserById(request.userId!);
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      return reply.send(await accountDeletionPlan(store, user.id, user.isPlatformAdmin));
    },
  );

  // Delete the caller's account (password required). Refused while the user is the
  // only coordinator of a project others still work in, and for the last platform
  // admin. Projects where the user is the only member go with the account. Records
  // the user uploaded stay: they belong to the project.
  app.delete(
    '/v1/me',
    { preHandler: requireSession(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { password?: unknown };
      const password = typeof body.password === 'string' ? body.password : '';
      const user = await store.getUserById(request.userId!);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const plan = await accountDeletionPlan(store, user.id, user.isPlatformAdmin);
      if (plan.lastPlatformAdmin) {
        return reply.code(409).send({ error: 'last_platform_admin' });
      }
      if (plan.soleCoordinator.length > 0) {
        return reply.code(409).send({ error: 'sole_coordinator', projects: plan.soleCoordinator });
      }
      // The account first: the store counts the enabled platform admins again inside the
      // deletion (two admins leaving at once), and nothing is deleted when it refuses.
      if ((await store.deleteUser(user.id)) === 'last_platform_admin') {
        return reply.code(409).send({ error: 'last_platform_admin' });
      }
      // Then the projects only they were in (no members left now).
      for (const p of plan.deletedWithAccount) {
        await store.deleteProject(p.projectId);
      }
      return reply.code(204).send();
    },
  );

  // Change the caller's own password. Every other session of the account ends, Collect
  // Earth's included (it signs in again with the new password): a session someone else
  // holds must not outlive the change. The session making the change stays. A notice goes
  // to the account's confirmed address.
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
      // requireSession let the request in with this bearer token: it is the session that stays.
      const current = bearerToken(request.headers.authorization);
      if (current) {
        await store.deleteUserSessionsExcept(user.id, current);
      } else {
        await store.deleteUserSessions(user.id);
      }
      accountMail?.passwordChanged?.(request, user.id, 'changed', body.language);
      return reply.code(204).send();
    },
  );
}
