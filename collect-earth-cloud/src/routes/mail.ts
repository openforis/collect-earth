import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicBaseUrl } from '../accountRules.js';
import { linkSecret } from '../backupLink.js';
import type { Config } from '../config.js';
import { isTimeZone } from '../days.js';
import { confirmMail, MAX_BUDGET_MS, runDigests } from '../digest.js';
import type { Mailer } from '../mail.js';
import { readConfirmToken, readUnsubscribeToken, writeConfirmToken } from '../mailLinks.js';
import { requireSession } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import type { QualityService } from '../qualityService.js';
import type { RateLimiter } from '../rateLimit.js';
import type { Store } from '../store/store.js';
import { DIGEST_KINDS, MAIL_LANGUAGES, type AccountMail, type DigestKind, type MailLanguage } from '../types.js';

/** The longest address accepted (RFC 5321's path limit). */
export const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** A confirmation mail is sent again at most this often per account (per instance). */
export const CONFIRM_RESEND_MS = 60_000;

export interface MailRouteDeps {
  mailer: Mailer;
  quality: QualityService;
  states: ProjectStateCache;
  now: () => number;
}

const bad = (reason: string) => ({ error: 'bad_request', reason });
const isLanguage = (v: unknown): v is MailLanguage => (MAIL_LANGUAGES as readonly unknown[]).includes(v);

/** Constant-time comparison of two secrets of any length (their sha256 compared). */
export function secretsMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Headers of the pages and answers a mail's link reaches: not indexed, no referrer, not kept. */
function linkHeaders(reply: FastifyReply): void {
  reply.header('x-robots-tag', 'noindex, nofollow');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('cache-control', 'no-store');
}

/**
 * Email digests (Task 19).
 * - `GET /v1/me/notifications`, `PUT /v1/me/notifications { coordinator?, collector?, language, timeZone }`:
 *   the account's weekly mails, off unless turned on; turning one on needs an email.
 * - `PUT /v1/me/email { email | null, language? }`: sets the account's email (a new one is not confirmed;
 *   a mail with a link is sent to confirm it); `POST /v1/me/email/confirmation`: sends it again.
 * - `POST /v1/email/confirm { token }` (no login): the link's page confirms the address.
 * - `POST /v1/unsubscribe/:token` (no login, RFC 8058 one-click; any body): turns that digest off;
 *   `GET` sends the browser to the dashboard's page, which asks before doing it.
 * - `POST /v1/internal/digest` with `x-digest-secret: DIGEST_SECRET`: the weekly job (Cloud Scheduler);
 *   404 while DIGEST_SECRET is unset.
 */
