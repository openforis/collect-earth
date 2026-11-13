// The server page's safety and communication (stage D of docs/plans/2026-11-12-server-admin.md): the alerts kept, seen,
// with their thresholds and a webhook; a message to every coordinator or everyone; sign-up rules (email domains, the
// shortest password, the lock after failed sign-ins).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailInDomains, parseSignupDomains } from '../src/accountRules.js';
import { parseWebhookUrl, webhookBody, type Fetch } from '../src/alertWebhook.js';
import { TestMailer } from '../src/mail.js';
import { hashPassword } from '../src/password.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXX';
const TEAMS = 'https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def';

describe('the webhook and the domains, read', () => {
  it('posts only to Slack and Teams over https', () => {
    expect(parseWebhookUrl(SLACK)).toEqual({ kind: 'slack', host: 'hooks.slack.com' });
    expect(parseWebhookUrl(TEAMS)).toEqual({ kind: 'teams', host: 'contoso.webhook.office.com' });
    expect(parseWebhookUrl('https://prod-01.westeurope.logic.azure.com/workflows/x')?.kind).toBe('teams');
    for (const bad of ['http://hooks.slack.com/x', 'https://evil.example.org/x', 'https://hooks.slack.com.evil.org/x', 'https://user:pw@hooks.slack.com/x', 'https://hooks.slack.com:8443/x', 'https://169.254.169.254/x', 'not a url']) {
      expect(parseWebhookUrl(bad), bad).toBeNull();
    }
    expect(webhookBody('slack', 'T', 'body')).toEqual({ text: '*T*\nbody' });
    expect(JSON.stringify(webhookBody('teams', 'T', 'body'))).toContain('AdaptiveCard');
  });

  it('reads the sign-up domains', () => {
    expect(parseSignupDomains('Example.org, @field.example.org\nfao.org')).toEqual({ ok: true, value: 'example.org,field.example.org,fao.org' });
    expect(parseSignupDomains(['fao.org', 'fao.org'])).toEqual({ ok: true, value: 'fao.org' });
    expect(parseSignupDomains('  ')).toEqual({ ok: true, value: null });
    expect(parseSignupDomains(null)).toEqual({ ok: true, value: null });
    expect(parseSignupDomains('not a domain!')).toMatchObject({ ok: false });
    expect(parseSignupDomains('localhost')).toMatchObject({ ok: false });
    expect(emailInDomains('ana@FAO.org', 'fao.org')).toBe(true);
    expect(emailInDomains('ana@rome.fao.org', 'fao.org')).toBe(true);
    expect(emailInDomains('ana@notfao.org', 'fao.org')).toBe(false);
    expect(emailInDomains('ana@x.org', null)).toBe(true);
  });
});

