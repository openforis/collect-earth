import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  codeAt,
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  matchStep,
  newRecoveryCodes,
  otpauthUri,
  stepOf,
  twoFactorKey,
} from '../src/twoFactor.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('the codes', () => {
  it("are RFC 6238's (its SHA-1 test vectors)", () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    // RFC 6238, appendix B: T = 59 s, 1111111109 s, 2000000000 s (8 digits there; 6 here, the last six)
    expect(codeAt(secret, stepOf(59_000))).toBe('287082');
    expect(codeAt(secret, stepOf(1_111_111_109_000))).toBe('081804');
    expect(codeAt(secret, stepOf(2_000_000_000_000))).toBe('279037');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('accept a clock one step off, not two', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    const step = stepOf(now);
    expect(matchStep(secret, codeAt(secret, step), now)).toBe(step);
    expect(matchStep(secret, codeAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchStep(secret, codeAt(secret, step + 1), now)).toBe(step + 1);
    expect(matchStep(secret, codeAt(secret, step - 2), now)).toBeNull();
    expect(matchStep(secret, '12345', now)).toBeNull();
    expect(matchStep(secret, `${codeAt(secret, step).slice(0, 3)} ${codeAt(secret, step).slice(3)}`, now)).toBe(step);
  });

  it('keep the secret encrypted, readable only with the same key', () => {
    const key = twoFactorKey({ linkSecret: 'one' });
    const stored = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored, twoFactorKey({ linkSecret: 'two' }))).toBeNull();
  });

  it('give ten recovery codes, told apart from app codes, hashed whatever their case and dashes', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(looksLikeRecoveryCode(c)).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
    expect(hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, ' '))).toBe(hashRecoveryCode(codes[0]));
    expect(otpauthUri('Collect Earth Cloud', 'ana', 'ABC')).toBe('otpauth://totp/Collect%20Earth%20Cloud%3Aana?secret=ABC&issuer=Collect+Earth+Cloud&algorithm=SHA1&digits=6&period=30');
  });
});

