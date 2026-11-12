// The server page's projects and operations (src/serverOps.ts, routes/serverOps.ts, the mail check in routes/mail.ts,
// stage C of docs/plans/2026-11-12-server-admin.md): the projects directory, archiving and handing over a project, the
// server activity log, the Collect Earth versions in use, the mail check and test email.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestMailer } from '../src/mail.js';
import { hashPassword } from '../src/password.js';
import {
  activityCsv,
  collectEarthVersions,
  compareVersions,
  parseProjectQuery,
  queryProjects,
} from '../src/serverOps.js';
import type { AdminProject, ClientUse } from '../src/types.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 12);
const project = (projectId: string, extra: Partial<AdminProject> = {}): AdminProject => ({
  projectId, status: 'active', createdAt: NOW - 100 * DAY, lastActivityAt: NOW - DAY, storageBytes: 1000, people: 3, coordinators: 1,
  activeCoordinators: 1, ...extra,
});

describe('the projects directory', () => {
  const projects = [
    project('aaaa', { storageBytes: 5000, lastActivityAt: NOW - 3 * DAY }),
    project('bbbb', { status: 'draft', activeCoordinators: 0, lastActivityAt: null, people: 1 }),
    project('cccc', { status: 'archived', activeCoordinators: 0, coordinators: 0, createdAt: NOW - 400 * DAY }),
    project('ab12', { status: 'closed', people: 9 }),
  ];
  const q = (extra: Record<string, string>) => queryProjects(projects, parseProjectQuery(extra));

  it('reads the query: the latest active first by default', () => {
    expect(parseProjectQuery({})).toEqual({ q: '', filter: 'all', sort: 'lastActivity', desc: true, page: 1, pageSize: 50 });
    expect(parseProjectQuery({ q: ' AB ', filter: 'x', sort: 'people', desc: 'false', pageSize: '500' })).toMatchObject({ q: 'ab', filter: 'all', sort: 'people', desc: false, pageSize: 200 });
  });

  it('searches by id, flags those needing a coordinator (not the archived), filters, counts, sorts and pages', () => {
    // ab12 and cccc last active the same day: by id
    expect(q({}).projects.map((p) => p.projectId)).toEqual(['ab12', 'cccc', 'aaaa', 'bbbb']);
    expect(q({ q: 'ab' }).projects.map((p) => p.projectId)).toEqual(['ab12']);
    expect(q({ filter: 'noCoordinator' }).projects.map((p) => p.projectId)).toEqual(['bbbb']);
    expect(q({ filter: 'archived' }).projects.map((p) => p.projectId)).toEqual(['cccc']);
    expect(q({}).counts).toEqual({ all: 4, noCoordinator: 1, draft: 1, active: 1, closed: 1, archived: 1 });
    expect(q({}).projects.find((p) => p.projectId === 'bbbb')!.needsCoordinator).toBe(true);
    expect(q({}).projects.find((p) => p.projectId === 'cccc')!.needsCoordinator).toBe(false);
    expect(q({ sort: 'storage' }).projects[0].projectId).toBe('aaaa');
    expect(q({ sort: 'people', desc: 'false' }).projects[0].projectId).toBe('bbbb');
    expect(q({ sort: 'created', desc: 'false' }).projects[0].projectId).toBe('cccc');
    expect(q({ pageSize: '3', page: '2' })).toMatchObject({ total: 4, page: 2, pages: 2 });
  });
});

