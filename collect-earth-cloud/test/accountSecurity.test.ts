import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestMailer } from '../src/mail.js';
import { hashPassword } from '../src/password.js';
import { RESET_MAILS_PER_ACCOUNT_HOUR, FORGOT_PER_IP_HOUR } from '../src/routes/mail.js';
import { emailChangedMail, maskEmail, passwordChangedMail, resetLinkMail, SECURITY_WORDS, SELF_RESET_TTL_MS } from '../src/securityMail.js';
import { MAIL_LANGUAGES } from '../src/types.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const BASE = 'https://ce.example.org';

describe('account security: "Forgot your password?", sessions after a change, security notices', () => {
  let ctx: TestContext;
  let mailer: TestMailer;
  let owner: { token: string; userId: string };

  const login = (username: string, password: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });
  const session = async (username: string, password: string) => {
    const res = await login(username, password);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().token as string;
  };
  const meStatus = async (token: string) => (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode;
  const forgot = (login: unknown, language?: string, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method: 'POST', url: '/v1/auth/forgot', headers, payload: { login, ...(language ? { language } : {}) } });
  const settled = async () => ctx.app.mailWork?.idle();
  const mails = (tag: string, to?: string) => mailer.sent.filter((m) => m.tag === tag && (to === undefined || m.to === to));
  const resetToken = (text: string) => /\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;

  /** An account; with `email`, that address saved and (unless `confirmed: false`) confirmed. */
  const account = async (username: string, email: string | null, opts: { confirmed?: boolean; password?: string } = {}) => {
    const password = opts.password ?? `${username}-password`;
    const user = await ctx.store.createUser({ username, passwordHash: await hashPassword(password), email: null });
    if (email !== null) {
      await ctx.store.setEmail(user.id, email);
      if (opts.confirmed !== false) await ctx.store.confirmEmail(user.id, email, Date.now());
    }
    return { userId: user.id, password };
  };

  beforeEach(async () => {
    mailer = new TestMailer();
    ctx = await makeContext({ publicBaseUrl: BASE, linkSecret: 'a-link-secret-of-at-least-32-characters!' }, { mailer });
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  describe('POST /v1/auth/forgot', () => {
    it('server-info says self-service reset is there when mail delivers', async () => {
      expect((await ctx.app.inject({ method: 'GET', url: '/v1/server-info' })).json().selfServiceReset).toBe(true);
      const quiet = await makeContext({});
      try {
        expect((await quiet.app.inject({ method: 'GET', url: '/v1/server-info' })).json().selfServiceReset).toBe(false);
        // Without mail it is not offered: the route says so (whatever the login, so nothing is told).
        const res = await quiet.app.inject({ method: 'POST', url: '/v1/auth/forgot', payload: { login: 'anyone' } });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toBe('not_available');
      } finally {
        await quiet.app.close();
      }
    });

    it('mails a one-hour reset link to a confirmed address, in the language asked', async () => {
      const ana = await account('ana', 'ana@example.org');
      const before = Date.now();
      const res = await forgot('ana', 'es');
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ accepted: true });
      await settled();
      const sent = mails('account.reset', 'ana@example.org');
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('Collect Earth Cloud: restablezca su contraseña');
      expect(sent[0].text).toContain('la cuenta ana en Collect Earth Cloud');
      expect(sent[0].headers).toEqual({ 'Auto-Submitted': 'auto-generated' });
      const token = resetToken(sent[0].text)!;
      expect(sent[0].text).toContain(`${BASE}/reset/${token}`);
      // Only the reset link: no tracking, no other link.
      const links = [...sent[0].html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(links).toEqual([`${BASE}/reset/${token}`]);
      // One hour, the administrator's links' table.
      expect(await ctx.store.checkPasswordReset(token, before + SELF_RESET_TTL_MS - 60_000)).toBe(true);
      expect(await ctx.store.checkPasswordReset(token, Date.now() + SELF_RESET_TTL_MS + 1)).toBe(false);
      expect(ana.userId).toBeTruthy();
    });

    it('takes the email address too (any case), and the language of the account without one asked', async () => {
      const bea = await account('bea', 'Bea@Example.org');
      await ctx.store.setMailPreferences(bea.userId, { language: 'fr', timeZone: null });
      expect((await forgot('bea@example.ORG')).statusCode).toBe(202);
      await settled();
      const sent = mails('account.reset', 'Bea@Example.org');
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('Collect Earth Cloud : réinitialisez votre mot de passe');
    });

    it('answers the same for an unknown, an unconfirmed, a disabled account and one without email, and mails none of them', async () => {
      await account('carl', 'carl@example.org', { confirmed: false });
      const dora = await account('dora', 'dora@example.org');
      await account('emil', null);
      const disabled = await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${dora.userId}/disable`, headers: bearer(owner.token) });
      expect(disabled.statusCode).toBe(200);
      const answers = [];
      for (const who of ['nobody', 'nobody@example.org', 'carl', 'carl@example.org', 'dora', 'dora@example.org', 'emil']) {
        const res = await forgot(who);
        answers.push({ status: res.statusCode, body: res.body, cache: res.headers['cache-control'] });
      }
      await settled();
      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
      expect(answers[0]).toEqual({ status: 202, body: '{"accepted":true}', cache: 'no-store' });
      expect(mailer.sent).toEqual([]);
    });

    it('a bad request is told (it says nothing of any account)', async () => {
      expect((await forgot('')).statusCode).toBe(400);
      expect((await forgot(42)).statusCode).toBe(400);
      expect((await forgot('x'.repeat(255))).statusCode).toBe(400);
    });

    it(`sends at most ${RESET_MAILS_PER_ACCOUNT_HOUR} mails an hour per account, quietly`, async () => {
      await account('fay', 'fay@example.org');
      for (let i = 0; i < RESET_MAILS_PER_ACCOUNT_HOUR + 3; i++) {
        const res = await forgot(i % 2 === 0 ? 'fay' : 'fay@example.org');
        expect(res.statusCode).toBe(202);
      }
      await settled();
      expect(mails('account.reset', 'fay@example.org')).toHaveLength(RESET_MAILS_PER_ACCOUNT_HOUR);
    });

    it(`looks into at most ${FORGOT_PER_IP_HOUR} requests an hour per client IP, quietly`, async () => {
      const limited = await makeContext({ publicBaseUrl: BASE, rateLimitPerMinute: 1000 }, { mailer });
      try {
        const names = Array.from({ length: FORGOT_PER_IP_HOUR + 2 }, (_, i) => `user${i}`);
        for (const name of names) {
          const u = await limited.store.createUser({ username: name, passwordHash: 'x', email: `${name}@example.org` });
          await limited.store.confirmEmail(u.id, `${name}@example.org`, Date.now());
        }
        for (const name of names) {
          const res = await limited.app.inject({ method: 'POST', url: '/v1/auth/forgot', payload: { login: name } });
          expect(res.statusCode).toBe(202);
        }
        await limited.app.mailWork?.idle();
        expect(mailer.sent.filter((m) => m.tag === 'account.reset')).toHaveLength(FORGOT_PER_IP_HOUR);
      } finally {
        await limited.app.close();
      }
    });

    it('the mailed link works once, ends every session of the account, and sends the notice', async () => {
      const gil = await account('gil', 'gil@example.org');
      const dashboard = await session('gil', gil.password);
      const desktop = await session('gil', gil.password);
      await forgot('gil', 'pt');
      await settled();
      const token = resetToken(mails('account.reset')[0].text)!;
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/auth/reset/${token}` })).statusCode).toBe(200);
      const ok = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'new-password-1', language: 'pt' } });
      expect(ok.statusCode).toBe(204);
      expect(await meStatus(dashboard)).toBe(401);
      expect(await meStatus(desktop)).toBe(401);
      expect((await login('gil', 'new-password-1')).statusCode).toBe(200);
      const again = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'new-password-2' } });
      expect(again.statusCode).toBe(410);
      await settled();
      const notice = mails('account.password-changed', 'gil@example.org');
      expect(notice).toHaveLength(1);
      expect(notice[0].subject).toBe('Collect Earth Cloud: a sua senha foi alterada');
      expect(notice[0].text).toContain('A senha da sua conta gil em Collect Earth Cloud foi alterada em');
      expect(notice[0].text).toContain('link para redefinir a senha');
    });
  });

  describe('PUT /v1/me/password', () => {
    it('ends the other sessions (Collect Earth\'s too) and keeps the one making the change', async () => {
      const hal = await account('hal', null);
      const current = await session('hal', hal.password);
      const desktop = await session('hal', hal.password);
      const otherBrowser = await session('hal', hal.password);
      const theirs = await account('ida', null);
      const idaSession = await session('ida', theirs.password);
      const res = await ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/password',
        headers: bearer(current),
        payload: { currentPassword: hal.password, newPassword: 'changed-password' },
      });
      expect(res.statusCode).toBe(204);
      expect(await meStatus(current)).toBe(200);
      expect(await meStatus(desktop)).toBe(401);
      expect(await meStatus(otherBrowser)).toBe(401);
      // Nobody else's.
      expect(await meStatus(idaSession)).toBe(200);
      // No confirmed address: no notice.
      await settled();
      expect(mails('account.password-changed')).toEqual([]);
    });

    it('mails the notice to the confirmed address, with the date, what to do and the contact address', async () => {
      const jan = await account('jan', 'jan@example.org');
      await ctx.store.setMailPreferences(jan.userId, { language: null, timeZone: 'America/Bogota' });
      await ctx.store.updateSettings({ contactEmail: 'admin@example.org', serverName: 'FAO Cloud' });
      const token = await session('jan', jan.password);
      const res = await ctx.app.inject({ method: 'PUT', url: '/v1/me/password', headers: bearer(token), payload: { currentPassword: jan.password, newPassword: 'changed-password' } });
      expect(res.statusCode).toBe(204);
      await settled();
      const notice = mails('account.password-changed');
      expect(notice).toHaveLength(1);
      expect(notice[0].to).toBe('jan@example.org');
      expect(notice[0].subject).toBe('FAO Cloud: your password was changed');
      expect(notice[0].text).toContain('The password of your FAO Cloud account jan was changed on');
      expect(notice[0].text).toContain('(America/Bogota)');
      expect(notice[0].text).toContain('Forgot your password?');
      expect(notice[0].text).toContain('You can write to them at admin@example.org.');
      expect(notice[0].headers).toEqual({ 'Auto-Submitted': 'auto-generated' });
      expect(notice[0].headers?.['List-Unsubscribe']).toBeUndefined();
      expect([...notice[0].html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([BASE]);
    });

    it('a notice that cannot be sent never fails the change', async () => {
      const kim = await account('kim', 'kim@example.org');
      mailer.fail = () => true;
      const token = await session('kim', kim.password);
      const res = await ctx.app.inject({ method: 'PUT', url: '/v1/me/password', headers: bearer(token), payload: { currentPassword: kim.password, newPassword: 'changed-password' } });
      expect(res.statusCode).toBe(204);
      await settled();
      expect(mailer.sent).toEqual([]);
      expect((await login('kim', 'changed-password')).statusCode).toBe(200);
    });

    it('no notice where mail does not deliver', async () => {
      const quiet = await makeContext({});
      try {
        const u = await quiet.store.createUser({ username: 'lea', passwordHash: await hashPassword('lea-password'), email: 'lea@example.org' });
        await quiet.store.confirmEmail(u.id, 'lea@example.org', Date.now());
        const token = (await quiet.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'lea', password: 'lea-password' } })).json().token;
        const res = await quiet.app.inject({ method: 'PUT', url: '/v1/me/password', headers: bearer(token), payload: { currentPassword: 'lea-password', newPassword: 'changed-password' } });
        expect(res.statusCode).toBe(204);
        await quiet.app.mailWork?.idle();
      } finally {
        await quiet.app.close();
      }
      expect(mailer.sent).toEqual([]);
    });
  });

  describe('the email address changed or removed', () => {
    const putEmail = (token: string, email: string | null, language?: string) =>
      ctx.app.inject({ method: 'PUT', url: '/v1/me/email', headers: bearer(token), payload: { email, ...(language ? { language } : {}) } });

    it('tells the OLD confirmed address, never showing the new one in full', async () => {
      const max = await account('max', 'max.old@example.org');
      const token = await session('max', max.password);
      expect((await putEmail(token, 'newaddress@other.net')).statusCode).toBe(200);
      await settled();
      const notice = mails('account.email-changed');
      expect(notice).toHaveLength(1);
      expect(notice[0].to).toBe('max.old@example.org');
      expect(notice[0].text).toContain('The email address of your Collect Earth Cloud account max was changed on');
      expect(notice[0].text).toContain('n…@o….net');
      expect(notice[0].text + notice[0].html + notice[0].subject).not.toContain('newaddress');
      expect(notice[0].text + notice[0].html).not.toContain('other.net');
      // The new address gets its confirmation link, not the notice.
      expect(mails('email.confirm', 'newaddress@other.net')).toHaveLength(1);
      expect(mails('account.email-changed', 'newaddress@other.net')).toEqual([]);
    });

    it('a reset link mailed to the old address stops working once the address changes', async () => {
      const oli = await account('oli', 'oli@example.org');
      await forgot('oli');
      await settled();
      const token = resetToken(mails('account.reset', 'oli@example.org')[0].text)!;
      const session_ = await session('oli', oli.password);
      expect((await putEmail(session_, 'oli@other.net')).statusCode).toBe(200);
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/auth/reset/${token}` })).statusCode).toBe(410);
      const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'new-password-1' } });
      expect(res.statusCode).toBe(410);
    });

    it('tells it when the address is removed, in the language of the page', async () => {
      const ned = await account('ned', 'ned@example.org');
      const token = await session('ned', ned.password);
      expect((await putEmail(token, null, 'fr')).statusCode).toBe(200);
      await settled();
      const notice = mails('account.email-changed', 'ned@example.org');
      expect(notice).toHaveLength(1);
      expect(notice[0].subject).toBe('Collect Earth Cloud : l’adresse courriel de votre compte a été changée');
      expect(notice[0].text).toContain('a été retirée le');
    });

    it('nothing to an address that was not confirmed', async () => {
      const ole = await account('ole', 'ole@example.org', { confirmed: false });
      const token = await session('ole', ole.password);
      expect((await putEmail(token, 'ole2@example.org')).statusCode).toBe(200);
      expect((await putEmail(token, null)).statusCode).toBe(200);
      await settled();
      expect(mails('account.email-changed')).toEqual([]);
    });
  });
});

describe('the security mails', () => {
  const ctx = (language: (typeof MAIL_LANGUAGES)[number]) => ({ serverName: 'Cloud', language, username: 'ana', baseUrl: BASE, contactEmail: null });

  it('shows an address only in part', () => {
    expect(maskEmail('maria.lopez@fao.org')).toBe('m…@f….org');
    expect(maskEmail('a@b')).toBe('a…@b…');
    expect(maskEmail('nothing')).toBe('…');
  });

  it('are written in the four languages, French with "courriel"', () => {
    for (const language of MAIL_LANGUAGES) {
      const reset = resetLinkMail(ctx(language), `${BASE}/reset/T`, 'a@example.org');
      expect(reset.text).toContain(`${BASE}/reset/T`);
      expect(reset.text).toContain('ana');
      expect(passwordChangedMail(ctx(language), 'changed', 'today', 'a@example.org').text).toContain('today');
      expect(emailChangedMail(ctx(language), 'new@example.org', 'today', 'a@example.org').text).toContain('n…@e….org');
      expect(Object.keys(SECURITY_WORDS[language]).sort()).toEqual(Object.keys(SECURITY_WORDS.en).sort());
    }
    expect(Object.values(SECURITY_WORDS.fr).join('\n')).not.toMatch(/e-mail/i);
  });
});
