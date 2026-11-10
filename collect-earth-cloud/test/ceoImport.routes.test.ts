// A new project from a Collect Earth Online project (src/routes/ceoImport.ts, plan docs/plans/2026-11-09-ceo-bridge.md,
// B4 and B5), on the public CEO projects of test/fixtures/ceo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCep } from '../src/cep.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/ceo/', import.meta.url));
const ceo = (id: number) => JSON.parse(readFileSync(`${FIXTURES}project-${id}.json`, 'utf8')) as Record<string, unknown>;
const ceoPlots = (id: number) => readFileSync(`${FIXTURES}project-${id}-plots.json`, 'utf8');

describe('a new project from a Collect Earth Online project', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  const post = (path: string, payload: unknown, token = owner.token) =>
    ctx.app.inject({ method: 'POST', url: `/v1/projects/from-ceo${path}`, headers: bearer(token), payload: payload as object });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('the preview says what will come across, and stores nothing', async () => {
    const res = await post('/preview', { ceoProject: ceo(2616) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ name: 'Mexico Review', ceoProjectId: 2616, counts: { questions: 29, questionsSkipped: 0, rulesSkipped: 0 } });
    expect(body.counts.rules).toBeGreaterThan(0);
    expect(body.report.some((e: { area: string }) => e.area === 'rule')).toBe(true);
    expect(await ctx.store.listMemberships(owner.userId)).toEqual([]);
  });

  it('refuses what is no CEO project, a simplified one, and anyone not signed in', async () => {
    expect((await post('/preview', { ceoProject: { name: 'x' } })).json()).toMatchObject({ error: 'ceo_unreadable' });
    expect((await post('/preview', { ceoProject: 'not json' })).json()).toMatchObject({ error: 'ceo_unreadable' });
    expect((await post('/preview', {})).statusCode).toBe(400);
    expect((await post('', { ceoProject: ceo(64113) })).json()).toMatchObject({ error: 'ceo_unreadable', reason: expect.stringContaining('simplified') });
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/projects/from-ceo/preview', payload: { ceoProject: ceo(1) } })).statusCode).toBe(401);
  });

  it('makes the project, its caller its coordinator, its project file through the upload path (round added)', async () => {
    const res = await post('', { ceoProject: ceo(2616) });
    expect(res.statusCode, res.body).toBe(201);
    const { projectId, name, round, reportText } = res.json();
    expect(name).toBe('Mexico Review');
    expect(round).toBe('added');
    expect(reportText).toContain('Imported from Collect Earth Online, project 2616');
    expect((await ctx.store.listMemberships(owner.userId)).map((m) => [m.projectId, m.role])).toEqual([[projectId, 'admin']]);

    // what Collect Earth downloads: the survey with its round key, the balloon and template edited for it
    const cep = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: bearer(owner.token) });
    expect(cep.statusCode).toBe(200);
    const files = readCep(cep.rawPayload);
    expect(files.surveyPath).toBe('placemark.idm.xml');
    const entries = unzipSync(new Uint8Array(cep.rawPayload));
    expect(strFromU8(entries['placemark.idm.xml'])).toContain('name="round"');
    expect(strFromU8(entries['balloon.html'])).toContain('collect_code_round');
    expect(strFromU8(entries['kml_template.fmt'])).toContain('<Data name="EXTRA_round">');
    expect(entries['earthFiles/README.txt']).toBeDefined();
    expect(strFromU8(entries['project_definition.properties'])).toMatch(/sample_shape=CIRCLE/);

    // the report stays with the project: in its project file and, counted, in its log
    expect(strFromU8(entries['ceo_import_report.txt'])).toContain('Questions: 28 imported, 1 changed, 0 left out.');
    const log = await ctx.store.listAudit(projectId, { limit: 10 });
    expect(log.find((e) => e.action === 'project.imported')).toMatchObject({ actorUserId: owner.userId, details: { source: 'ceo', ceoProjectId: 2616, questions: 29 } });
  });

  it('takes another name when one is given', async () => {
    const res = await post('', { ceoProject: JSON.stringify(ceo(1)), name: '  Mekong 2026  ' });
    expect(res.json()).toMatchObject({ name: 'Mekong 2026' });
  });

  it('who may make a project may import one: refused as POST /v1/projects refuses', async () => {
    await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { signupOpen: true } });
    const signup = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'maria', password: 'password12' } });
    expect(signup.statusCode, signup.body).toBe(201);
    const maria = signup.json().token as string;
    const refused = await post('', { ceoProject: ceo(1) }, maria);
    expect(refused.statusCode).toBe(403);
    expect(await ctx.store.listMemberships(signup.json().userId)).toEqual([]);
    // the preview stores nothing: anyone signed in may see it
    expect((await post('/preview', { ceoProject: ceo(1) }, maria)).statusCode).toBe(200);
  });

  it("with CEO's plot list: its plots become the project's plot file, under CEO's plot ids", async () => {
    const preview = await post('/preview', { ceoProject: ceo(743), ceoPlots: ceoPlots(743) });
    expect(preview.json().counts).toMatchObject({ plots: 210 });
    expect((await post('/preview', { ceoProject: ceo(743) })).json().counts.plots).toBeNull();

    const res = await post('', { ceoProject: ceo(743), ceoPlots: ceoPlots(743) });
    expect(res.statusCode, res.body).toBe(201);
    const { projectId, plotFile, round } = res.json();
    expect(round).toBe('added');
    expect(plotFile).toMatchObject({ filename: 'ceo_743_plots.csv', plots: 210 });

    const files = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/csv-files`, headers: bearer(owner.token) });
    expect(files.json().csvFiles).toMatchObject([{ id: plotFile.csvFileId, filename: 'ceo_743_plots.csv', plotCount: 210 }]);
    // What a collector downloads: the round the server added, CEO's ids, the centres, the survey's columns
    const content = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/csv-files/${plotFile.csvFileId}/content`, headers: bearer(owner.token) });
    expect(content.statusCode).toBe(200);
    const lines = content.body.trim().split('\n');
    expect(lines).toHaveLength(211);
    expect(lines[0]).toMatch(/^id,YCoordinate,XCoordinate,elevation,slope,aspect/);
    expect(lines[1]).toMatch(/^1,41\.80074\d,12\.37142\d,0,0,0/);

    // the project file draws them as CEO did: 6 × 6 samples 20 m apart on a 100 m square
    const cep = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: bearer(owner.token) });
    const properties = strFromU8(unzipSync(new Uint8Array(cep.rawPayload))['project_definition.properties']);
    expect(properties).toContain('sample_shape=SQUARE\nnumber_of_sampling_points_in_plot=36\ndistance_between_sample_points=20\ndistance_to_plot_boundaries=0');

    const log = await ctx.store.listAudit(projectId, { limit: 10 });
    expect(log.map((e) => e.action).sort()).toEqual(['csv.uploaded', 'project.imported']);
    expect(log.find((e) => e.action === 'csv.uploaded')?.details).toEqual({ csvFileId: plotFile.csvFileId, plots: 210 });
  });

  it("refuses another project's plot list, and makes nothing", async () => {
    const res = await post('', { ceoProject: ceo(1), ceoPlots: ceoPlots(743) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'ceo_unreadable', reason: expect.stringContaining("outside this project's area") });
    expect((await post('', { ceoProject: ceo(1), ceoPlots: 12 })).json()).toMatchObject({ error: 'bad_request' });
    expect(await ctx.store.listMemberships(owner.userId)).toEqual([]);
  });

  it('every importable fixture makes a project whose round is added', async () => {
    for (const id of [1, 743, 5455, 20170, 30918, 46643, 53855, 54724, 17814, 32770, 33290, 37956]) {
      const res = await post('', { ceoProject: ceo(id) });
      expect(res.statusCode, `${id}: ${res.body.slice(0, 200)}`).toBe(201);
      expect(res.json().round, String(id)).toBe('added');
    }
  });
});
