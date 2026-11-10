import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';
import { qualityFigures } from '../src/answerStats.js';

const LAND_USE = 'collect_code_land_use_category';

async function registerUser(app: FastifyInstance, pid: string, adminToken: string, username: string, role = 'operator') {
  const invite = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(adminToken), payload: { role, maxUses: 1 } });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
  return { userId: res.json().userId as string, token: res.json().token as string };
}

describe('qualityFigures: people left out of the results', () => {
  it('leaves their records out of every figure', () => {
    const records = [
      { recordKey: '1', operator: 'ana', modifiedOn: 1, activelySaved: true, deleted: false, summary: { [LAND_USE]: 'F' } },
      { recordKey: '2', operator: 'ben', modifiedOn: 1, activelySaved: true, deleted: false, summary: { [LAND_USE]: 'G' } },
    ];
    const input = { records, info: null, units: new Set(['1', '2']), copyHolders: new Map(), outline: null };
    expect(qualityFigures(input).answers.operators).toEqual(['ana', 'ben']);
    expect(qualityFigures({ ...input, excluded: ['ben'] }).answers.operators).toEqual(['ana']);
  });
});

describe('leaving a collector out of the results (routes)', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  let pid: string;
  let ben: { userId: string; token: string };
  const admin = () => bearer(project.adminToken);
  const url = (path: string) => `/v1/projects/${pid}${path}`;
  const get = (path: string, headers = admin()) => ctx.app.inject({ method: 'GET', url: url(path), headers });
  const setExcluded = (userId: string, payload: unknown, headers = admin()) =>
    ctx.app.inject({ method: 'PUT', url: url(`/members/${userId}/excluded`), headers, payload: payload as object });
  const fresh = async () => {
    for (let i = 0; i < 200; i++) {
      const body = (await get('/quality')).json();
      if (!body.stale) return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Excluded');
    pid = project.projectId;
    await ctx.app.inject({ method: 'PUT', url: url('/cep'), headers: { ...admin(), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    const csv = ['id,lat,lon', ...Array.from({ length: 5 }, (_, i) => `${i + 1},0,0`)].join('\n');
    await ctx.app.inject({ method: 'PUT', url: url('/csv-files/plots.csv'), headers: { ...admin(), 'content-type': 'text/csv' }, payload: csv });
    await registerUser(ctx.app, pid, project.adminToken, 'ana');
    ben = await registerUser(ctx.app, pid, project.adminToken, 'ben');
    const records = [];
    for (let i = 1; i <= 5; i++) {
      records.push(envelope({ recordKey: `${i},1`, operator: 'ana', summary: { [LAND_USE]: 'F', collect_code_round: '1' } }));
      records.push(envelope({ recordKey: `${i},2`, operator: 'ben', summary: { [LAND_USE]: 'G', collect_code_round: '2' } }));
    }
    expect((await batchRequest(ctx.app, pid, project.projectToken, records)).statusCode).toBe(200);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('leaves their records out of the figures and the export, says so, logs it, and can be undone', async () => {
    expect((await fresh()).plotsChecked).toBe(5);

    const res = await setExcluded(ben.userId, { excluded: true, reason: 'did not follow the protocol' });
    expect(res.statusCode, res.body).toBe(200);
    const members = (await get('/members')).json().members;
    expect(members.find((m: { username: string }) => m.username === 'ben').excluded).toMatchObject({ reason: 'did not follow the protocol' });
    expect(members.find((m: { username: string }) => m.username === 'ana')).not.toHaveProperty('excluded');

    // The cached figures are worked out again: no check is left.
    const quality = await fresh();
    expect(quality.plotsChecked).toBe(0);
    expect(quality.excluded).toEqual([{ username: 'ben', reason: 'did not follow the protocol' }]);
    const people = (await get('/people')).json().people;
    expect(people.find((p: { username: string }) => p.username === 'ben').excluded).toMatchObject({ reason: 'did not follow the protocol' });

    const csv = (await get('/export.csv')).body;
    expect(csv).toContain(',ana,');
    expect(csv).not.toContain(',ben,');
    expect((await get('/export.csv?excluded=include')).body).toContain(',ben,');
    // The map exports share the rows: left out there too.
    const geojson = await get('/export.geojson');
    expect(geojson.statusCode).toBe(200);
    expect(geojson.body).toContain('"ana"');
    expect(geojson.body).not.toContain('"ben"');
    expect((await get('/export.geojson?excluded=include')).body).toContain('"ben"');

    const log = JSON.stringify((await get('/activity?kind=people')).json());
    expect(log).toContain('member.excluded');

    expect((await setExcluded(ben.userId, { excluded: false })).statusCode).toBe(200);
    expect((await fresh()).plotsChecked).toBe(5);
    expect((await get('/members')).json().members.find((m: { username: string }) => m.username === 'ben')).not.toHaveProperty('excluded');
  });

  it('is the coordinators`: 400 for a bad body, 404 for someone not in the project, 403 for a collector', async () => {
    expect((await setExcluded(ben.userId, { excluded: 'yes' })).statusCode).toBe(400);
    expect((await setExcluded(ben.userId, { excluded: true, reason: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await setExcluded('00000000-0000-4000-8000-000000000000', { excluded: true })).statusCode).toBe(404);
    expect((await setExcluded(ben.userId, { excluded: true }, bearer(ben.token))).statusCode).toBe(403);
  });
});
