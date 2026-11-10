import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import type { Config } from '../src/config.js';
import { dueWeek } from '../src/digest.js';
import { TestMailer, type MailMessage } from '../src/mail.js';
import { buildServer } from '../src/server.js';
import { weekMonday } from '../src/weekly.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { idToken, otherKey, testKeys } from './oidcKeys.js';

const DAY = 86_400_000;
const DIGEST_SECRET = 'a-digest-secret-of-at-least-32-characters';

describe('email digests (Task 19)', () => {
  let ctx: TestContext;
  let mailer: TestMailer;
  let clock: number;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let jose: { token: string; userId: string };

  const config: Partial<Config> = { digestSecret: DIGEST_SECRET, publicBaseUrl: 'https://ce.example.org' };
  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  // A change of address asks for the password: the owner's (setupPlatformAdmin), else password12
  const me = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown) =>
    ctx.app.inject({
      method, url: `/v1/me${path}`, headers: bearer(token),
      payload: (method === 'PUT' && path === '/email' ? { currentPassword: token === owner.token ? 'owner-password' : 'password12', ...(payload as object) } : payload) as never,
    });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };
  const digest = (headers: Record<string, string> = { 'x-digest-secret': DIGEST_SECRET }, payload?: unknown, app = ctx.app) =>
    app.inject({ method: 'POST', url: '/v1/internal/digest', headers, payload: payload as never });
  /** The link of the last confirmation mail sent to `to`. */
  const confirmLink = (to: string) => {
    const mail = [...mailer.sent].reverse().find((m) => m.to === to && m.tag === 'email.confirm');
    return /\/confirm-email\/([A-Za-z0-9_.-]+)/.exec(mail?.text ?? '')?.[1] ?? null;
  };
  /** Gives the account an email, confirms it and turns a digest on. */
  const subscribe = async (who: { token: string }, email: string, kinds: { coordinator?: boolean; collector?: boolean }, language = 'en', timeZone = 'UTC') => {
    // Subscribed a week before the server's clock: a subscription never gets a week that ended before it.
    const at = clock;
    clock -= 7 * DAY;
    try {
      return await subscribeNow(who, email, kinds, language, timeZone);
    } finally {
      clock = at;
    }
  };
  const subscribeNow = async (who: { token: string }, email: string, kinds: { coordinator?: boolean; collector?: boolean }, language: string, timeZone: string) => {
    expect((await me('PUT', '/email', who.token, { email, language })).statusCode).toBe(200);
    const token = confirmLink(email);
    expect(token).not.toBeNull();
    const confirmed = await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const res = await me('PUT', '/notifications', who.token, { ...kinds, language, timeZone });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  /** A project of its own (tests that make one): plot 1 done in the digest's week, so the week has news. */
  const plotDoneInTheWeek = async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const monday = Date.parse(`${weekMonday(dueWeek(clock, 'UTC'))}T12:00:00Z`);
    await batchRequest(ctx.app, pid, owner.token, [envelope({ recordKey: '1', operator: 'owner', modifiedOn: monday + DAY, activelySaved: true })]);
  };
  const digests = (to?: string) => mailer.sent.filter((m) => m.tag.startsWith('digest.') && (to === undefined || m.to === to));

  beforeEach(async () => {
    mailer = new TestMailer();
    // The server's clock is 10 days ahead: everyone last synced 10 days "ago" (quiet), and the week
    // the digest tells about is the one before the server's.
    clock = Date.now() + 10 * DAY;
    ctx = await makeContext(config, { mailer, ai: { now: () => clock } });
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Forest inventory' } })).json().projectId;
    maria = await join('maria', 'operator');
    jose = await join('jose', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = (await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n', { 'content-type': 'text/csv' })).json().id;
    const more = (await call('PUT', '/csv-files/more.csv', owner.token, 'id,lat,lon\n5,0,0\n6,0,0\n', { 'content-type': 'text/csv' })).json().id;
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csv }, { userId: jose.userId, csvFileId: more }] });
    // A divided file: jose holds 7 and 8, maria holds 7 as a quality-check copy and checked it.
    const div = (await call('PUT', '/csv-files/div.csv', owner.token, 'id,lat,lon\n7,0,0\n8,0,0\n', { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setDivision(pid, div, { mode: 'manual' }, [
      { plotKey: '7', userId: jose.userId, overlap: false },
      { plotKey: '8', userId: jose.userId, overlap: false },
      { plotKey: '7', userId: maria.userId, overlap: true },
    ]);
    // The digest's week (UTC): Tuesday and Wednesday of it.
    const monday = Date.parse(`${weekMonday(dueWeek(clock, 'UTC'))}T12:00:00Z`);
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: monday + DAY, activelySaved: true, summary: { secret_answer: 'ForestSecretAnswer' } }),
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: monday + 2 * DAY, activelySaved: true }),
      // Before the week.
      envelope({ recordKey: '3', operator: 'maria', modifiedOn: monday - 3 * DAY, activelySaved: true }),
    ]);
    await batchRequest(ctx.app, pid, jose.token, [envelope({ recordKey: '7', operator: 'jose', modifiedOn: monday + DAY, activelySaved: true })]);
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '7', operator: 'maria', modifiedOn: monday + 2 * DAY, activelySaved: true })]);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('off by default: nobody is subscribed, and without an email a digest cannot be turned on', async () => {
    const view = (await me('GET', '/notifications', maria.token)).json();
    expect(view).toMatchObject({ email: null, emailConfirmed: false, sends: true, roles: { coordinator: false, collector: true }, digests: { coordinator: { on: false }, collector: { on: false } } });
    expect((await me('GET', '/notifications', owner.token)).json().roles).toEqual({ coordinator: true, collector: false });
    const refused = await me('PUT', '/notifications', maria.token, { collector: true, language: 'en', timeZone: 'UTC' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('no_email');
    expect((await me('PUT', '/notifications', maria.token, { collector: 'yes', language: 'en' })).statusCode).toBe(400);
    expect((await me('PUT', '/notifications', maria.token, { collector: false, language: 'xx' })).statusCode).toBe(400);
    expect((await me('PUT', '/notifications', maria.token, { collector: false, language: 'en', timeZone: 'Mars/Base' })).statusCode).toBe(400);
    const run = await digest();
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json()).toMatchObject({ transport: 'test', sent: 0, skipped: 0, more: false });
    expect(mailer.sent).toHaveLength(0);
  });

  it('an email is confirmed by its link; a new address needs a new confirmation; old links and changed ones do nothing', async () => {
    expect((await me('PUT', '/email', maria.token, { email: 'not an address' })).statusCode).toBe(400);
    for (const bad of ['a@example.org,b@example.org', 'a@example.org; b@example.org', 'a b@example.org']) {
      expect((await me('PUT', '/email', maria.token, { email: bad })).json().error, bad).toBe('invalid_email');
    }
    const set = await me('PUT', '/email', maria.token, { email: 'maria@example.org', language: 'es' });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({ email: 'maria@example.org', emailConfirmed: false });
    const mail = mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: 'maria@example.org', tag: 'email.confirm' });
    expect(mail.subject).toContain('confirme su dirección');
    // The address may not be maria's: the mail does not name her account.
    expect(mail.text).not.toContain('maria ');
    expect(mail.text).toContain('una cuenta en');
    const first = confirmLink('maria@example.org')!;
    // A changed address: the first link no longer confirms anything.
    await me('PUT', '/email', maria.token, { email: 'maria2@example.org' });
    const stale = await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token: first } });
    expect(stale.statusCode).toBe(404);
    expect(stale.headers['cache-control']).toBe('no-store');
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token: 'nonsense' } })).statusCode).toBe(404);
    const second = confirmLink('maria2@example.org')!;
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token: second } })).statusCode).toBe(200);
    expect((await me('GET', '/notifications', maria.token)).json()).toMatchObject({ email: 'maria2@example.org', emailConfirmed: true });
    expect((await me('POST', '/email/confirmation', maria.token)).statusCode).toBe(409);
    // Expired after 3 days.
    clock += 2 * 3_600_000;
    await me('PUT', '/email', maria.token, { email: 'maria3@example.org' });
    const third = confirmLink('maria3@example.org')!;
    clock += 3 * DAY + 1;
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token: third } })).statusCode).toBe(410);
    // Removing the address turns the digests off.
    clock -= 3 * DAY + 1;
    await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token: third } });
    await me('PUT', '/notifications', maria.token, { collector: true, language: 'en', timeZone: 'UTC' });
    const removed = (await me('PUT', '/email', maria.token, { email: null })).json();
    expect(removed).toMatchObject({ email: null, emailConfirmed: false, digests: { collector: { on: false } } });
  });

  it('confirmation mails: 3 an hour and 6 a day per account, changing the address does not reset it, and a cap per instance', async () => {
    const sent = () => mailer.sent.filter((m) => m.tag === 'email.confirm').length;
    expect((await me('PUT', '/email', maria.token, { email: 'a1@example.org' })).statusCode).toBe(200);
    expect((await me('POST', '/email/confirmation', maria.token)).statusCode).toBe(202);
    expect((await me('PUT', '/email', maria.token, { email: 'a2@example.org' })).statusCode).toBe(200);
    expect(sent()).toBe(3);
    // A fourth within the hour: the address is saved, no mail goes.
    const fourth = await me('PUT', '/email', maria.token, { email: 'a3@example.org' });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error).toBe('too_many_confirmations');
    expect((await me('GET', '/notifications', maria.token)).json().email).toBe('a3@example.org');
    expect((await me('POST', '/email/confirmation', maria.token)).json().error).toBe('too_many_confirmations');
    expect(sent()).toBe(3);
    // An hour later, 3 more; then the day's 6 are used.
    clock += 3_600_001;
    for (let i = 0; i < 3; i++) expect((await me('POST', '/email/confirmation', maria.token)).statusCode).toBe(202);
    clock += 3_600_001;
    expect((await me('POST', '/email/confirmation', maria.token)).statusCode).toBe(429);
    expect(sent()).toBe(6);
    clock += DAY;
    expect((await me('POST', '/email/confirmation', maria.token)).statusCode).toBe(202);

    // Per instance: at most `perInstanceHour` confirmation mails an hour, whoever asks.
    await ctx.app.close();
    mailer = new TestMailer();
    ctx = await makeContext(config, { mailer, ai: { now: () => clock }, mailLimits: { perInstanceHour: 2 } });
    owner = await setupPlatformAdmin(ctx.app);
    expect((await me('PUT', '/email', owner.token, { email: 'o1@example.org' })).statusCode).toBe(200);
    expect((await me('POST', '/email/confirmation', owner.token)).statusCode).toBe(202);
    expect((await me('POST', '/email/confirmation', owner.token)).json().error).toBe('too_many_confirmations');
  });

  it('an address given at sign-up gets its confirmation link, in the page\'s language; none given, no mail; a failed send keeps the account', async () => {
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { signupOpen: true } })).statusCode).toBe(200);
    const sentBefore = mailer.sent.length;
    const signup = (payload: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { password: 'password12', ...payload } });
    const olga = await signup({ username: 'olga', email: 'olga@example.org', language: 'es' });
    expect(olga.statusCode, olga.body).toBe(201);
    const mail = mailer.sent.find((m) => m.to === 'olga@example.org' && m.tag === 'email.confirm');
    expect(mail).toBeDefined();
    // Written in the language given (another person's, in English, reads differently).
    expect((await signup({ username: 'rosa', email: 'rosa@example.org', language: 'en' })).statusCode).toBe(201);
    const english = mailer.sent.find((m) => m.to === 'rosa@example.org' && m.tag === 'email.confirm');
    expect(english).toBeDefined();
    expect(mail!.subject).not.toBe(english!.subject);
    const token = confirmLink('olga@example.org');
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token } })).statusCode).toBe(200);
    expect((await me('GET', '/notifications', olga.json().token)).json()).toMatchObject({ email: 'olga@example.org', emailConfirmed: true });
    // No address: no mail.
    const count = mailer.sent.length;
    expect((await signup({ username: 'pavel' })).statusCode).toBe(201);
    expect(mailer.sent.length).toBe(count);
    // The mail server refuses: the account is made all the same, the link can be sent again later.
    mailer.fail = (m) => m.to === 'quinn@example.org';
    expect((await signup({ username: 'quinn', email: 'quinn@example.org' })).statusCode).toBe(201);
    mailer.fail = null;
    expect(mailer.sent.length).toBeGreaterThan(sentBefore);
  });

  it('a stored address that is not one address (an old sign-up) is refused before any mail: re-enter it', async () => {
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { signupOpen: true } })).statusCode).toBe(200);
    const bad = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'newbie', password: 'password12', email: 'a@example.org, b@example.org' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_email');
    const ok = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'newbie', password: 'password12', email: 'newbie@example.org' } });
    expect(ok.statusCode, ok.body).toBe(201);
    // An address stored before the rule (written to the store as an older server would have).
    await ctx.store.setEmail(maria.userId, 'a@example.org;b@example.org');
    await ctx.store.confirmEmail(maria.userId, 'a@example.org;b@example.org', clock);
    const view = (await me('GET', '/notifications', maria.token)).json();
    expect(view).toMatchObject({ emailValid: false });
    expect((await me('POST', '/email/confirmation', maria.token)).json().error).toBe('invalid_stored_email');
    expect((await me('PUT', '/notifications', maria.token, { collector: true, language: 'en' })).json().error).toBe('invalid_stored_email');
    await ctx.store.setDigest(maria.userId, 'collector', true, clock - 7 * DAY);
    const run = (await digest()).json();
    expect(run).toMatchObject({ sent: 0, skipped: 1 });
    expect(mailer.sent.filter((m) => m.to.includes('b@example.org'))).toHaveLength(0);
  });

  it("the mails' links come from PUBLIC_BASE_URL, never from the request's Host or X-Forwarded-Host", async () => {
    const spoof = { host: 'evil.example.net', 'x-forwarded-host': 'evil.example.net', 'x-forwarded-proto': 'http' };
    await ctx.app.inject({ method: 'PUT', url: '/v1/me/email', headers: { ...bearer(maria.token), ...spoof }, payload: { email: 'maria@example.org', currentPassword: 'password12' } });
    const confirm = mailer.sent.at(-1)!;
    expect(confirm.text).toContain('https://ce.example.org/confirm-email/');
    expect(confirm.text + confirm.html).not.toContain('evil');
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    await ctx.app.inject({ method: 'POST', url: '/v1/internal/digest', headers: { 'x-digest-secret': DIGEST_SECRET, ...spoof } });
    const weekly = digests('owner@example.org')[0];
    expect(weekly.text).toContain('https://ce.example.org/projects/');
    expect(weekly.text + weekly.html + JSON.stringify(weekly.headers)).not.toContain('evil');
    // A server that can send mail does not start without the address to put in them.
    await expect(buildServer({ store: ctx.store, config: { port: 0, host: '127.0.0.1', storeBackend: 'memory' }, webDir: null, mailer })).rejects.toThrow(/PUBLIC_BASE_URL/);
  });

  it('a new subscription never gets a week that ended before it', async () => {
    await subscribeNow(owner, 'owner@example.org', { coordinator: true }, 'en', 'UTC');
    expect((await digest()).json()).toMatchObject({ sent: 0 });
    clock += 7 * DAY;
    expect((await digest()).json()).toMatchObject({ sent: 1 });
  });

  it('a mail server refusing the address for good (5xx) three weeks in a row turns the digest off, and the card says so', async () => {
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    mailer.fail = () => true;
    mailer.failWith = { responseCode: 550, code: 'EENVELOPE', command: 'RCPT TO' };
    for (let i = 0; i < 3; i++) {
      // Refused for good: the week is not tried again.
      expect((await digest()).json(), String(i)).toMatchObject({ failed: 1 });
      expect((await digest()).json()).toMatchObject({ failed: 0, sent: 0 });
      clock += 7 * DAY;
    }
    const view = (await me('GET', '/notifications', owner.token)).json();
    expect(view.digests.coordinator).toMatchObject({ on: false, stopped: true });
    expect((await digest()).json()).toMatchObject({ failed: 0, sent: 0 });
    // Turned on again: it goes when the mail server takes it.
    mailer.fail = null;
    const again = (await me('PUT', '/notifications', owner.token, { coordinator: true, language: 'en' })).json();
    expect(again.digests.coordinator).toMatchObject({ on: true, stopped: false });
    clock += 7 * DAY;
    expect((await digest()).json()).toMatchObject({ sent: 1 });
    expect((await me('GET', '/notifications', owner.token)).json().digests.coordinator).toMatchObject({ lastMailedWeek: dueWeek(clock, 'UTC') });
  });

  it('the card says when a mail last went, not when a week was passed over; the zone is kept when none is sent', async () => {
    await subscribe(maria, 'maria@example.org', { collector: true }, 'en', 'Europe/Paris');
    // maria leaves: her week has nothing to tell.
    await call('DELETE', `/members/${maria.userId}`, owner.token);
    expect((await digest()).json()).toMatchObject({ empty: 1 });
    const view = (await me('GET', '/notifications', maria.token)).json();
    expect(view.digests.collector).toMatchObject({ lastMailedWeek: null, lastSentAt: null });
    expect((await me('PUT', '/notifications', maria.token, { collector: true, language: 'fr' })).json()).toMatchObject({ language: 'fr', timeZone: 'Europe/Paris' });
  });

  it('unsubscribe links that work are not held back by the shared per-address limit; others are', async () => {
    await ctx.app.close();
    mailer = new TestMailer();
    ctx = await makeContext({ ...config, rateLimitPerMinute: 3 }, { mailer, ai: { now: () => clock } });
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'P' } })).json().projectId;
    await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n', { 'content-type': 'text/csv' });
    await plotDoneInTheWeek();
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    expect((await digest()).json()).toMatchObject({ sent: 1 });
    const link = new URL(/^<(.+)>$/.exec(digests()[0].headers!['List-Unsubscribe'])![1]).pathname;
    for (let i = 0; i < 8; i++) expect((await ctx.app.inject({ method: 'POST', url: link })).statusCode, String(i)).toBe(200);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await ctx.app.inject({ method: 'POST', url: '/v1/unsubscribe/not.valid' })).statusCode);
    expect(codes).toContain(429);
  });

  it('the secret: off without DIGEST_SECRET, refused without the header or with a wrong one', async () => {
    expect((await digest({})).statusCode).toBe(401);
    expect((await digest({ 'x-digest-secret': 'wrong' })).statusCode).toBe(401);
    expect((await digest({ 'x-digest-secret': `${DIGEST_SECRET}x` })).statusCode).toBe(401);
    expect((await digest({ 'x-digest-secret': DIGEST_SECRET.slice(0, -1) })).statusCode).toBe(401);
    // A session is no substitute.
    expect((await digest(bearer(owner.token))).statusCode).toBe(401);
    expect((await digest(undefined, { budgetMs: -1 })).statusCode).toBe(400);
    expect((await digest(undefined, { maxMails: 0 })).statusCode).toBe(400);
    const off = await makeContext({ publicBaseUrl: 'https://ce.example.org' }, { mailer });
    try {
      expect((await digest({ 'x-digest-secret': DIGEST_SECRET }, undefined, off.app)).statusCode).toBe(404);
    } finally {
      await off.app.close();
    }
  });

  it("Cloud Scheduler's OIDC token is accepted when set up: Google-signed, this audience, this service account", async () => {
    const audience = 'https://ce.example.org/v1/internal/digest';
    const email = 'scheduler@p.iam.gserviceaccount.com';
    const oidc = await makeContext({ publicBaseUrl: 'https://ce.example.org', digestOidc: { audience, email } }, { mailer, ai: { now: () => clock }, oidcKeys: testKeys });
    const claims = { iss: 'https://accounts.google.com', aud: audience, email, email_verified: true, iat: Math.floor(clock / 1000) - 5, exp: Math.floor(clock / 1000) + 3000 };
    const run = (authorization: string) => oidc.app.inject({ method: 'POST', url: '/v1/internal/digest', headers: { authorization } });
    try {
      expect((await run(`Bearer ${idToken(claims)}`)).statusCode).toBe(200);
      expect((await run(`Bearer ${idToken({ ...claims, aud: 'https://other.example.org' })}`)).statusCode).toBe(401);
      expect((await run(`Bearer ${idToken({ ...claims, email: 'x@p.iam.gserviceaccount.com' })}`)).statusCode).toBe(401);
      expect((await run(`Bearer ${idToken(claims, { key: otherKey.privateKey })}`)).statusCode).toBe(401);
      expect((await run('Bearer nonsense')).statusCode).toBe(401);
      // No DIGEST_SECRET there: the header does nothing.
      expect((await oidc.app.inject({ method: 'POST', url: '/v1/internal/digest', headers: { 'x-digest-secret': DIGEST_SECRET } })).statusCode).toBe(401);
    } finally {
      await oidc.app.close();
    }
  });

  it("the weekly mails: the coordinator's summary with the quiet people and a link, the collector's own week as My work counts it, never twice", async () => {
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    await subscribe(maria, 'maria@example.org', { collector: true }, 'fr', 'Europe/Paris');
    const run = await digest();
    expect(run.statusCode, run.body).toBe(200);
    const week = dueWeek(clock, 'UTC');
    expect(run.json()).toMatchObject({ transport: 'test', week, sent: 2, failed: 0, more: false });

    const coordinator = digests('owner@example.org');
    expect(coordinator).toHaveLength(1);
    const c = coordinator[0];
    expect(c.subject).toContain('weekly summary');
    expect(c.text).toContain('Project: Forest inventory');
    // Plots first submitted in the week: 1, 2 and 7 (jose's); maria's check of 7 is a check.
    expect(c.text).toContain('Plots done this week: 3');
    expect(c.text).toContain('Quality checks done this week: 1');
    expect(c.text).toContain('Plots done in all: 4 of 8');
    // Everyone synced 10 days before the server's clock and has plots left: quiet.
    expect(c.text).toMatch(/Quiet for more than 3 days[^\n]*:\n {2}- jose\n {2}- maria/);
    expect(c.text).toContain(`https://ce.example.org/projects/${pid}/activity/week/${week}`);
    expect(c.text).not.toContain('ForestSecretAnswer');
    expect(c.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/ce\.example\.org\/v1\/unsubscribe\/[^>]+>$/);
    expect(c.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const collector = digests('maria@example.org');
    expect(collector).toHaveLength(1);
    const m = collector[0];
    expect(m.subject).toContain('votre semaine');
    // My work's own numbers: the copy of 7 is a plot like the others.
    const mine = (await call('GET', '/my-work?tz=Europe/Paris', maria.token)).json();
    expect(mine.person.plots).toMatchObject({ assigned: 5, submitted: 4 });
    expect(m.text).toContain('Parcelles que vous avez envoyées cette semaine : 3');
    expect(m.text).toContain(`Parcelles que vous avez envoyées en tout : ${mine.person.plots.submitted}`);
    expect(m.text).toContain(`Parcelles qu’il vous reste à faire : ${mine.person.plots.remaining}`);
    expect(m.text).toContain(`https://ce.example.org/projects/${pid}/my-work`);
    // Nobody else's name, no check named, no answer.
    for (const word of ['jose', 'owner', 'ForestSecretAnswer', 'contrôle', 'check']) expect(m.text.toLowerCase(), word).not.toContain(word.toLowerCase());
    expect(m.html).not.toContain('jose');

    // Marked done for the week: a retry sends nothing.
    const again = (await digest()).json();
    // Not even read again (done for the UTC week).
    expect(again).toMatchObject({ sent: 0, done: 0, skipped: 0 });
    expect(digests()).toHaveLength(2);
    expect((await me('GET', '/notifications', owner.token)).json().digests.coordinator).toMatchObject({ on: true, lastSentWeek: week });
    // The next week, again.
    clock += 7 * DAY;
    expect((await digest()).json()).toMatchObject({ sent: 2 });
  });

  it("a person's week with nothing done and nothing left to do sends no mail", async () => {
    // maria does her last plot (4) before the digest's week: that week she submitted 1, 2 and 7.
    const monday = Date.parse(`${weekMonday(dueWeek(clock, 'UTC'))}T12:00:00Z`);
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '4', operator: 'maria', modifiedOn: monday - 2 * DAY, activelySaved: true })]);
    await subscribe(maria, 'maria@example.org', { collector: true });
    expect((await digest()).json()).toMatchObject({ sent: 1, empty: 0 });
    // The next week: nothing submitted, nothing left, nothing sent back. No mail, the week passed over.
    clock += 7 * DAY;
    expect((await digest()).json()).toMatchObject({ sent: 0, empty: 1 });
    expect(digests('maria@example.org')).toHaveLength(1);
    expect((await digest()).json()).toMatchObject({ sent: 0, empty: 0 });
  });

  it('two runs at once, on one instance or two, send each mail once', async () => {
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    await subscribe(maria, 'maria@example.org', { collector: true });
    const other = await buildServer({ store: ctx.store, config: { port: 0, host: '127.0.0.1', storeBackend: 'memory', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0, ...config }, webDir: null, mailer, ai: { now: () => clock } });
    try {
      const [a, b, c] = await Promise.all([digest(), digest(), digest(undefined, undefined, other)]);
      // A second call on the same instance while one runs is a 409; the other instance runs alongside.
      const codes = [a.statusCode, b.statusCode, c.statusCode];
      expect(codes.every((s) => s === 200 || s === 409)).toBe(true);
      expect(c.statusCode).toBe(200);
      expect(digests()).toHaveLength(2);
      expect(new Set(digests().map((d) => d.to)).size).toBe(2);
    } finally {
      await other.close();
    }
  });

  it('disabled accounts, unconfirmed addresses and removed members are left out; a failed mail is tried again', async () => {
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    await subscribe(maria, 'maria@example.org', { collector: true });
    await subscribe(jose, 'jose@example.org', { collector: true });
    // jose's account is disabled; maria leaves the project.
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${jose.userId}/disable`, headers: bearer(owner.token) })).statusCode).toBe(200);
    expect((await call('DELETE', `/members/${maria.userId}`, owner.token)).statusCode).toBe(204);
    // The owner's mail server refuses once.
    mailer.fail = (msg: MailMessage) => msg.to === 'owner@example.org';
    const first = (await digest()).json();
    expect(first).toMatchObject({ sent: 0, failed: 1, skipped: 1, empty: 1 });
    expect(digests()).toHaveLength(0);
    mailer.fail = null;
    const second = (await digest()).json();
    expect(second).toMatchObject({ sent: 1, failed: 0, skipped: 1, empty: 0 });
    expect(digests().map((d) => d.to)).toEqual(['owner@example.org']);
    // The coordinator's mail no longer lists maria (she left).
    expect(digests()[0].text).not.toContain('maria');
    // An address not confirmed is skipped.
    await me('PUT', '/email', owner.token, { email: 'owner2@example.org' });
    clock += 7 * DAY;
    expect((await digest()).json()).toMatchObject({ sent: 0, skipped: 2 });
  });

  it('a deleted account takes its subscriptions with it', async () => {
    await subscribe(maria, 'maria@example.org', { collector: true });
    expect(await ctx.store.listDueDigests({ before: '9999-W01', after: null, limit: 10 })).toHaveLength(1);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(maria.token), payload: { password: 'password12' } })).statusCode).toBe(204);
    expect(await ctx.store.listDueDigests({ before: '9999-W01', after: null, limit: 10 })).toHaveLength(0);
    expect(await ctx.store.getAccountMail(maria.userId)).toBeNull();
  });

  it('a bounded run: what is left is sent by the next call', async () => {
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    await subscribe(maria, 'maria@example.org', { collector: true });
    const first = (await digest(undefined, { maxMails: 1 })).json();
    expect(first).toMatchObject({ sent: 1, more: true });
    const second = (await digest(undefined, { maxMails: 1 })).json();
    expect(second).toMatchObject({ sent: 1, more: false });
    expect(digests()).toHaveLength(2);
  });

  it('one-click unsubscribe (RFC 8058): no login, that digest only, the token tied to the account and the kind', async () => {
    await subscribe(owner, 'owner@example.org', { coordinator: true });
    await me('PUT', '/notifications', owner.token, { collector: true, language: 'en', timeZone: 'UTC' });
    await digest();
    const url = /^<(.+)>$/.exec(digests('owner@example.org')[0].headers!['List-Unsubscribe'])![1];
    const path = new URL(url).pathname;
    expect(path).toMatch(/^\/v1\/unsubscribe\//);
    // A browser opening it is sent to the dashboard's page, which asks first.
    const opened = await ctx.app.inject({ method: 'GET', url: path });
    expect(opened.statusCode).toBe(303);
    expect(opened.headers.location).toBe(path.replace('/v1/unsubscribe/', '/unsubscribe/'));
    expect((await me('GET', '/notifications', owner.token)).json().digests.coordinator.on).toBe(true);
    // The mail program's one click.
    const res = await ctx.app.inject({ method: 'POST', url: path, payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ unsubscribed: true, kind: 'coordinator' });
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['set-cookie']).toBeUndefined();
    const after = (await me('GET', '/notifications', owner.token)).json();
    expect(after.digests).toMatchObject({ coordinator: { on: false }, collector: { on: true } });
    // Again (the page and the mail program): the same answer. JSON from the page works too.
    expect((await ctx.app.inject({ method: 'POST', url: path, payload: {} })).statusCode).toBe(200);
    // A changed token does nothing.
    const tampered = await ctx.app.inject({ method: 'POST', url: `${path.slice(0, -2)}xx` });
    expect(tampered.statusCode).toBe(404);
    expect(after.digests.collector.on).toBe(true);
  });

  it('the log transport by default: the run goes, nothing is sent, the log has no link, token nor address', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write: (chunk, _enc, done) => { lines.push(String(chunk)); done(); } });
    await ctx.app.close();
    mailer = new TestMailer();
    ctx = await makeContext(config, { ai: { now: () => clock }, logger: { stream, level: 'info' } });
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'P' } })).json().projectId;
    await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n', { 'content-type': 'text/csv' });
    await plotDoneInTheWeek();
    expect((await me('GET', '/notifications', owner.token)).json().sends).toBe(false);
    await me('PUT', '/email', owner.token, { email: 'owner.secret@example.org' });
    // The confirmation mail went to the log: confirm as the link would (the store, as a test can).
    await ctx.store.confirmEmail(owner.userId, 'owner.secret@example.org', clock);
    clock -= 7 * DAY;
    await me('PUT', '/notifications', owner.token, { coordinator: true, language: 'en', timeZone: 'UTC' });
    clock += 7 * DAY;
    const run = (await digest()).json();
    expect(run).toMatchObject({ transport: 'log', sent: 1 });
    // Nothing reached anyone, so the week is not marked: SMTP set up later still sends it.
    expect((await me('GET', '/notifications', owner.token)).json().digests.coordinator.lastSentWeek).toBeNull();
    const log = lines.join('');
    expect(log).toContain('mail not sent: no SMTP_URL is set (log transport)');
    expect(log).toContain('"tag":"digest.coordinator"');
    expect(log).toContain('"tag":"email.confirm"');
    expect(log).not.toContain('owner.secret');
    expect(log).not.toContain('/unsubscribe/');
    expect(log).not.toContain('/confirm-email/');
    expect(log).not.toContain(DIGEST_SECRET);
  });
});
