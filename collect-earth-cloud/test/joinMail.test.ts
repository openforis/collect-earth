// "Someone joined your project": the mail to each coordinator when a person joins with an invitation link
// (src/joinMail.ts, src/routes/mail.ts memberJoined, src/routes/auth.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOIN_WORDS, joinedMail } from '../src/joinMail.js';
import { TestMailer } from '../src/mail.js';
import { hashPassword } from '../src/password.js';
import { MAIL_LANGUAGES } from '../src/types.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const BASE = 'https://ce.example.org';

describe('the mail "someone joined your project"', () => {
  let ctx: TestContext;
  let mailer: TestMailer;
  let coordinator: { token: string; userId: string };
  let projectId: string;

  const settled = async () => ctx.app.mailWork?.idle();
  const joinMails = () => mailer.sent.filter((m) => m.tag === 'project.joined');
  const link = async (role = 'operator', maxUses = 10) =>
    (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/invites`, headers: bearer(coordinator.token), payload: { role, maxUses } })).json().inviteToken as string;
  const register = (username: string, inviteToken: string) =>
    ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: `${username}-password`, inviteToken } });
  const withAddress = async (userId: string, email: string, confirmed = true) => {
    await ctx.store.setEmail(userId, email);
    if (confirmed) await ctx.store.confirmEmail(userId, email, Date.now());
  };

  beforeEach(async () => {
    mailer = new TestMailer();
    ctx = await makeContext({ publicBaseUrl: BASE, linkSecret: 'a-link-secret-of-at-least-32-characters!' }, { mailer });
    coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
    projectId = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Land use 2026' } })).json().projectId;
    await withAddress(coordinator.userId, 'coord@example.org');
  });
  afterEach(async () => ctx.app.close());

  it('goes to the coordinator when someone registers with the link: who, as what, how many, and what to do next', async () => {
    expect((await register('ana', await link())).statusCode).toBe(201);
    await settled();
    const [mail] = joinMails();
    expect(mail.to).toBe('coord@example.org');
    expect(mail.subject).toContain('ana joined Land use 2026');
    expect(mail.text).toContain('ana joined the project Land use 2026 as a collector');
    expect(mail.text).toContain('The project now has 2 people.');
    expect(mail.text).toContain('Give them plots to do');
    expect(mail.text).toContain(`${BASE}/projects/${projectId}/people`);
    // optional: an unsubscribe link and the headers mail programs show a button for
    expect(mail.headers?.['List-Unsubscribe']).toMatch(new RegExp(`^<${BASE}/v1/unsubscribe/`));
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('goes when someone with an account signs in with the link, and not again when a member uses it', async () => {
    const other = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Other' } })).json().projectId;
    const otherLink = (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${other}/invites`, headers: bearer(coordinator.token), payload: { role: 'reviewer', maxUses: 1 } })).json().inviteToken;
    await register('bruno', otherLink);
    await settled();
    mailer.sent.length = 0;
    const inviteToken = await link();
    const login = () => ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'bruno', password: 'bruno-password', inviteToken } });
    expect((await login()).statusCode).toBe(200);
    await settled();
    expect(joinMails().map((m) => m.subject)).toEqual([expect.stringContaining('bruno joined Land use 2026')]);
    expect((await login()).statusCode).toBe(200);
    await settled();
    expect(joinMails()).toHaveLength(1);
  });

  it('says the role, and asks for plots only for a collector', async () => {
    await register('rita', await link('reviewer'));
    await settled();
    expect(joinMails()[0].text).toContain('as a reviewer');
    expect(joinMails()[0].text).not.toContain('Give them plots');
  });

  it('goes to every coordinator with a confirmed address who wants it, never to the one who joined', async () => {
    const second = await ctx.store.createUser({ username: 'second', passwordHash: await hashPassword('second-password'), email: null });
    await ctx.store.addMembership(projectId, second.id, 'admin');
    await withAddress(second.id, 'second@example.org');
    const unconfirmed = await ctx.store.createUser({ username: 'third', passwordHash: await hashPassword('third-password'), email: null });
    await ctx.store.addMembership(projectId, unconfirmed.id, 'admin');
    await withAddress(unconfirmed.id, 'third@example.org', false);
    // a coordinator who joins with a coordinator's link is not told of themselves
    const res = await register('newcoord', await link('admin'));
    await withAddress(res.json().userId, 'new@example.org');
    await settled();
    expect(joinMails().map((m) => m.to).sort()).toEqual(['coord@example.org', 'second@example.org']);
  });

  it('is on by default, and stops with the Account page’s switch or the mail’s own link', async () => {
    const notifications = async () => (await ctx.app.inject({ method: 'GET', url: '/v1/me/notifications', headers: bearer(coordinator.token) })).json();
    expect((await notifications()).joined).toBe(true);
    // off from the account page
    const off = await ctx.app.inject({ method: 'PUT', url: '/v1/me/notifications', headers: bearer(coordinator.token), payload: { language: 'en', joined: false } });
    expect(off.json().joined).toBe(false);
    await register('ana', await link());
    await settled();
    expect(joinMails()).toHaveLength(0);
    // on again; then the mail's one-click link turns it off
    await ctx.app.inject({ method: 'PUT', url: '/v1/me/notifications', headers: bearer(coordinator.token), payload: { language: 'en', joined: true } });
    await register('bea', await link());
    await settled();
    const unsubscribe = /<([^>]+)>/.exec(joinMails()[0].headers!['List-Unsubscribe'])![1].replace(BASE, '');
    const res = await ctx.app.inject({ method: 'POST', url: unsubscribe, payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.json()).toEqual({ unsubscribed: true, kind: 'joined' });
    expect((await notifications()).joined).toBe(false);
    // the weekly digests are untouched by it
    expect((await notifications()).digests.coordinator.on).toBe(false);
    await register('cleo', await link());
    await settled();
    expect(joinMails()).toHaveLength(1);
  });

  it('sends nothing on a server without mail', async () => {
    const quiet = await makeContext({});
    try {
      const owner = await setupPlatformAdmin(quiet.app);
      const pid = (await quiet.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'P' } })).json().projectId;
      const token = (await quiet.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } })).json().inviteToken;
      expect((await quiet.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'ana-password', inviteToken: token } })).statusCode).toBe(201);
      await quiet.app.mailWork?.idle();
    } finally {
      await quiet.app.close();
    }
  });
});

describe('its words', () => {
  it('has every text in every language, each filled', () => {
    const keys = Object.keys(JOIN_WORDS.en).sort();
    for (const language of MAIL_LANGUAGES) {
      expect(Object.keys(JOIN_WORDS[language]).sort(), language).toEqual(keys);
      const mail = joinedMail(
        { serverName: 'CE', language, baseUrl: BASE, unsubscribeUrl: `${BASE}/v1/unsubscribe/x` },
        { projectId: 'p1', projectName: 'Land use', username: 'ana', role: 'operator', people: 3 },
        'to@example.org',
      );
      expect(mail.text, language).not.toMatch(/\{\w+\}/);
      expect(mail.subject, language).toContain('ana');
      expect(mail.text, language).toContain('Land use');
    }
  });
});