describe('the Collect Earth versions', () => {
  const use = (userId: string, agent: string, at = NOW): ClientUse => ({ userId, agent, at });

  it('compares versions by their numbers', () => {
    expect(compareVersions('1.23.20', '1.23.3')).toBeGreaterThan(0);
    expect(compareVersions('1.23.20-SNAPSHOT', '1.23.20')).toBe(0);
    expect(compareVersions('1.24', '1.23.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('counts each account once, by the Collect Earth it used last, and flags the outdated', () => {
    const uses = [
      use('ana', 'CollectEarth/1.23.20 cloud-sync'),
      // ben's older call in another project does not count: his latest is 1.23.20
      use('ben', 'CollectEarth/1.22.0 cloud-sync', NOW - 5 * DAY),
      use('ben', 'CollectEarth/1.23.20 cloud-sync'),
      use('carla', 'CollectEarth/1.22.0 cloud-sync'),
      use('dan', 'CollectEarth-cloud-sync'),
      use('eva', 'CollectEarth/unknown cloud-sync'),
      use('fred', 'Mozilla/5.0'),
    ];
    const r = collectEarthVersions(uses, null);
    expect(r).toMatchObject({ latest: '1.23.20', latestConfigured: false, accounts: 6, outdatedAccounts: 2 });
    expect(r.versions).toEqual([
      { version: '1.23.20', kind: 'version', accounts: 2, outdated: false },
      { version: '1.22.0', kind: 'version', accounts: 1, outdated: true },
      { version: null, kind: 'old', accounts: 1, outdated: true },
      { version: null, kind: 'unnamed', accounts: 1, outdated: false },
    ]);
    // the latest set by the server: everyone below it is outdated
    expect(collectEarthVersions(uses, '1.24.0')).toMatchObject({ latest: '1.24.0', latestConfigured: true, outdatedAccounts: 4 });
    expect(collectEarthVersions([], null)).toMatchObject({ latest: null, versions: [], accounts: 0, outdatedAccounts: 0 });
  });
});

describe('the server activity log as CSV', () => {
  it('writes each entry, formulas defused', () => {
    const csv = activityCsv([
      { id: '1', at: NOW, actorUserId: null, actor: 'owner', action: 'settings.changed', targetUserId: null, target: null, projectId: null, details: { signupOpen: true, serverName: 'changed' } },
      { id: '2', at: NOW, actorUserId: null, actor: 'owner', action: 'account.deleted', targetUserId: null, target: '=evil', projectId: null, details: {} },
    ]);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('at,by,action,account,project_id,details');
    expect(lines[1]).toBe('2026-11-12T00:00:00.000Z,owner,settings.changed,,,signupOpen=true; serverName=changed');
    expect(lines[2]).toBe("2026-11-12T00:00:00.000Z,owner,account.deleted,'=evil,,");
  });
});

describe('the server page: projects and operations', () => {
  let ctx: TestContext;
  let mailer: TestMailer;
  let owner: { token: string; userId: string };
  const call = (method: 'GET' | 'POST', url: string, token = owner.token, payload?: unknown) =>
    ctx.app.inject({ method, url, headers: bearer(token), payload: payload as never });
  const account = async (username: string, email: string | null = null) => {
    const u = await ctx.store.createUser({ username, passwordHash: await hashPassword(`${username}-password`), email });
    return { userId: u.id, token: await ctx.store.createSession(u.id) };
  };

  beforeEach(async () => {
    mailer = new TestMailer();
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org', mailFrom: 'Collect Earth Cloud <noreply@example.org>', smtpUrl: 'smtps://user:secret@mail.example.org:465' }, { mailer });
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('lists the projects by id with their people and coordinators, to administrators only', async () => {
    const ana = await account('ana');
    const ben = await account('ben');
    const { projectId } = await ctx.store.createProject({ name: 'Secret name' });
    await ctx.store.addMembership(projectId, ana.userId, 'admin');
    await ctx.store.addMembership(projectId, ben.userId, 'operator');
    await ctx.store.touchMemberActivity(projectId, ben.userId, { lastSyncAt: Date.now() - 1000, clientAgent: 'CollectEarth/1.23.20 cloud-sync' });
    const { projectId: orphan } = await ctx.store.createProject({ name: 'Nobody' });

    const res = await call('GET', '/v1/admin/projects');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Secret name');
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.projects.find((p: AdminProject) => p.projectId === projectId)).toMatchObject({ status: 'active', people: 2, coordinators: 1, activeCoordinators: 1, needsCoordinator: false });
    expect(body.projects.find((p: AdminProject) => p.projectId === projectId).lastActivityAt).toBeGreaterThan(Date.now() - 60_000);
    expect(body.projects.find((p: AdminProject) => p.projectId === orphan)).toMatchObject({ people: 0, needsCoordinator: true, lastActivityAt: null });
    expect(body.counts.noCoordinator).toBe(1);
    expect((await call('GET', '/v1/admin/projects', ana.token)).statusCode).toBe(403);
  });

  it('archives and restores a project, said in its own log and the server activity', async () => {
    const { projectId } = await ctx.store.createProject({ name: 'P' });
    expect((await call('POST', `/v1/admin/projects/${projectId}/archive`, owner.token, {})).statusCode).toBe(400);
    expect((await call('POST', '/v1/admin/projects/00000000-0000-4000-8000-000000000000/archive', owner.token, { archived: true })).statusCode).toBe(404);
    const archived = await call('POST', `/v1/admin/projects/${projectId}/archive`, owner.token, { archived: true });
    expect(archived.json()).toEqual({ projectId, status: 'archived' });
    expect(await ctx.store.getProjectStatus(projectId)).toBe('archived');
    // restored as closed: the coordinator reopens it
    expect((await call('POST', `/v1/admin/projects/${projectId}/archive`, owner.token, { archived: false })).json()).toEqual({ projectId, status: 'closed' });
    const audit = await ctx.store.listAudit(projectId, { limit: 10 });
    expect(audit.map((a) => a.details)).toEqual([
      { setting: 'status', from: 'archived', status: 'closed', byServerAdmin: true },
      { setting: 'status', from: 'active', status: 'archived', byServerAdmin: true },
    ]);
    const log = (await call('GET', '/v1/admin/activity?kind=project')).json();
    expect(log.entries.map((e: { action: string }) => e.action)).toEqual(['project.restored', 'project.archived']);
    expect(log.entries[0]).toMatchObject({ actor: 'owner', projectId });
  });

  it('hands a project to a coordinator: a new member, or a member made coordinator; never a disabled account', async () => {
    const ana = await account('ana');
    const ben = await account('ben');
    const carla = await account('carla');
    const { projectId } = await ctx.store.createProject({ name: 'P' });
    await ctx.store.addMembership(projectId, ben.userId, 'operator');
    const hand = (username: string) => call('POST', `/v1/admin/projects/${projectId}/coordinator`, owner.token, { username });

    expect((await hand('nobody')).statusCode).toBe(404);
    expect((await hand('ana')).json()).toMatchObject({ projectId, userId: ana.userId, wasMember: false });
    expect((await ctx.store.getMembership(projectId, ana.userId))?.role).toBe('admin');
    expect((await hand('ben')).json()).toMatchObject({ wasMember: true });
    expect((await ctx.store.getMembership(projectId, ben.userId))?.role).toBe('admin');
    expect((await hand('ben')).statusCode).toBe(409);
    await ctx.store.disableUser(carla.userId, owner.userId);
    expect((await hand('carla')).json()).toMatchObject({ error: 'account_disabled' });
    // the project's people see who did it
    const audit = await ctx.store.listAudit(projectId, { limit: 10 });
    expect(audit[0]).toMatchObject({ action: 'member.role', actor: 'owner', details: { userId: ben.userId, role: 'admin', byServerAdmin: true } });
    expect((await call('POST', `/v1/admin/projects/${projectId}/coordinator`, ana.token, { username: 'ana' })).statusCode).toBe(403);
  });

  it('keeps what administrators do in the activity log, filtered by person and kind, as CSV too', async () => {
    const ana = await account('ana');
    await call('PUT' as 'POST', '/v1/admin/settings', owner.token, { signupOpen: true, serverName: 'Field server' });
    await call('POST', `/v1/admin/users/${ana.userId}/disable`);
    await call('POST', `/v1/admin/users/${ana.userId}/enable`);
    const made = await call('POST', '/v1/admin/users', owner.token, { accounts: [{ username: 'newbie' }] });
    // an administrator made, who then acts (disabling her ended her sessions: she signs in again)
    await call('POST', `/v1/admin/users/${ana.userId}/platform-admin`, owner.token, { on: true });
    const out = await call('POST', `/v1/admin/users/${made.json().results[0].userId}/sign-out`, await ctx.store.createSession(ana.userId));
    expect(out.statusCode, out.body).toBe(200);

    const all = (await call('GET', '/v1/admin/activity')).json();
    expect(all.entries.map((e: { action: string }) => e.action)).toEqual([
      'account.signed_out', 'account.admin_granted', 'account.created', 'account.enabled', 'account.disabled', 'settings.changed',
    ]);
    expect(all.entries.at(-1).details).toEqual({ signupOpen: true, serverName: 'changed' });
    expect(all.entries[0]).toMatchObject({ actor: 'ana', target: 'newbie' });
    expect(all.actors).toEqual(['ana', 'owner']);
    expect((await call('GET', '/v1/admin/activity?actor=ana')).json().total).toBe(1);
    expect((await call('GET', '/v1/admin/activity?kind=settings')).json().total).toBe(1);
    const paged = (await call('GET', '/v1/admin/activity?pageSize=4&page=2')).json();
    expect(paged).toMatchObject({ total: 6, page: 2, pages: 2 });
    expect(paged.entries).toHaveLength(2);
    // a saved setting that did not change is not kept
    await call('PUT' as 'POST', '/v1/admin/settings', owner.token, { signupOpen: true });
    expect((await call('GET', '/v1/admin/activity?kind=settings')).json().total).toBe(1);
    const csv = await call('GET', '/v1/admin/activity.csv?kind=account');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.trim().split('\r\n')).toHaveLength(6);
    expect((await call('GET', '/v1/admin/activity', (await account('dan')).token)).statusCode).toBe(403);
  });

  it('keeps a deleted account\'s name in the log', async () => {
    const ana = await account('ana');
    await ctx.app.inject({ method: 'DELETE', url: `/v1/admin/users/${ana.userId}`, headers: bearer(owner.token), payload: { confirm: 'ana' } });
    const [entry] = (await call('GET', '/v1/admin/activity')).json().entries;
    expect(entry).toMatchObject({ action: 'account.deleted', target: 'ana', targetUserId: null });
  });

  it('counts the Collect Earth versions the accounts use', async () => {
    const ana = await account('ana');
    const ben = await account('ben');
    const { projectId } = await ctx.store.createProject({ name: 'P' });
    await ctx.store.addMembership(projectId, ana.userId, 'operator');
    await ctx.store.addMembership(projectId, ben.userId, 'operator');
    await ctx.store.touchMemberActivity(projectId, ana.userId, { lastSyncAt: Date.now(), clientAgent: 'CollectEarth/1.23.20 cloud-sync' });
    await ctx.store.touchMemberActivity(projectId, ben.userId, { lastSyncAt: Date.now(), clientAgent: 'CollectEarth/1.21.4 cloud-sync' });
    const res = await call('GET', '/v1/admin/versions');
    expect(res.json()).toMatchObject({ days: 30, latest: '1.23.20', accounts: 2, outdatedAccounts: 1 });
    expect((await call('GET', '/v1/admin/versions', ana.token)).statusCode).toBe(403);
  });

  it('tells how mail is set up, the stopped weekly mails, and sends a test email to the administrator', async () => {
    const ana = await account('ana', 'ana@example.org');
    await ctx.store.setDigest(ana.userId, 'collector', true, Date.now());
    for (let i = 0; i < 3; i++) await ctx.store.noteDigestFailure(ana.userId, 'collector', Date.now(), 3);
    const check = (await call('GET', '/v1/admin/mail')).json();
    expect(check).toMatchObject({
      delivers: true,
      from: 'Collect Earth Cloud <noreply@example.org>',
      server: { host: 'mail.example.org', port: 465, secure: true },
      ownAddress: null,
      stopped: [{ username: 'ana', email: 'ana@example.org', kind: 'collector', failures: 3 }],
    });
    expect(JSON.stringify(check)).not.toContain('secret');

    expect((await call('POST', '/v1/admin/mail/test', owner.token, {})).json()).toMatchObject({ error: 'no_address' });
    await ctx.store.setEmail(owner.userId, 'owner@example.org');
    const sent = await call('POST', '/v1/admin/mail/test', owner.token, { language: 'fr' });
    expect(sent.json()).toEqual({ sent: true, to: 'owner@example.org' });
    expect(mailer.sent.at(-1)).toMatchObject({ to: 'owner@example.org', tag: 'server.test' });
    expect(mailer.sent.at(-1)!.subject).toContain('courriel de test');

    mailer.fail = () => true;
    mailer.failWith = { code: 'EENVELOPE', responseCode: 550, response: '550 5.1.1 no such user owner@example.org' };
    const refused = await call('POST', '/v1/admin/mail/test', owner.token, {});
    expect(refused.statusCode).toBe(502);
    expect(refused.json()).toEqual({ error: 'mail_refused', code: 'EENVELOPE', responseCode: 550, command: null, senderLimit: false });
    const log = (await call('GET', '/v1/admin/activity?kind=mail')).json();
    expect(log.entries.map((e: { details: unknown }) => e.details)).toEqual([{ sent: false, code: 'EENVELOPE', responseCode: 550 }, { sent: true }]);
    expect((await call('GET', '/v1/admin/mail', ana.token)).statusCode).toBe(403);
  });
});