describe('the server page: safety and communication', () => {
  let ctx: TestContext;
  let mailer: TestMailer;
  let posts: { url: string; body: unknown }[];
  let webhookStatus: number;
  let owner: { token: string; userId: string };
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token = owner.token) =>
    ctx.app.inject({ method, url, headers: bearer(token), payload: payload as never });
  const account = async (username: string, email: string | null = null, confirmed = true) => {
    const u = await ctx.store.createUser({ username, passwordHash: await hashPassword(`${username}-password`), email });
    if (email && confirmed) await ctx.store.confirmEmail(u.id, email, Date.now());
    return u.id;
  };
  const login = (username: string, password: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });
  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeEach(async () => {
    mailer = new TestMailer();
    posts = [];
    webhookStatus = 200;
    const webhookFetch: Fetch = async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: webhookStatus < 300, status: webhookStatus };
    };
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org', mailFrom: 'CE <noreply@example.org>', smtpUrl: 'smtps://u:p@mail.example.org:465' }, { mailer, webhookFetch });
    owner = await setupPlatformAdmin(ctx.app);
    await ctx.store.setEmail(owner.userId, 'owner@example.org');
    await ctx.store.confirmEmail(owner.userId, 'owner@example.org', Date.now());
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('keeps the webhook to itself: refused unless Slack or Teams, never read back', async () => {
    expect((await call('PUT', '/v1/admin/settings', { alertWebhookUrl: 'https://evil.example.org/x' })).json()).toMatchObject({ error: 'webhook_not_allowed' });
    const saved = await call('PUT', '/v1/admin/settings', { alertWebhookUrl: SLACK });
    expect(saved.json().alertWebhook).toEqual({ kind: 'slack', host: 'hooks.slack.com' });
    expect(saved.body).not.toContain('XXXX');
    expect((await call('GET', '/v1/admin/settings')).body).not.toContain('XXXX');
    const log = (await call('GET', '/v1/admin/activity?kind=settings')).json();
    expect(log.entries[0].details).toEqual({ alertWebhookUrl: 'changed' });
    expect(JSON.stringify(log)).not.toContain('XXXX');
    // a test, of the address typed or the one saved
    expect((await call('POST', '/v1/admin/alerts/webhook-test', { url: TEAMS })).json()).toEqual({ sent: true });
    expect(posts.at(-1)!.url).toBe(TEAMS);
    webhookStatus = 404;
    expect((await call('POST', '/v1/admin/alerts/webhook-test', {})).json()).toEqual({ error: 'webhook_refused', status: 404 });
    expect(posts.at(-1)!.url).toBe(SLACK);
  });

  it('raises alerts at the thresholds set, keeps them, posts them, and marks them seen', async () => {
    await call('PUT', '/v1/admin/settings', { alertFailedLogins: 3, alertWebhookUrl: SLACK });
    await account('ana');
    for (let i = 0; i < 3; i++) await login('ana', 'wrong-password');
    await settle();
    const page = (await call('GET', '/v1/admin/alerts')).json();
    expect(page).toMatchObject({ total: 1, unseen: 1, thresholds: { failedLogin: 3, serverError: 20, syncError: 50, storagePercent: 90 }, webhook: { kind: 'slack' } });
    expect(page.alerts[0]).toMatchObject({ kind: 'failed_logins', count: 3, seenAt: null });
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(posts[0].body)).toContain('3 failed logins');
    expect(mailer.sent.some((m) => m.tag === 'owner.alert.failed_logins' && m.to === 'owner@example.org')).toBe(true);

    expect((await call('POST', '/v1/admin/alerts/seen', {})).json()).toEqual({ marked: 1 });
    const after = (await call('GET', '/v1/admin/alerts')).json();
    expect(after).toMatchObject({ unseen: 0 });
    expect(after.alerts[0]).toMatchObject({ seenBy: 'owner' });
    expect((await call('POST', '/v1/admin/alerts/seen', { ids: 'x' })).statusCode).toBe(400);
    expect((await call('PUT', '/v1/admin/settings', { alertStoragePercent: 101 })).statusCode).toBe(400);
    expect((await call('GET', '/v1/admin/alerts', undefined, await ctx.store.createSession(await account('ben')))).statusCode).toBe(403);
  });

  it('limits sign-up to some email domains and sets the shortest password', async () => {
    await call('PUT', '/v1/admin/settings', { signupOpen: true, signupDomains: 'fao.org, example.org', minPasswordLength: 12 });
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/server-info' })).json();
    expect(info).toMatchObject({ minPasswordLength: 12, signupDomains: ['fao.org', 'example.org'] });
    const signup = (payload: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload });
    expect((await signup({ username: 'ana', password: 'twelve-chars' })).json()).toMatchObject({ error: 'email_domain_not_allowed', domains: ['fao.org', 'example.org'] });
    expect((await signup({ username: 'ana', password: 'twelve-chars', email: 'ana@gmail.com' })).json()).toMatchObject({ error: 'email_domain_not_allowed' });
    expect((await signup({ username: 'ana', password: 'eleven-char', email: 'ana@fao.org' })).json()).toMatchObject({ error: 'weak_password', minLength: 12 });
    // an address of the domain is not enough: no session until the mailed link is opened
    const made = await signup({ username: 'ana', password: 'twelve-chars', email: 'ana@rome.fao.org' });
    expect(made.statusCode).toBe(202);
    expect(made.json().token).toBeUndefined();
    const confirmations = () => mailer.sent.filter((m) => m.tag === 'email.confirm' && m.to === 'ana@rome.fao.org').length;
    expect(confirmations()).toBe(1);
    const refused = await login('ana', 'twelve-chars');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('email_not_confirmed');
    expect(confirmations()).toBe(2);
    // a wrong password still says only that
    expect((await login('ana', 'wrong-password')).json().error).toBe('invalid_credentials');
    await ctx.store.confirmEmail(made.json().userId, 'ana@rome.fao.org', Date.now());
    // a password change follows the rule too
    const token = (await login('ana', 'twelve-chars')).json().token;
    const change = await ctx.app.inject({ method: 'PUT', url: '/v1/me/password', headers: bearer(token), payload: { currentPassword: 'twelve-chars', newPassword: 'short-one' } });
    expect(change.json()).toMatchObject({ error: 'weak_password' });
    expect((await call('PUT', '/v1/admin/settings', { minPasswordLength: 7 })).statusCode).toBe(400);
  });

  it('locks an account after failed sign-ins in a row; an administrator or a reset link unlocks it', async () => {
    await call('PUT', '/v1/admin/settings', { loginLockFailures: 3, loginLockMinutes: 15 });
    const ana = await account('ana');
    // a right password starts the count again
    await login('ana', 'wrong');
    await login('ana', 'wrong');
    expect((await login('ana', 'ana-password')).statusCode).toBe(200);
    for (let i = 0; i < 3; i++) expect((await login('ana', 'wrong')).statusCode).toBe(401);
    const locked = await login('ana', 'ana-password');
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'account_locked' });
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(14 * 60);
    const listed = (await call('GET', '/v1/admin/users?filter=locked')).json();
    expect(listed.users.map((u: { username: string }) => u.username)).toEqual(['ana']);
    expect((await call('POST', `/v1/admin/users/${ana}/unlock`)).json()).toEqual({ unlocked: true });
    expect((await login('ana', 'ana-password')).statusCode).toBe(200);
    expect((await call('GET', '/v1/admin/activity?kind=account')).json().entries[0]).toMatchObject({ action: 'account.unlocked', target: 'ana' });
    // locked again, then a reset link
    for (let i = 0; i < 3; i++) await login('ana', 'wrong');
    const resetToken = await ctx.store.createPasswordReset(ana, Date.now() + 3600_000);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token: resetToken, newPassword: 'a-new-password' } })).statusCode).toBe(204);
    expect((await login('ana', 'a-new-password')).statusCode).toBe(200);
    // the lock off: nothing is counted
    await call('PUT', '/v1/admin/settings', { loginLockFailures: 0 });
    for (let i = 0; i < 5; i++) await login('ana', 'wrong');
    expect((await login('ana', 'a-new-password')).statusCode).toBe(200);
  });

  it('sends a message to every coordinator with a confirmed address, at most once an hour', async () => {
    const ana = await account('ana', 'ana@example.org');
    const ben = await account('ben', 'ben@example.org', false);
    await account('carla', 'carla@example.org');
    await account('dan', null);
    const { projectId } = await ctx.store.createProject({ name: 'P' });
    await ctx.store.addMembership(projectId, ana, 'admin');
    await ctx.store.addMembership(projectId, ben, 'admin');
    await ctx.store.setMailPreferences(ana, { language: 'es', timeZone: null });
    const message = { audience: 'coordinators', subject: 'Maintenance on Saturday', text: 'The server stops at 10:00 UTC.\n\nIt is back by noon.' };

    const preview = (await call('POST', '/v1/admin/messages/preview', message)).json();
    // ana only: ben's address is not confirmed; the owner coordinates nothing (createProject by the store)
    expect(preview).toMatchObject({ recipients: 1, delivers: true, nextAllowedAt: null, subject: 'Collect Earth Cloud: Maintenance on Saturday' });
    expect(preview.text).toContain('It is back by noon.');
    expect((await call('POST', '/v1/admin/messages/preview', { ...message, audience: 'everyone' })).json().recipients).toBe(3);
    expect((await call('POST', '/v1/admin/messages/preview', { ...message, subject: '' })).statusCode).toBe(400);

    expect((await call('POST', '/v1/admin/messages', { ...message, recipients: 5 })).json()).toEqual({ error: 'recipients_changed', recipients: 1 });
    expect((await call('POST', '/v1/admin/messages', { ...message, recipients: 1 })).json()).toEqual({ recipients: 1, sent: 1, failed: 0 });
    const sent = mailer.sent.filter((m) => m.tag === 'server.message.coordinators');
    expect(sent.map((m) => m.to)).toEqual(['ana@example.org']);
    // her language for the closing lines
    expect(sent[0].text).toContain('coordinadores');
    expect(sent[0].html).not.toContain('<script');

    const again = await call('POST', '/v1/admin/messages', { ...message, audience: 'everyone', recipients: 3 });
    expect(again.statusCode).toBe(429);
    expect(again.json().nextAllowedAt).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect((await call('POST', '/v1/admin/messages/preview', message)).json().nextAllowedAt).toBeGreaterThan(Date.now());
    expect((await call('GET', '/v1/admin/activity?kind=message')).json().entries[0].details).toEqual({ audience: 'coordinators', recipients: 1, sent: 1, failed: 0, subject: 'Maintenance on Saturday' });
    expect((await call('POST', '/v1/admin/messages', message, await ctx.store.createSession(ana))).statusCode).toBe(403);
  });
});