describe('signing in with two steps', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  const login = (body: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: body });
  const post = (url: string, token: string, payload: Record<string, unknown> = {}) => ctx.app.inject({ method: 'POST', url, headers: bearer(token), payload });

  /** Sets two-step sign-in up for the owner; gives the secret and the recovery codes. */
  const setUp = async (token = owner.token) => {
    const setup = await post('/v1/me/two-factor/setup', token);
    expect(setup.statusCode).toBe(200);
    const { secret, uri } = setup.json();
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect((await post('/v1/me/two-factor/enable', token, { code: '000000' })).statusCode).toBe(400);
    const enabled = await post('/v1/me/two-factor/enable', token, { code: codeAt(secret, stepOf(Date.now())) });
    expect(enabled.statusCode, enabled.body).toBe(200);
    return { secret: secret as string, recoveryCodes: enabled.json().recoveryCodes as string[] };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('asks for the code after the right password, and takes each code once', async () => {
    const { secret } = await setUp();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(owner.token) })).json().twoFactor).toEqual({ enabled: true, required: false });
    // a wrong password says nothing about the second step
    expect((await login({ username: 'owner', password: 'wrong-password' })).json().error).toBe('invalid_credentials');
    expect((await login({ username: 'owner', password: 'owner-password' })).json().error).toBe('second_step_required');
    expect((await login({ username: 'owner', password: 'owner-password', code: '000000' })).json().error).toBe('invalid_second_step');
    // the code used to turn it on is used up: the next step's code signs in
    const next = codeAt(secret, stepOf(Date.now()) + 1);
    const ok = await login({ username: 'owner', password: 'owner-password', code: next });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().token).toBeTruthy();
    // the same code again: refused (seen over a shoulder, it cannot be played again)
    expect((await login({ username: 'owner', password: 'owner-password', code: next })).json().error).toBe('invalid_second_step');
  });

  it('lets a recovery code in once, and new codes replace the old', async () => {
    const { recoveryCodes } = await setUp();
    const first = await login({ username: 'owner', password: 'owner-password', code: recoveryCodes[0].toLowerCase() });
    expect(first.statusCode, first.body).toBe(200);
    expect((await login({ username: 'owner', password: 'owner-password', code: recoveryCodes[0] })).statusCode).toBe(401);
    const token = first.json().token as string;
    expect((await post('/v1/me/two-factor/recovery-codes', token, { password: 'nope' })).statusCode).toBe(403);
    const fresh = (await post('/v1/me/two-factor/recovery-codes', token, { password: 'owner-password' })).json().recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect((await login({ username: 'owner', password: 'owner-password', code: recoveryCodes[1] })).statusCode).toBe(401);
    expect((await login({ username: 'owner', password: 'owner-password', code: fresh[0] })).statusCode).toBe(200);
  });

  it('signs out the sessions opened before it was turned on, and turns off with the password', async () => {
    const other = (await login({ username: 'owner', password: 'owner-password' })).json().token as string;
    await setUp();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(other) })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(owner.token) })).statusCode).toBe(200);
    expect((await post('/v1/me/two-factor/disable', owner.token, { password: 'nope' })).statusCode).toBe(403);
    expect((await post('/v1/me/two-factor/disable', owner.token, { password: 'owner-password' })).statusCode).toBe(204);
    expect((await login({ username: 'owner', password: 'owner-password' })).statusCode).toBe(200);
  });

  it('can be required of coordinators and administrators: their pages wait until they set it up', async () => {
    const put = (payload: Record<string, unknown>, token = owner.token) => ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(token), payload });
    // the administrator must have it first, or the server panel would lock them out
    expect((await put({ twoFactorForCoordinators: true })).json().error).toBe('set_up_two_factor_first');
    const pid = (await createProject(ctx.app, 'Required')).projectId;
    // a coordinator without it, and a collector
    const invite = async (role: string) => {
      const inv = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role, maxUses: 1 } });
      return inv.json().inviteToken as string;
    };
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const coordinatorInvite = await invite('admin');
    const collectorInvite = await invite('operator');
    await setUp();
    expect((await put({ twoFactorForCoordinators: true })).statusCode).toBe(200);
    const reg = async (username: string, inviteToken: string) =>
      (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken } })).json().token as string;
    const coordinator = await reg('cora', coordinatorInvite);
    const collector = await reg('cole', collectorInvite);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(coordinator) })).json().twoFactor).toEqual({ enabled: false, required: true });
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(collector) })).json().twoFactor).toEqual({ enabled: false, required: false });
    // the coordinator's pages are refused until then; a collector's are not
    const people = (token: string) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/people`, headers: bearer(token) });
    expect((await people(coordinator)).json().error).toBe('two_factor_required');
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/my-assignment`, headers: bearer(collector) })).statusCode).not.toBe(403);
    // and they cannot turn it off while it is required
    const { secret } = await setUp(coordinator);
    expect((await people(coordinator)).statusCode).toBe(200);
    expect((await post('/v1/me/two-factor/disable', coordinator, { password: 'password12' })).json().error).toBe('two_factor_required');
    void secret;
  });

  it("is reset by the server's administrator for a lost phone: the person's sessions end", async () => {
    const pid = (await createProject(ctx.app, 'Lost')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const inv = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    const ana = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: inv.json().inviteToken } })).json();
    await setUp(ana.token);
    expect((await login({ username: 'ana', password: 'password12' })).json().error).toBe('second_step_required');
    expect((await post(`/v1/admin/users/${ana.userId}/two-factor/reset`, ana.token)).statusCode).toBe(403);
    expect((await post(`/v1/admin/users/${ana.userId}/two-factor/reset`, owner.token)).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(ana.token) })).statusCode).toBe(401);
    expect((await login({ username: 'ana', password: 'password12' })).statusCode).toBe(200);
  });
});
