import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { configuredBaseUrl, isEmailAddress } from '../accountRules.js';
import type { Config } from '../config.js';
import { isTimeZone } from '../days.js';
import { confirmMail, MAX_BUDGET_MS, runDigests } from '../digest.js';
import { errorSummary, type Mailer } from '../mail.js';
import { mailSecret, readConfirmToken, readUnsubscribeToken, writeConfirmToken } from '../mailLinks.js';
import { GoogleKeys, verifyGoogleIdToken, type KeySource } from '../oidc.js';
import { requireSession } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import type { QualityService } from '../qualityService.js';
import { RateLimiter, RATE_LIMITED } from '../rateLimit.js';
import { emailChangedMail, longMoment, passwordChangedMail, resetLinkMail, SELF_RESET_TTL_MS, type SecurityContext } from '../securityMail.js';
import type { Store } from '../store/store.js';
import { DIGEST_KINDS, MAIL_LANGUAGES, type AccountMail, type DigestKind, type MailLanguage } from '../types.js';

export { MAX_EMAIL_LENGTH } from '../accountRules.js';

/** Confirmation mails per account (stored: changing the address does not start them again). */
export const CONFIRMATIONS_PER_HOUR = 3;
export const CONFIRMATIONS_PER_DAY = 6;
/** Confirmation mails per instance and hour, whoever asks (a bound on what the server can be made to send). */
export const CONFIRMATIONS_PER_INSTANCE_HOUR = 100;
/** Unsubscribe links that work, per address and minute (a mail program, a person pressing twice): generous, still bounded. */
export const UNSUBSCRIBES_PER_MINUTE = 600;
/** "Forgot your password?": reset mails per account and hour (quietly: the answer stays the same). */
export const RESET_MAILS_PER_ACCOUNT_HOUR = 3;
/** "Forgot your password?" requests per client IP and hour that are looked into (the others answer the same, doing nothing). */
export const FORGOT_PER_IP_HOUR = 10;
/** Reset mails per instance and hour, whoever asks. */
export const RESET_MAILS_PER_INSTANCE_HOUR = 100;
/** Accounts one address can name ("Forgot your password?" by email): each gets its own link. */
const MAX_ACCOUNTS_PER_ADDRESS = 5;
const HOUR_MS = 3_600_000;

/**
 * What other routes may ask of the mail routes: sign-up sends the confirmation link of the address
 * given there; a password change (account page, reset link) sends its security notice.
 */
export interface AccountMailHooks {
  sendConfirmation?: (request: FastifyRequest, userId: string, email: string, language: MailLanguage) => Promise<'sent' | 'too_many'>;
  /**
   * The notice "your password was changed", to the account's confirmed address, when mail delivers.
   * In the background: never awaited by the request, never throws (a failure is logged).
   */
  passwordChanged?: (request: FastifyRequest, userId: string, how: 'changed' | 'reset', language?: unknown) => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The mails sent after the answer (reset links, security notices): `idle()` waits for them (tests, closing). */
    mailWork?: BackgroundMail;
  }
}

/** Mails sent after the request was answered: kept so closing the server (and a test) can wait for them. */
export class BackgroundMail {
  private readonly pending = new Set<Promise<void>>();