export async function registerMailRoutes(app: FastifyInstance, store: Store, config: Config, limiter: RateLimiter, deps: MailRouteDeps): Promise<void> {
  const secret = linkSecret(config);
  const session = { preHandler: requireSession(store) };
  const lastConfirmation = new Map<string, number>();
  let running = false;

  const view = async (userId: string, mail: AccountMail) => {
    const memberships = await store.listMemberships(userId);
    const digests = Object.fromEntries(
      DIGEST_KINDS.map((kind) => {
        const d = mail.digests.find((x) => x.kind === kind);
        return [kind, { on: d !== undefined, lastSentWeek: d?.lastSentWeek ?? null, lastSentAt: d?.lastSentAt ?? null }];
      }),
    ) as Record<DigestKind, { on: boolean; lastSentWeek: string | null; lastSentAt: number | null }>;
    return {
      email: mail.email,
      emailConfirmed: mail.email !== null && mail.emailConfirmedAt !== null,
      language: mail.language,
      timeZone: mail.timeZone,
      // False: this server has no SMTP set up, so no mail reaches anyone (the choices are kept).
      sends: deps.mailer.delivers,
      roles: { coordinator: memberships.some((m) => m.role === 'admin'), collector: memberships.some((m) => m.role !== 'admin') },
      digests,
    };
  };

  /** Sends the confirmation link to the account's address (refused within CONFIRM_RESEND_MS of the last). */
  const sendConfirmation = async (request: FastifyRequest, userId: string, username: string, email: string, language: MailLanguage): Promise<'sent' | 'too_soon'> => {
    const at = deps.now();
    const last = lastConfirmation.get(userId);
    if (last !== undefined && at - last < CONFIRM_RESEND_MS) return 'too_soon';
    lastConfirmation.set(userId, at);
    if (lastConfirmation.size > 10_000) lastConfirmation.delete(lastConfirmation.keys().next().value!);
    const settings = await store.getSettings();
    const confirmUrl = `${publicBaseUrl(config, request)}/confirm-email/${writeConfirmToken(userId, email, secret, at)}`;
    try {
      await deps.mailer.send(confirmMail({ serverName: settings.serverName ?? 'Collect Earth Cloud', language, username, confirmUrl }, email));
    } catch (err) {
      lastConfirmation.delete(userId);
      request.log.warn({ err: { message: (err as Error).message }, userId }, 'email: the confirmation mail could not be sent');
      throw err;
    }
    return 'sent';
  };

  app.get('/v1/me/notifications', session, async (request: FastifyRequest, reply: FastifyReply) => {
    const mail = await store.getAccountMail(request.userId!);
    if (!mail) return reply.code(401).send({ error: 'unauthorized' });
    return reply.send(await view(request.userId!, mail));
  });

  app.put('/v1/me/notifications', session, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const body = (request.body ?? {}) as Partial<Record<DigestKind, unknown>> & { language?: unknown; timeZone?: unknown };
    for (const kind of DIGEST_KINDS) {
      if (body[kind] !== undefined && typeof body[kind] !== 'boolean') return reply.code(400).send(bad(`${kind} must be true or false`));
    }
    if (!isLanguage(body.language)) return reply.code(400).send(bad(`language must be one of ${MAIL_LANGUAGES.join(', ')}`));
    if (body.timeZone !== undefined && body.timeZone !== null && !isTimeZone(body.timeZone)) return reply.code(400).send(bad('timeZone must be an IANA time zone'));
    const mail = await store.getAccountMail(userId);
    if (!mail) return reply.code(401).send({ error: 'unauthorized' });
    if (DIGEST_KINDS.some((k) => body[k] === true) && mail.email === null) {
      return reply.code(409).send({ error: 'no_email', reason: 'give your account an email address first' });
    }
    // The language and zone the mails are written in: the dashboard's, when the person chose.
    await store.setMailPreferences(userId, { language: body.language, timeZone: typeof body.timeZone === 'string' ? body.timeZone : null });
    for (const kind of DIGEST_KINDS) {
      if (typeof body[kind] === 'boolean') await store.setDigest(userId, kind, body[kind] as boolean);
    }
    return reply.send(await view(userId, (await store.getAccountMail(userId))!));
  });

  app.put('/v1/me/email', { preHandler: [requireSession(store), limiter.guard('email')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const body = (request.body ?? {}) as { email?: unknown; language?: unknown };
    let email: string | null;
    if (body.email === null || (typeof body.email === 'string' && body.email.trim() === '')) email = null;
    else if (typeof body.email === 'string') email = body.email.trim();
    else return reply.code(400).send(bad('email must be an address, or null to remove it'));
    if (email !== null && (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))) {
      return reply.code(400).send({ error: 'invalid_email', reason: 'that is not an email address' });
    }
    const [user, before] = await Promise.all([store.getUserById(userId), store.getAccountMail(userId)]);
    if (!user || !before) return reply.code(401).send({ error: 'unauthorized' });
    const language = isLanguage(body.language) ? body.language : (before.language ?? 'en');
    if (before.email !== email) {
      await store.setEmail(userId, email);
      // No address: no mail can go, so the digests go off too.
      if (email === null) for (const kind of DIGEST_KINDS) await store.setDigest(userId, kind, false);
      lastConfirmation.delete(userId);
      if (email !== null) {
        try {
          await sendConfirmation(request, userId, user.username, email, language);
        } catch {
          return reply.code(502).send({ error: 'mail_failed', reason: 'the address is saved, but the confirmation mail could not be sent: try again later' });
        }
      }
    }
    return reply.send(await view(userId, (await store.getAccountMail(userId))!));
  });

  app.post('/v1/me/email/confirmation', { preHandler: [requireSession(store), limiter.guard('email')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const [user, mail] = await Promise.all([store.getUserById(userId), store.getAccountMail(userId)]);
    if (!user || !mail) return reply.code(401).send({ error: 'unauthorized' });
    if (mail.email === null) return reply.code(409).send({ error: 'no_email', reason: 'the account has no email address' });
    if (mail.emailConfirmedAt !== null) return reply.code(409).send({ error: 'already_confirmed', reason: 'the address is confirmed' });
    const body = (request.body ?? {}) as { language?: unknown };
    const language = isLanguage(body.language) ? body.language : (mail.language ?? 'en');
    try {
      if ((await sendConfirmation(request, userId, user.username, mail.email, language)) === 'too_soon') {
        return reply.code(429).send({ error: 'too_soon', reason: 'a confirmation mail was sent less than a minute ago' });
      }
    } catch {
      return reply.code(502).send({ error: 'mail_failed', reason: 'the confirmation mail could not be sent: try again later' });
    }
    return reply.code(202).send({ sent: true });
  });

  app.post('/v1/email/confirm', { preHandler: limiter.guard('public') }, async (request: FastifyRequest, reply: FastifyReply) => {
    linkHeaders(reply);
    const token = ((request.body ?? {}) as { token?: unknown }).token;
    const read = readConfirmToken(token, secret, deps.now());
    if (read === 'expired') return reply.code(410).send({ error: 'confirm_expired', reason: 'the link has expired: send a new one from your account page' });
    const mail = read ? await store.getAccountMail(read.userId) : null;
    if (!read || !mail || mail.email === null || !read.matches(mail.email)) {
      return reply.code(404).send({ error: 'not_found', reason: 'the link is not valid, or the address was changed since' });
    }
    await store.confirmEmail(read.userId, mail.email, deps.now());
    return reply.send({ confirmed: true });
  });

  // One-click unsubscribing (RFC 8058): mail programs POST "List-Unsubscribe=One-Click" as a form;
  // the body is not needed, so any is accepted (small) in this scope only.
  await app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 }, (_req, _body, done) => done(null, {}));
    scope.addHook('onRequest', async (_request, reply) => linkHeaders(reply));
    scope.post('/v1/unsubscribe/:token', { preHandler: limiter.guard('public'), bodyLimit: 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
      const read = readUnsubscribeToken((request.params as { token: string }).token, secret);
      if (!read) return reply.code(404).send({ error: 'not_found', reason: 'the link is not valid' });
      await store.setDigest(read.userId, read.kind, false);
      return reply.send({ unsubscribed: true, kind: read.kind });
    });
    scope.get('/v1/unsubscribe/:token', async (request: FastifyRequest, reply: FastifyReply) => {
      // Opened in a browser: the dashboard's page asks before turning it off (link checkers only GET).
      return reply.redirect(`/unsubscribe/${encodeURIComponent((request.params as { token: string }).token)}`, 303);
    });
  });

  app.post('/v1/internal/digest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.digestSecret) return reply.code(404).send({ error: 'not_found' });
    const given = request.headers['x-digest-secret'];
    if (typeof given !== 'string' || !secretsMatch(given, config.digestSecret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = (request.body ?? {}) as { budgetMs?: unknown; maxMails?: unknown };
    const budgetMs = body.budgetMs;
    const maxMails = body.maxMails;
    if (budgetMs !== undefined && (!Number.isInteger(budgetMs) || (budgetMs as number) < 1 || (budgetMs as number) > MAX_BUDGET_MS)) {
      return reply.code(400).send(bad(`budgetMs must be a whole number of ms from 1 to ${MAX_BUDGET_MS}`));
    }
    if (maxMails !== undefined && (!Number.isInteger(maxMails) || (maxMails as number) < 1 || (maxMails as number) > 10_000)) {
      return reply.code(400).send(bad('maxMails must be a whole number from 1 to 10000'));
    }
    // One run per instance at a time (a retry while the first still runs); runs on several instances
    // are safe too: each week is claimed before its mail goes.
    if (running) return reply.code(409).send({ error: 'digest_running', reason: 'a run is going on: try again when it ends' });
    running = true;
    try {
      const result = await runDigests(
        { store, quality: deps.quality, states: deps.states, mailer: deps.mailer, secret, log: request.log, now: deps.now },
        { baseUrl: publicBaseUrl(config, request), budgetMs: budgetMs as number | undefined, maxMails: maxMails as number | undefined },
      );
      request.log.info({ digest: result }, 'digest: run ended');
      return reply.send(result);
    } finally {
      running = false;
    }
  });
}
