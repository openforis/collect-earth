// The server page's accounts (src/accounts.ts, routes/admin.ts, stage B of docs/plans/2026-11-12-server-admin.md):
// searched, filtered, sorted, in pages and as CSV; made by an administrator; promoted; signed out; deleted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INACTIVE_DAYS, accountsCsv, parseAccountQuery, parseNewAccounts, queryAccounts } from '../src/accounts.js';
import { TestMailer } from '../src/mail.js';
import { hashPassword } from '../src/password.js';
import type { UserSummary } from '../src/types.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const NOW = Date.UTC(2026, 10, 12);
const DAY = 24 * 3600 * 1000;
const user = (username: string, extra: Partial<UserSummary> = {}): UserSummary => ({
  userId: username, username, isPlatformAdmin: false, projects: 0, coordinatedProjects: 0, disabledAt: null, disabledBy: null, twoFactor: false,
  createdAt: NOW - 200 * DAY, lastActiveAt: NOW - DAY, email: null, emailConfirmed: false, lockedUntil: null, ...extra,
});

describe('the accounts list', () => {
  const users = [
    user('ana', { email: 'ana@example.org', projects: 3, lastActiveAt: NOW - 2 * DAY, createdAt: NOW - 10 * DAY }),
    user('Ben', { isPlatformAdmin: true, twoFactor: true, projects: 1 }),
    user('carla', { disabledAt: NOW - DAY, lastActiveAt: null }),
    user('dan', { lastActiveAt: NOW - (INACTIVE_DAYS + 1) * DAY, email: 'dan@field.org', createdAt: NOW - 400 * DAY }),
  ];

  it('reads the query, each part its default when missing or wrong', () => {
    expect(parseAccountQuery({})).toEqual({ q: '', filter: 'all', sort: 'name', desc: false, page: 1, pageSize: 50 });
    expect(parseAccountQuery({ q: ' an ', filter: 'admins', sort: 'lastActive', desc: 'true', page: '3', pageSize: '999' })).toEqual({
      q: 'an', filter: 'admins', sort: 'lastActive', desc: true, page: 3, pageSize: 200,
    });
    expect(parseAccountQuery({ filter: 'x', sort: 'y', page: '-1' })).toMatchObject({ filter: 'all', sort: 'name', page: 1 });
  });

  it('searches the names and addresses, filters, counts each filter, sorts and cuts pages', () => {
    const q = (extra: Partial<ReturnType<typeof parseAccountQuery>>) => queryAccounts(users, { ...parseAccountQuery({}), ...extra }, NOW);
    expect(q({}).users.map((u) => u.username)).toEqual(['ana', 'Ben', 'carla', 'dan']);
    expect(q({ q: 'field.org' }).users.map((u) => u.username)).toEqual(['dan']);
    expect(q({ filter: 'admins' }).users.map((u) => u.username)).toEqual(['Ben']);
    expect(q({ filter: 'disabled' }).users.map((u) => u.username)).toEqual(['carla']);
    // never active since kept: its creation counts; dan for over 90 days
    expect(q({ filter: 'inactive' }).users.map((u) => u.username)).toEqual(['carla', 'dan']);
    expect(q({ filter: 'noEmail' }).users.map((u) => u.username)).toEqual(['Ben', 'carla']);
    expect(q({}).counts).toEqual({ all: 4, admins: 1, disabled: 1, locked: 0, twoFactor: 1, noTwoFactor: 3, inactive: 2, noEmail: 2 });
    expect(q({ sort: 'projects', desc: true }).users.map((u) => u.username)).toEqual(['ana', 'Ben', 'carla', 'dan']);
    expect(q({ sort: 'lastActive', desc: true }).users.map((u) => u.username)).toEqual(['Ben', 'ana', 'dan', 'carla']);
    expect(q({ sort: 'created' }).users.map((u) => u.username)).toEqual(['dan', 'Ben', 'carla', 'ana']);
    expect(q({ sort: 'name', desc: true }).users.map((u) => u.username)).toEqual(['dan', 'carla', 'Ben', 'ana']);
    const second = q({ pageSize: 3, page: 2 });
    expect(second).toMatchObject({ total: 4, page: 2, pages: 2, pageSize: 3 });
    expect(second.users.map((u) => u.username)).toEqual(['dan']);
    // a page past the last: the last
    expect(q({ pageSize: 3, page: 9 }).page).toBe(2);
  });

  it('writes the CSV with no project names, formulas defused', () => {
    const csv = accountsCsv([user('=cmd', { email: 'a@b.org', emailConfirmed: true, projects: 2, coordinatedProjects: 1 })]);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('username,email,email_confirmed,server_admin,two_step_sign_in,disabled_on,projects,coordinator_of,created_on,last_active_on');
    expect(lines[1]).toMatch(/^'=cmd,a@b\.org,true,false,false,,2,1,2026-04-26T00:00:00.000Z,2026-11-11T00:00:00.000Z$/);
  });

  it('checks the accounts to make', () => {
    expect(parseNewAccounts({ accounts: [{ username: 'maria' }, { username: 'joao', email: ' joao@example.org ' }] })).toEqual([
      { username: 'maria', email: null },
      { username: 'joao', email: 'joao@example.org' },
    ]);
    expect(parseNewAccounts({ accounts: [] })).toMatchObject({ line: null });
    expect(parseNewAccounts({ accounts: [{ username: 'okay' }, { username: 'no spaces' }] })).toMatchObject({ line: 2 });
    expect(parseNewAccounts({ accounts: [{ username: 'Maria' }, { username: 'maria' }] })).toMatchObject({ line: 2 });
    expect(parseNewAccounts({ accounts: [{ username: 'maria', email: 'not-an-address' }] })).toMatchObject({ line: 1 });
    expect(parseNewAccounts({ accounts: Array.from({ length: 101 }, (_, i) => ({ username: `u${i}` })) })).toMatchObject({ line: null });
  });
});

describe('the accounts on the server page', () => {
  let ctx: TestContext;
  let mailer: TestMailer;
  let owner: { token: string; userId: string };
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token = owner.token, payload?: unknown) =>
    ctx.app.inject({ method, url, headers: bearer(token), payload: payload as never });
  const account = async (username: string) => {
    const u = await ctx.store.createUser({ username, passwordHash: await hashPassword(`${username}-password`), email: null });
    return { userId: u.id, token: await ctx.store.createSession(u.id) };
  };

  beforeEach(async () => {
    mailer = new TestMailer();
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org' }, { mailer });
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('lists the accounts in pages with their dates, as CSV too, to administrators only', async () => {
    const maria = await account('maria');
    const res = await call('GET', '/v1/admin/users?q=mar&pageSize=10');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, page: 1, pages: 1, counts: { all: 1 } });
    const listed = res.json().users[0];
    expect(listed).toMatchObject({ username: 'maria', email: null, emailConfirmed: false });
    // a sign-in counts as activity
    expect(listed.lastActiveAt).toBeGreaterThan(Date.now() - 60_000);
    expect(listed.createdAt).toBeGreaterThan(Date.now() - 60_000);
    const csv = await call('GET', '/v1/admin/users.csv?filter=all');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('\r\nmaria,');
    expect((await call('GET', '/v1/admin/users', maria.token)).statusCode).toBe(403);
    expect((await call('GET', '/v1/admin/users.csv', maria.token)).statusCode).toBe(403);
  });

  it('makes accounts with a link to choose the password: mailed when it can, else given to pass on', async () => {
    await account('taken');
    const res = await call('POST', '/v1/admin/users', owner.token, {
      accounts: [{ username: 'new1', email: 'new1@example.org' }, { username: 'new2' }, { username: 'taken' }],
      language: 'es',
    });
    expect(res.statusCode, res.body).toBe(201);
    const [one, two, three] = res.json().results;
    // an address and mail that delivers: mailed, the link never shown here
    expect(one).toMatchObject({ username: 'new1', status: 'created', mailed: true });
    expect(one.setPasswordUrl).toBeUndefined();
    await ctx.app.mailWork?.idle();
    const sent = mailer.sent.filter((m) => m.tag === 'account.welcome');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'new1@example.org' });
    expect(sent[0].subject).toContain('nueva cuenta new1');
    // no address: the link to pass on, for a week
    expect(two).toMatchObject({ username: 'new2', status: 'created', mailed: false });
    expect(two.setPasswordUrl).toMatch(/^https:\/\/ce\.example\.org\/reset\//);
    expect(two.expiresAt - Date.now()).toBeGreaterThan(6.9 * DAY);
    expect(three).toEqual({ username: 'taken', status: 'taken' });
    // the link sets the password; the account then signs in
    const token = two.setPasswordUrl.split('/reset/')[1];
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'a-new-password' } })).statusCode).toBeLessThan(300);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'new2', password: 'a-new-password' } })).statusCode).toBe(200);
    // the address given is kept, not confirmed
    const listed = (await call('GET', '/v1/admin/users?q=new1')).json().users[0];
    expect(listed).toMatchObject({ email: 'new1@example.org', emailConfirmed: false });
    expect((await call('POST', '/v1/admin/users', owner.token, { accounts: [{ username: 'bad name' }] })).json()).toMatchObject({ error: 'bad_request', line: 1 });
    const maria = await account('maria');
    expect((await call('POST', '/v1/admin/users', maria.token, { accounts: [{ username: 'x1' }] })).statusCode).toBe(403);
  });

  it('makes and unmakes a server administrator, never the last one nor oneself', async () => {
    const maria = await account('maria');
    const up = await call('POST', `/v1/admin/users/${maria.userId}/platform-admin`, owner.token, { on: true });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().user.isPlatformAdmin).toBe(true);
    expect((await call('GET', '/v1/admin/users', maria.token)).statusCode).toBe(200);
    expect((await call('POST', `/v1/admin/users/${owner.userId}/platform-admin`, owner.token, { on: false })).json().error).toBe('own_account');
    // maria takes the owner's role: then she is the last one, and nobody can take hers
    expect((await call('POST', `/v1/admin/users/${owner.userId}/platform-admin`, maria.token, { on: false })).statusCode).toBe(200);
    expect((await ctx.store.setPlatformAdmin(maria.userId, false))).toBe('last_platform_admin');
    expect((await call('POST', `/v1/admin/users/${owner.userId}/platform-admin`, maria.token, { on: 'yes' })).statusCode).toBe(400);
    expect((await call('POST', `/v1/admin/users/00000000-0000-4000-8000-000000000000/platform-admin`, maria.token, { on: true })).statusCode).toBe(404);
  });

  it('signs an account out everywhere', async () => {
    const maria = await account('maria');
    const second = await ctx.store.createSession(maria.userId);
    expect((await call('POST', `/v1/admin/users/${maria.userId}/sign-out`)).json()).toEqual({ signedOut: true });
    expect(await ctx.store.resolveSession(maria.token)).toBeNull();
    expect(await ctx.store.resolveSession(second)).toBeNull();
    expect((await call('POST', `/v1/admin/users/${owner.userId}/sign-out`)).json().error).toBe('own_account');
  });

  it('deletes an account once its name is typed, its own projects with it; never a project others need it in', async () => {
    const maria = await account('maria');
    // a project only maria is in, as its coordinator
    const { projectId: alone } = await ctx.store.createProject({ name: 'Mine' });
    await ctx.store.addMembership(alone, maria.userId, 'admin');
    expect((await call('DELETE', `/v1/admin/users/${maria.userId}`, owner.token, { confirm: 'Maria' })).json().error).toBe('confirm_username');
    const res = await call('DELETE', `/v1/admin/users/${maria.userId}`, owner.token, { confirm: 'maria' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: true, projectsDeleted: 1 });
    expect(await ctx.store.getUserById(maria.userId)).toBeNull();
    expect(await ctx.store.getProject(alone)).toBeNull();

    // the only coordinator of a project someone else works in: refused, the project told by id
    const ana = await account('ana');
    const { projectId: shared } = await ctx.store.createProject({ name: 'Shared' });
    await ctx.store.addMembership(shared, ana.userId, 'admin');
    const ben = await account('ben');
    await ctx.store.addMembership(shared, ben.userId, 'operator');
    const refused = await call('DELETE', `/v1/admin/users/${ana.userId}`, owner.token, { confirm: 'ana' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'sole_coordinator', projectIds: [shared] });
    expect((await call('DELETE', `/v1/admin/users/${owner.userId}`, owner.token, { confirm: 'admin' })).json().error).toBe('own_account');
  });
});
