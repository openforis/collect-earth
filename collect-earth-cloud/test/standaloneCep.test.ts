import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { standaloneCep } from '../src/standaloneCep.js';
import { cepWith, idOnlyCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// The project file for working alone (docs/plans/2026-11-16-plots-from-the-server.md, stage 4).

const filesOf = (zip: Buffer) => {
  const files = unzipSync(new Uint8Array(zip));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
};

describe('the project file for working alone', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let ana: { token: string; userId: string };

  const call = (path: string, token = owner.token) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}${path}`, headers: bearer(token) });
  const put = (path: string, payload: Buffer | string, type: string) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}${path}`, headers: { ...bearer(owner.token), 'content-type': type }, payload });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Bolivia: forests')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: invite.json().inviteToken } });
    ana = { token: res.json().token, userId: res.json().userId };
    await put('/cep', idOnlyCep(), 'application/zip');
    const north = (await put('/csv-files/north.csv', 'id,lat,lon\n1,-10,20\n2,-10,21\n3,-10,22\n', 'text/csv')).json().id;
    await put('/csv-files/south.csv', 'id,lat,lon\n4,-11,20\n', 'text/csv');
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/${north}/distribution`, headers: bearer(owner.token), payload: { mode: 'even', people: [ana.userId, owner.userId], order: 'file' } });
  });
  afterEach(async () => ctx.app.close());

  it('has all the project’s plots in the plot file the project file opens, with the round the server adds', async () => {
    const res = await call('/cep/standalone?plots=all');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('all.cep');
    expect(res.headers['x-plots']).toBe('4');
    const files = filesOf(res.rawPayload);
    const csvLine = files['project_definition.properties'].split('\n').find((l) => l.startsWith('csv='))!;
    const named = csvLine.replace('csv=${project_path}/', '').trim();
    // as the server serves them: the round, and the coordinator's note column the survey has
    const lines = files[named].trim().split('\n');
    expect(lines.map((l) => l.split(',').slice(0, 4).join(','))).toEqual(['id,round,lat,lon', '1,1,-10,20', '2,1,-10,21', '3,1,-10,22', '4,1,-11,20']);
    expect(lines[0].endsWith('coordinator_note')).toBe(true);
    // the activity log says it
    const log = (await call('/activity?kind=downloads')).json();
    expect(JSON.stringify(log)).toContain('standalone');
  });

  it('has a person’s own plots for them; another person’s or all for coordinators only', async () => {
    const mine = await call('/cep/standalone?plots=mine', ana.token);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.headers['content-disposition']).toContain('ana.cep');
    expect(mine.headers['x-plots']).toBe('2');
    expect((await call(`/cep/standalone?userId=${ana.userId}`)).headers['x-plots']).toBe('2');
    expect((await call('/cep/standalone?plots=all', ana.token)).statusCode).toBe(403);
    expect((await call(`/cep/standalone?userId=${owner.userId}`, ana.token)).statusCode).toBe(403);
    expect((await call('/cep/standalone')).statusCode).toBe(400);
    // nobody's plots: nothing to put in it
    expect((await call('/cep/standalone?userId=nobody')).statusCode).toBe(400);
  });

  it('empties the other plot files of the project file, and names a plot file when it named none', () => {
    const date = new Date(Date.UTC(2026, 10, 16));
    const named = standaloneCep(
      cepWith({ 'project_definition.properties': 'survey_name=x\ncsv=${project_path}/grid/a.csv\n', 'grid/a.csv': 'id,lat,lon\n1,1,1\n', 'grid/b.csv': 'id,lat,lon\n9,9,9\n', 'placemark.idm.xml': '<survey/>' }),
      Buffer.from('id,lat,lon\n5,5,5\n'),
      date,
    );
    expect(filesOf(named)['grid/a.csv']).toBe('id,lat,lon\n5,5,5\n');
    expect(filesOf(named)['grid/b.csv']).toBe('id,lat,lon\n');
    const none = filesOf(standaloneCep(cepWith({ 'project_definition.properties': 'survey_name=x\n', 'placemark.idm.xml': '<survey/>' }), Buffer.from('id,lat,lon\n5,5,5\n'), date));
    expect(none['grid/plots.csv']).toBe('id,lat,lon\n5,5,5\n');
    expect(none['project_definition.properties']).toContain('csv=${project_path}/grid/plots.csv');
  });

  it('carries no key nor password of a project file stored before uploads were cleaned of them', () => {
    const stored = cepWith({
      'project_definition.properties': 'survey_name=x\nplanet_maps_key=PLANET-SECRET\ndb_password=hunter22\ncsv=${project_path}/grid/a.csv\n',
      'grid/a.csv': 'id,lat,lon\n1,1,1\n',
      'placemark.idm.xml': '<survey/>',
    });
    const properties = filesOf(standaloneCep(stored, Buffer.from('id,lat,lon\n5,5,5\n'), new Date()))['project_definition.properties'];
    expect(properties).not.toContain('PLANET-SECRET');
    expect(properties).not.toContain('hunter22');
    expect(properties).toContain('csv=${project_path}/grid/a.csv');
    // marked, so that Collect Earth on a computer in the cloud project says it is not for it
    expect(properties).toMatch(/^cloud_standalone=true$/m);
  });
});