  /** Runs `task` without making the request wait; a failure is logged with `what`, never thrown. */
  run(request: FastifyRequest, what: string, task: () => Promise<void>): void {
    const p = task()
      .catch((err) => request.log.warn({ err: errorSummary(err), mail: what }, 'account mail: could not be sent'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}

export interface MailRouteDeps {
  mailer: Mailer;
  /** Filled in here with sendConfirmation, for the sign-up route. */
  accountMail?: AccountMailHooks;
  quality: QualityService;
  states: ProjectStateCache;
  now: () => number;
  /** For tests: a lower cap per instance (confirmation mails, reset mails). */
  limits?: { perInstanceHour?: number; resetsPerInstanceHour?: number };
  /** For tests: Google's keys (the OIDC token); default: read from Google. */
  oidcKeys?: KeySource;
}

const bad = (reason: string) => ({ error: 'bad_request', reason });
/** The longest username or address "Forgot your password?" takes. */
const MAX_LOGIN_LENGTH = 254;
const isLanguage = (v: unknown): v is MailLanguage => (MAIL_LANGUAGES as readonly unknown[]).includes(v);
const TOO_MANY = { error: 'too_many_confirmations', reason: 'too many confirmation mails were sent for this account: try again in an hour' } as const;
const INVALID_STORED = { error: 'invalid_stored_email', reason: 'the address on the account is not one email address: type it again' } as const;

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

/** Counts per instance and hour (fixed windows). */
class HourlyCap {
  private start = 0;
  private count = 0;
  constructor(
    private readonly max: number,
    private readonly now: () => number,
  ) {}
  available(): boolean {
    if (this.now() - this.start >= 3_600_000) {
      this.start = this.now();
      this.count = 0;
    }
    return this.count < this.max;
  }
  take(): void {
    this.count += 1;
  }
}

/**
 * Email digests (Task 19, after its review).
 * - `GET /v1/me/notifications`, `PUT /v1/me/notifications { coordinator?, collector?, language, timeZone? }`:
 *   the account's weekly mails, off unless turned on; turning one on needs a valid address. No timeZone:
 *   the stored one stays.
 * - `PUT /v1/me/email { email | null, language? }`: sets the account's email (a new one is not confirmed;
 *   a mail with a link is sent to confirm it); `POST /v1/me/email/confirmation`: sends it again. At most
 *   3 an hour and 6 a day per account (stored), and CONFIRMATIONS_PER_INSTANCE_HOUR per instance.
 * - `POST /v1/email/confirm { token }` (no login): the link's page confirms the address.
 * - `POST /v1/unsubscribe/:token` (no login, RFC 8058 one-click; any body): turns that digest off;
 *   `GET` sends the browser to the dashboard's page, which asks before doing it.
 * - `POST /v1/internal/digest`: the weekly job, with `x-digest-secret: DIGEST_SECRET` or Cloud
 *   Scheduler's OIDC token (DIGEST_OIDC_AUDIENCE / DIGEST_OIDC_EMAIL); 404 while neither is set up.
 * Every link in a mail starts with the configured PUBLIC_BASE_URL (RENDER_EXTERNAL_URL), never with
 * anything from a request; a server that delivers mail does not start without it.
 */
export async function registerMailRoutes(app: FastifyInstance, store: Store, config: Config, limiter: RateLimiter, deps: MailRouteDeps): Promise<void> {
  const secret = mailSecret(config);
  const configured = configuredBaseUrl(config);
  if (configured === null && deps.mailer.delivers) {
    throw new Error('Mail is set up but PUBLIC_BASE_URL is not: the mails\' links need the address people open the dashboard at');
  }
  // Without SMTP nothing reaches anyone (the log transport never writes a link): a placeholder.
  const baseUrl = configured ?? 'http://localhost';
  const session = { preHandler: requireSession(store) };
  const perInstance = new HourlyCap(deps.limits?.perInstanceHour ?? CONFIRMATIONS_PER_INSTANCE_HOUR, deps.now);
  const unsubscribes = new RateLimiter(config.rateLimitPerMinute === 0 ? 0 : UNSUBSCRIBES_PER_MINUTE);
  const oidcKeys = deps.oidcKeys ?? new GoogleKeys();
  let running = false;
  const work = new BackgroundMail();
  app.decorate('mailWork', work);
  app.addHook('onClose', async () => work.idle());
  const resetCap = new HourlyCap(deps.limits?.resetsPerInstanceHour ?? RESET_MAILS_PER_INSTANCE_HOUR, deps.now);
  const forgotPerIp = new RateLimiter(config.rateLimitPerMinute === 0 ? 0 : FORGOT_PER_IP_HOUR, deps.now, { windowMs: HOUR_MS });
  // Always on (also where the request limits are off): it is what keeps a mailbox from being flooded.
  const resetsPerAccount = new RateLimiter(RESET_MAILS_PER_ACCOUNT_HOUR, deps.now, { windowMs: HOUR_MS });

  const view = async (userId: string, mail: AccountMail) => {
    const memberships = await store.listMemberships(userId);
    const digests = Object.fromEntries(
      DIGEST_KINDS.map((kind) => {
        const d = mail.digests.find((x) => x.kind === kind);
        return [
          kind,
          {
            on: d !== undefined && d.stoppedAt === null,
            // Turned off after the mail server refused the address several weeks in a row.
            stopped: d !== undefined && d.stoppedAt !== null,
            lastSentWeek: d?.lastSentWeek ?? null,
            lastMailedWeek: d?.lastMailedWeek ?? null,
            lastSentAt: d?.lastSentAt ?? null,
          },
        ];
      }),
    );
    return {
      email: mail.email,
      // False for an address stored before the rule (not one address): it must be typed again.
      emailValid: mail.email === null || isEmailAddress(mail.email),
      emailConfirmed: mail.email !== null && mail.emailConfirmedAt !== null,
      language: mail.language,
      timeZone: mail.timeZone,
      // False: this server has no SMTP set up, so no mail reaches anyone (the choices are kept).
      sends: deps.mailer.delivers,
      roles: { coordinator: memberships.some((m) => m.role === 'admin'), collector: memberships.some((m) => m.role !== 'admin') },
      digests,
    };
  };

  /** Sends the confirmation link to the account's address, within the caps. */
  const sendConfirmation = async (request: FastifyRequest, userId: string, email: string, language: MailLanguage): Promise<'sent' | 'too_many'> => {
    const at = deps.now();
    if (!perInstance.available()) return 'too_many';
    if (!(await store.reserveConfirmationSend(userId, at, { perHour: CONFIRMATIONS_PER_HOUR, perDay: CONFIRMATIONS_PER_DAY }))) return 'too_many';
    perInstance.take();
    const settings = await store.getSettings();
    const confirmUrl = `${baseUrl}/confirm-email/${writeConfirmToken(userId, email, secret, at)}`;
    try {
      await deps.mailer.send(confirmMail({ serverName: settings.serverName ?? 'Collect Earth Cloud', language, confirmUrl }, email));
    } catch (err) {
      request.log.warn({ err: errorSummary(err), userId }, 'email: the confirmation mail could not be sent');
      throw err;
    }
    return 'sent';
  };
  if (deps.accountMail) deps.accountMail.sendConfirmation = sendConfirmation;

  /** The confirmed address of an account that can be written to, with its mail settings; null otherwise. */
  const confirmedAddress = async (userId: string) => {
    const mail = await store.getAccountMail(userId);
    if (!mail || mail.email === null || mail.emailConfirmedAt === null || !isEmailAddress(mail.email)) return null;
    return { ...mail, email: mail.email };
  };

  /** What a security mail says of the server and the account; the language: the page's, else the account's, else English. */
  const securityContext = async (userId: string, language: unknown, mail: AccountMail): Promise<SecurityContext | null> => {
    const user = await store.getUserById(userId);
    if (!user) return null;
    const settings = await store.getSettings();
    return {
      serverName: settings.serverName ?? 'Collect Earth Cloud',
      language: isLanguage(language) ? language : (mail.language ?? 'en'),
      username: user.username,
      baseUrl,
      contactEmail: settings.contactEmail,
    };
  };

  const passwordChanged = (request: FastifyRequest, userId: string, how: 'changed' | 'reset', language?: unknown): void => {
    if (!deps.mailer.delivers) return;
    const at = deps.now();
    work.run(request, 'account.password-changed', async () => {
      const mail = await confirmedAddress(userId);
      const ctx = mail && (await securityContext(userId, language, mail));
      if (!mail || !ctx) return;
      await deps.mailer.send(passwordChangedMail(ctx, how, longMoment(at, ctx.language, mail.timeZone), mail.email));
    });
  };
  if (deps.accountMail) deps.accountMail.passwordChanged = passwordChanged;

  /**
   * "Forgot your password?" (no login): `{ login, language? }`, a username or an email address. When
   * mail delivers and the account (or each enabled account whose confirmed address it is) has a
   * CONFIRMED address and is not disabled, a reset link (SELF_RESET_TTL_MS, single use, the
   * administrator's links' table) is mailed to that address. The answer is always 202 and is sent
   * before anything is looked up (the work runs after it), so neither its content nor its timing
   * tells whether an account exists. Limits, all quiet: FORGOT_PER_IP_HOUR per client IP,
   * RESET_MAILS_PER_ACCOUNT_HOUR per account, RESET_MAILS_PER_INSTANCE_HOUR per instance; and the
   * shared per-minute limit per IP (429, as every public route).
   */
  app.post('/v1/auth/forgot', { preHandler: limiter.guard('forgot') }, async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const body = (request.body ?? {}) as { login?: unknown; language?: unknown };
    const login = typeof body.login === 'string' ? body.login.trim() : '';
    if (login === '' || login.length > MAX_LOGIN_LENGTH) return reply.code(400).send(bad('login must be a username or an email address'));
    if (!deps.mailer.delivers) {
      return reply.code(409).send({ error: 'not_available', reason: 'this server does not send email: ask its administrator for a password reset link' });
    }
    if (forgotPerIp.hit(`forgot ${request.ip}`)) {
      const language = body.language;
      work.run(request, 'account.reset', () => mailResetLinks(request, login, language));
    } else {
      request.log.info({ action: 'account.forgot.limited' }, 'forgot password: too many requests from this address, nothing done');
    }
    return reply.code(202).send({ accepted: true });
  });

  /** The work behind "Forgot your password?", after the answer. */
  const mailResetLinks = async (request: FastifyRequest, login: string, language: unknown): Promise<void> => {
    const ids = new Set<string>();
    const byName = await store.getUserByUsername(login);
    if (byName) ids.add(byName.id);
    if (isEmailAddress(login)) for (const id of await store.listUserIdsByConfirmedEmail(login, MAX_ACCOUNTS_PER_ADDRESS)) ids.add(id);
    for (const userId of ids) {
      const user = await store.getUserById(userId);
      if (!user || user.disabledAt) continue;
      const mail = await confirmedAddress(userId);
      if (!mail) continue;
      if (!resetsPerAccount.hit(`reset ${userId}`)) {
        request.log.info({ action: 'account.forgot.limited', userId }, 'forgot password: too many reset mails for this account, nothing sent');
        continue;
      }
      if (!resetCap.available()) {
        request.log.warn({ action: 'account.forgot.limited' }, 'forgot password: the reset mails of this instance for this hour are used up');
        return;
      }
      resetCap.take();
      // Date.now(), as the reset itself (admin.ts) reads the expiry with it. Null: disabled meanwhile.
      const token = await store.createPasswordReset(userId, Date.now() + SELF_RESET_TTL_MS);
      const ctx = token === null ? null : await securityContext(userId, language, mail);
      if (token === null || !ctx) continue;
      try {
        await deps.mailer.send(resetLinkMail(ctx, `${baseUrl}/reset/${token}`, mail.email));
        request.log.info({ action: 'account.forgot.sent', userId }, 'forgot password: a reset link was mailed');
      } catch (err) {
        request.log.warn({ err: errorSummary(err), userId }, 'forgot password: the reset mail could not be sent');
      }
    }
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
    if (DIGEST_KINDS.some((k) => body[k] === true)) {
      if (mail.email === null) return reply.code(409).send({ error: 'no_email', reason: 'give your account an email address first' });
      if (!isEmailAddress(mail.email)) return reply.code(409).send(INVALID_STORED);
    }
    // The language and zone the mails are written in: the dashboard's, when the person chose; a
    // zone the browser could not tell keeps the stored one.
    await store.setMailPreferences(userId, { language: body.language, timeZone: typeof body.timeZone === 'string' ? body.timeZone : mail.timeZone });
    for (const kind of DIGEST_KINDS) {
      if (typeof body[kind] === 'boolean') await store.setDigest(userId, kind, body[kind] as boolean, deps.now());
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
    if (email !== null && !isEmailAddress(email)) {
      return reply.code(400).send({ error: 'invalid_email', reason: 'that is not one email address' });
    }
    const before = await store.getAccountMail(userId);
    if (!before) return reply.code(401).send({ error: 'unauthorized' });
    const language = isLanguage(body.language) ? body.language : (before.language ?? 'en');
    if (before.email !== email) {
      await store.setEmail(userId, email);
      // A notice to the OLD address, when it was confirmed: the new one is shown only in part.
      const old = before.email;
      if (deps.mailer.delivers && old !== null && before.emailConfirmedAt !== null && isEmailAddress(old)) {
        const at = deps.now();
        work.run(request, 'account.email-changed', async () => {
          const ctx = await securityContext(userId, language, before);
          if (ctx) await deps.mailer.send(emailChangedMail(ctx, email, longMoment(at, ctx.language, before.timeZone), old));
        });
      }
      // No address: no mail can go, so the digests go off too.
      if (email === null) for (const kind of DIGEST_KINDS) await store.setDigest(userId, kind, false, deps.now());
      if (email !== null) {
        try {
          if ((await sendConfirmation(request, userId, email, language)) === 'too_many') {
            return reply.code(429).send({ ...TOO_MANY, reason: `the address is saved, but ${TOO_MANY.reason}` });
          }
        } catch {
          return reply.code(502).send({ error: 'mail_failed', reason: 'the address is saved, but the confirmation mail could not be sent: try again later' });
        }
      }
    }
    return reply.send(await view(userId, (await store.getAccountMail(userId))!));
  });

  app.post('/v1/me/email/confirmation', { preHandler: [requireSession(store), limiter.guard('email')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const mail = await store.getAccountMail(userId);
    if (!mail) return reply.code(401).send({ error: 'unauthorized' });
    if (mail.email === null) return reply.code(409).send({ error: 'no_email', reason: 'the account has no email address' });
    if (!isEmailAddress(mail.email)) return reply.code(409).send(INVALID_STORED);
    if (mail.emailConfirmedAt !== null) return reply.code(409).send({ error: 'already_confirmed', reason: 'the address is confirmed' });
    const body = (request.body ?? {}) as { language?: unknown };
    const language = isLanguage(body.language) ? body.language : (mail.language ?? 'en');
    try {
      if ((await sendConfirmation(request, userId, mail.email, language)) === 'too_many') return reply.code(429).send(TOO_MANY);
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
  // the body is not needed, so any is accepted (small) in this scope only. A link that works counts in
  // a generous bucket of its own; anything else in the shared `public` one.
  await app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 }, (_req, _body, done) => done(null, {}));
    scope.addHook('onRequest', async (_request, reply) => linkHeaders(reply));
    scope.post('/v1/unsubscribe/:token', { bodyLimit: 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
      const read = readUnsubscribeToken((request.params as { token: string }).token, secret);
      const allowed = read ? unsubscribes.hit(`unsubscribe ${request.ip}`) : limiter.hit(`public ${request.ip}`);
      if (!allowed) return reply.code(429).header('retry-after', '60').send(RATE_LIMITED);
      if (!read) return reply.code(404).send({ error: 'not_found', reason: 'the link is not valid' });
      await store.setDigest(read.userId, read.kind, false, deps.now());
      return reply.send({ unsubscribed: true, kind: read.kind });
    });
    scope.get('/v1/unsubscribe/:token', async (request: FastifyRequest, reply: FastifyReply) => {
      // Opened in a browser: the dashboard's page asks before turning it off (link checkers only GET).
      return reply.redirect(`/unsubscribe/${encodeURIComponent((request.params as { token: string }).token)}`, 303);
    });
  });

  /** Whether the job's caller is who DIGEST_SECRET or DIGEST_OIDC_* say. */
  const authorized = async (request: FastifyRequest): Promise<boolean> => {
    const given = request.headers['x-digest-secret'];
    if (config.digestSecret && typeof given === 'string' && secretsMatch(given, config.digestSecret)) return true;
    const auth = request.headers.authorization;
    if (config.digestOidc && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      try {
        return await verifyGoogleIdToken(auth.slice(7).trim(), { ...config.digestOidc, keys: oidcKeys, now: deps.now() });
      } catch (err) {
        request.log.warn({ err: { message: (err as Error).message } }, 'digest: the OIDC token could not be checked');
        return false;
      }
    }
    return false;
  };

  app.post('/v1/internal/digest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.digestSecret && !config.digestOidc) return reply.code(404).send({ error: 'not_found' });
    if (!(await authorized(request))) return reply.code(401).send({ error: 'unauthorized' });
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
        { baseUrl, budgetMs: budgetMs as number | undefined, maxMails: maxMails as number | undefined },
      );
      request.log.info({ digest: result }, 'digest: run ended');
      return reply.send(result);
    } finally {
      running = false;
    }
  });
}
