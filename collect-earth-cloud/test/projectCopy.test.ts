import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';

const CSV = 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n';

async function registerUser(app: FastifyInstance, pid: string, adminToken: string, username: string, role = 'operator') {
  const invite = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(adminToken), payload: { role, maxUses: 1 } });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
  return { userId: res.json().userId as string, token: res.json().token as string };
}

describe('copying a project (a template)', () => {
  let ctx: TestContext;
  let owner: string;
  let ownerId: string;
  let src: string;
  let maria: { userId: string; token: string };
  let jose: { userId: string; token: string };
  let divided: string;
  let whole: string;

  const call = (method: 'GET' | 'PUT' | 'POST', pid: string, path: string, payload?: unknown, token = owner) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
  const copy = (payload: unknown, token = owner, pid = src) => call('POST', pid, '/copy', payload, token);

  beforeEach(async () => {
    ctx = await makeContext();
    const admin = await setupPlatformAdmin(ctx.app);
    owner = admin.token;
    ownerId = admin.userId;
    src = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner), payload: { name: 'Bolivia 2026' } })).json().projectId;
    expect((await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${src}/cep`, headers: { ...bearer(owner), 'content-type': 'application/zip' }, payload: idOnlyCep() })).statusCode).toBe(200);
    const put = (name: string) => ctx.app.inject({ method: 'PUT', url: `/v1/projects/${src}/csv-files/${name}`, headers: { ...bearer(owner), 'content-type': 'text/csv' }, payload: CSV });
    divided = (await put('divided.csv')).json().id;
    whole = (await put('whole.csv')).json().id;
    maria = await registerUser(ctx.app, src, owner, 'maria');
    jose = await registerUser(ctx.app, src, owner, 'jose', 'reviewer');
    expect((await call('PUT', src, `/csv-files/${divided}/distribution`, { mode: 'even', people: [maria.userId, jose.userId], order: 'file' })).statusCode).toBe(200);
    expect((await call('PUT', src, '/assignments', { assignments: [{ userId: maria.userId, csvFileId: whole }] })).statusCode).toBe(200);
    expect((await call('PUT', src, '/progress/settings', { deadline: '2099-01-31', targetPlots: 4, quietDays: 5 })).statusCode).toBe(200);
    // Work that must never travel: records, a decision.
    expect((await batchRequest(ctx.app, src, maria.token, [envelope({ recordKey: '1,1' })])).statusCode).toBe(200);
    await ctx.store.setQualityDecision(src, '1', 'first', 'fine', ownerId);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('makes a draft with the survey, plot files and settings, without the people or any work', async () => {
    const res = await copy({ name: 'Bolivia 2027' });
    expect(res.statusCode, res.body).toBe(201);
    const { projectId, name, status } = res.json();
    expect({ name, status }).toEqual({ name: 'Bolivia 2027', status: 'draft' });
    expect(projectId).not.toBe(src);

    expect((await call('GET', projectId, '/cep')).rawPayload.equals((await call('GET', src, '/cep')).rawPayload)).toBe(true);
    expect((await call('GET', projectId, '/cep/original')).rawPayload.equals(idOnlyCep())).toBe(true);
    expect((await call('GET', projectId, '/round')).json()).toEqual((await call('GET', src, '/round')).json());
    const files = await ctx.store.listCsvFiles(projectId);
    expect(files.map((f) => [f.filename, f.plotCount, f.distribution ?? null]).sort()).toEqual([
      ['divided.csv', 4, null],
      ['whole.csv', 4, null],
    ]);
    expect((await call('GET', projectId, '/progress/settings')).json()).toEqual({ deadline: '2099-01-31', targetPlots: 4, quietDays: 5 });

    expect((await ctx.store.listMembers(projectId)).map((m) => [m.username, m.role])).toEqual([['owner', 'admin']]);
    expect(await ctx.store.listAssignments(projectId)).toEqual([]);
    expect(await ctx.store.listRecords(projectId, true)).toEqual([]);
    expect(await ctx.store.listQualityDecisions(projectId)).toEqual([]);
    // The source is untouched, and the copy says where it came from.
    expect(await ctx.store.listRecords(src)).toHaveLength(1);
    const log = await ctx.store.listAudit(projectId, { limit: 5 });
    expect(log[0]).toMatchObject({ action: 'settings.changed', actorUserId: ownerId, details: { setting: 'copy', from: 'Bolivia 2026' } });
  });

  it('with the people: members, whole-file assignments and the division come along', async () => {
    const res = await copy({ name: 'Team copy', members: true });
    expect(res.statusCode, res.body).toBe(201);
    const pid = res.json().projectId;
    expect((await ctx.store.listMembers(pid)).map((m) => [m.username, m.role]).sort()).toEqual([
      ['jose', 'reviewer'],
      ['maria', 'operator'],
      ['owner', 'admin'],
    ]);
    const files = new Map((await ctx.store.listCsvFiles(pid)).map((f) => [f.filename, f]));
    expect((await ctx.store.listAssignments(pid)).map((a) => [a.username, a.filename])).toEqual([['maria', 'whole.csv']]);
    const newDivided = files.get('divided.csv')!;
    expect(newDivided.distribution).toMatchObject({ mode: 'even', people: [maria.userId, jose.userId] });
    const holdings = (rows: { plotKey: string; userId: string; overlap: boolean }[]) => rows.map((r) => `${r.plotKey}:${r.userId}:${r.overlap}`).sort();
    expect(holdings(await ctx.store.listPlotAssignments(pid, newDivided.id))).toEqual(holdings(await ctx.store.listPlotAssignments(src, divided)));
    // A collector of the copy cannot sync while it is a draft.
    expect((await batchRequest(ctx.app, pid, maria.token, [envelope()])).json()).toMatchObject({ error: 'project_draft' });
  });

  it('is the coordinators’, needs a name, follows the creation rules and works from a closed project', async () => {
    expect((await copy({ name: 'x' }, maria.token)).statusCode).toBe(403);
    expect((await copy({ name: '  ' })).json()).toMatchObject({ error: 'bad_request' });
    expect((await call('PUT', src, '/status', { status: 'closed' })).statusCode).toBe(200);
    expect((await copy({ name: 'From closed' })).statusCode).toBe(201);
    // Someone who may not create projects cannot copy one either.
    const pid = (await copy({ name: 'Mine', members: true })).json().projectId;
    await ctx.store.setMemberRole(pid, maria.userId, 'admin');
    expect((await copy({ name: 'Not allowed' }, maria.token, pid)).json()).toMatchObject({ error: 'project_creation_restricted' });
  });
});
