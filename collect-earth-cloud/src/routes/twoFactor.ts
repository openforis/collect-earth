import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyPassword } from '../password.js';
import { requirePlatformAdmin, requireSession } from '../plugins/projectAuth.js';
import type { RateLimiter } from '../rateLimit.js';
import type { Store } from '../store/store.js';
import {
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  matchStep,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
} from '../twoFactor.js';

/**
 * Checks the second step of a sign-in: an authenticator app's code (each used once) or one of the account's recovery
 * codes (each used once). 'ok' signs in; 'invalid' is a wrong code; 'unreadable' means the secret cannot be decrypted
 * any more (the server's key changed): only a recovery code, or the administrator's reset, gets the person in.
 */
export async function checkSecondStep(store: Store, key: Buffer, userId: string, code: string, now = Date.now()): Promise<'ok' | 'invalid' | 'unreadable'> {
  const state = await store.getTwoFactor(userId);
  if (!state?.enabledAt || !state.secretEnc) return 'ok';
  const typed = code.trim();
  if (looksLikeRecoveryCode(typed)) {
    return (await store.claimRecoveryCode(userId, hashRecoveryCode(typed))) ? 'ok' : 'invalid';
  }
  const secret = decryptSecret(state.secretEnc, key);
  if (!secret) return 'unreadable';
  const step = matchStep(secret, typed, now);
  if (step === null) return 'invalid';
  return (await store.claimTwoFactorStep(userId, step)) ? 'ok' : 'invalid';
}

/** Whether the account has two-step sign-in on. */
export async function twoFactorEnabled(store: Store, userId: string): Promise<boolean> {
  const state = await store.getTwoFactor(userId);
  return !!(state?.enabledAt && state.secretEnc);
}

/**
 * The account's own two-step sign-in (the account page) and the administrator's reset for a lost phone:
 *  - POST /v1/me/two-factor/setup: a new secret to scan (kept as pending until its first code is confirmed);
 *  - POST /v1/me/two-factor/enable {code}: the first code from the app turns it on and gives the recovery codes, once;
 *  - POST /v1/me/two-factor/disable {password}: off again (refused while the server requires it of the person);
 *  - POST /v1/me/two-factor/recovery-codes {password}: ten new codes, the old ones stop working;
 *  - POST /v1/admin/users/:uid/two-factor/reset: off for someone who lost their phone and their codes.
 */
export async function registerTwoFactorRoutes(app: FastifyInstance, store: Store, key: Buffer, limiter: RateLimiter, issuerOf: () => Promise<string>): Promise<void> {
  const session = { preHandler: requireSession(store) };

  app.post('/v1/me/two-factor/setup', session, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await store.getUserById(request.userId!);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (await twoFactorEnabled(store, user.id)) return reply.code(409).send({ error: 'already_enabled' });
    const secret = newSecret();
    await store.setTwoFactorPending(user.id, encryptSecret(secret, key));
    return reply.header('cache-control', 'no-store').send({ secret, uri: otpauthUri(await issuerOf(), user.username, secret) });
  });

  app.post('/v1/me/two-factor/enable', { preHandler: [limiter.guard('two-factor'), requireSession(store)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const code = String((request.body as { code?: unknown } | null)?.code ?? '');
    const state = await store.getTwoFactor(request.userId!);
    const secret = state?.pendingEnc ? decryptSecret(state.pendingEnc, key) : null;
    if (!secret) return reply.code(409).send({ error: 'no_setup', reason: 'start the setup first' });
    const step = matchStep(secret, code, Date.now());
    if (step === null) return reply.code(400).send({ error: 'invalid_code' });
    const codes = newRecoveryCodes();
    await store.enableTwoFactor(request.userId!, encryptSecret(secret, key), codes.map(hashRecoveryCode));
    await store.claimTwoFactorStep(request.userId!, step);
    // The other sessions were opened without the second step: they are signed out (this one stays)
    const token = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    await store.deleteUserSessionsExcept(request.userId!, token);
    return reply.header('cache-control', 'no-store').send({ recoveryCodes: codes });
  });

  const withPassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const password = String((request.body as { password?: unknown } | null)?.password ?? '');
    const user = await store.getUserById(request.userId!);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      reply.code(403).send({ error: 'wrong_password' });
      return null;
    }
    return user;
  };

  app.post('/v1/me/two-factor/disable', { preHandler: [limiter.guard('two-factor'), requireSession(store)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await withPassword(request, reply);
    if (!user) return reply;
    if (await twoFactorRequiredFor(store, user.id, user.isPlatformAdmin)) {
      return reply.code(409).send({ error: 'two_factor_required', reason: 'this server requires two-step sign-in of coordinators and administrators' });
    }
    await store.disableTwoFactor(user.id);
    return reply.code(204).send();
  });

  app.post('/v1/me/two-factor/recovery-codes', { preHandler: [limiter.guard('two-factor'), requireSession(store)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await withPassword(request, reply);
    if (!user) return reply;
    if (!(await twoFactorEnabled(store, user.id))) return reply.code(409).send({ error: 'not_enabled' });
    const codes = newRecoveryCodes();
    await store.setRecoveryHashes(user.id, codes.map(hashRecoveryCode));
    return reply.header('cache-control', 'no-store').send({ recoveryCodes: codes });
  });

  // A lost phone and lost recovery codes: the server's administrator turns two-step sign-in off; the account's sessions
  // end, and the person signs in with the password, then sets it up again (at once, if the server requires it)
  app.post('/v1/admin/users/:uid/two-factor/reset', { preHandler: requirePlatformAdmin(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const uid = (request.params as { uid: string }).uid;
    const user = await store.getUserById(uid).catch(() => null);
    if (!user) return reply.code(404).send({ error: 'not_found' });
    await store.disableTwoFactor(uid);
    await store.deleteUserSessions(uid);
    return reply.code(204).send();
  });
}

/** Whether the server requires two-step sign-in of this account: it coordinates a project, or administers the server. */
export async function twoFactorRequiredFor(store: Store, userId: string, isPlatformAdmin: boolean): Promise<boolean> {
  const settings = await store.getSettings();
  if (!settings.twoFactorForCoordinators) return false;
  if (isPlatformAdmin) return true;
  return (await store.listMemberships(userId)).some((m) => m.role === 'admin');
}
