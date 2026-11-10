// A new project from a Collect Earth Online project (src/routes/ceoImport.ts, plan docs/plans/2026-11-09-ceo-bridge.md,
// B4 and B5), on the public CEO projects of test/fixtures/ceo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/ceo/answers.js';
import { readCep } from '../src/cep.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/ceo/', import.meta.url));
const ceo = (id: number) => JSON.parse(readFileSync(`${FIXTURES}project-${id}.json`, 'utf8')) as Record<string, unknown>;
const ceoPlots = (id: number) => readFileSync(`${FIXTURES}project-${id}-plots.json`, 'utf8');
const ceoAnswers = (id: number) => readFileSync(`${FIXTURES}project-${id}-samples.csv`, 'utf8');
/** The rows of the coordinator's export.csv, by column */
const exportRows = (csv: string) => {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, '')).filter((r) => r.length > 1);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};
const JAVA_RESOURCES = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/ceo/answers/', import.meta.url));

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

  describe("with CEO's answers (Part C)", () => {
    const withAnswers = (extra: object = {}) => ({ ceoProject: ceo(20170), ceoPlots: ceoPlots(20170), ceoAnswers: ceoAnswers(20170), ...extra });

    /**
     * For CeoRecordsXmlTest and CeoSurveyIdmlTest: the survey a project serves and its records with their summaries, in
     * src/test/resources/ceo/answers/<folder> of the desktop (UPDATE_CEO_IDML=1 writes them again)
     */
    const javaFixtures = async (projectId: string, folder: string) => {
      const stored = await ctx.store.listRecords(projectId);
      const xml = await ctx.store.getRecordXml(projectId, stored.map((r) => ({ recordKey: r.recordKey, operator: r.operator })));
      const files = readCep(Buffer.from((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: bearer(owner.token) })).rawPayload));
      const written = new Map<string, string>([['placemark.idm.xml', new TextDecoder().decode(files.entries.get(files.surveyPath)!)]]);
      for (const x of xml) {
        const name = `${x.recordKey.replace(',', '_')}-${x.operator}`;
        written.set(`${name}.xml`, x.xml!);
        const summary = stored.find((r) => r.recordKey === x.recordKey && r.operator === x.operator)!.summary;
        written.set(`${name}.summary.json`, JSON.stringify(Object.fromEntries(Object.entries(summary).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + '\n');
      }
      const dir = `${JAVA_RESOURCES}${folder}/`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      for (const [name, text] of written) {
        const path = dir + name;
        if (process.env.UPDATE_CEO_IDML === '1' || !existsSync(path)) writeFileSync(path, text);
        // a Windows checkout (core.autocrlf) has the file with CRLF: only the content is compared
        expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), path).toBe(text.replace(/\r\n/g, '\n'));
      }
    };

    it('the preview counts them, and gives the collectors to map; answers need the plots', async () => {
      const res = await post('/preview', withAnswers());
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().answers).toEqual({
        plots: 5, flagged: 1,
        collectors: [{ email: 'ana@example.org', plots: 3 }, { email: 'ben@example.org', plots: 2 }],
      });
      expect((await post('/preview', { ceoProject: ceo(20170) })).json().answers).toBeNull();
      expect((await post('', { ceoProject: ceo(20170), ceoAnswers: ceoAnswers(20170) })).json()).toMatchObject({ error: 'ceo_unreadable', reason: expect.stringContaining('plots file') });
      expect((await post('/preview', withAnswers({ ceoAnswers: 'name,age\nana,3' }))).json()).toMatchObject({ error: 'ceo_unreadable' });
      expect((await post('/preview', withAnswers({ ceoAnswers: ceoAnswers(30918) }))).json()).toMatchObject({ error: 'ceo_unreadable', reason: expect.stringContaining("another project's") });
    });

    it('stores one record per plot and collector, as a sync would, under pseudonyms or the accounts named', async () => {
      // ben has an account on the server (another project's)
      await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { signupOpen: true } });
      const ben = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'ben', password: 'ben-password1' } })).json();

      const res = await post('', withAnswers({ collectors: { 'ben@example.org': 'ben' } }));
      expect(res.statusCode, res.body).toBe(201);
      const { projectId, plotFile, doneFile, records, collectors } = res.json();
      expect(records).toBe(5);
      expect(collectors).toEqual([
        { email: 'ana@example.org', plots: 3, username: 'ceo-collector-1' },
        { email: 'ben@example.org', plots: 2, username: 'ben' },
      ]);
      // the plots answered (not flagged) apart, so only the others are given out
      expect(doneFile).toMatchObject({ filename: 'ceo_20170_plots_done.csv', plots: 2 });
      expect(plotFile).toMatchObject({ filename: 'ceo_20170_plots.csv', plots: 264 });
      // ben joined as a collector
      expect((await ctx.store.listMemberships(ben.userId)).map((m) => [m.projectId, m.role])).toEqual([[projectId, 'operator']]);

      const exported = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/export.csv`, headers: bearer(owner.token) });
      const rows = exportRows(exported.body);
      const row = (plot: string, operator: string) => rows.find((r) => r.plot === plot && r.operator === operator)!;
      expect(rows).toHaveLength(5);
      expect(row('138814414', 'ceo-collector-1')).toMatchObject({
        record_key: '138814414,1', round: '1', actively_saved: 'true', modified_on: '2024-12-31T10:05:00.000Z',
        collect_code_visible_strata: 'degradation', collect_code_mixed: 'yes', collect_code_secondary_visible_strata: 'other',
        collect_text_secondary_notes_or_type_of_other: 'logging road, near the river', collect_code_confidence: 'high',
        collect_real_year_disturbed: '2015.0', collect_text_operator: 'ceo-collector-1', collect_boolean_ceo_flagged: 'false',
        collect_coord_location: '26.66312053,87.4837365', collect_date_actively_saved_on: '12/31/2024',
      });
      expect(row('138814414', 'ben')).toMatchObject({ collect_code_visible_strata: 'stable_forest', collect_code_confidence: 'medium', collect_code_secondary_visible_strata: '' });
      expect(row('138814419', 'ben').collect_text_notes_or_type_of_other).toBe('river bed gravel');
      expect(row('138814420', 'ceo-collector-1')).toMatchObject({ actively_saved: 'false', collect_boolean_ceo_flagged: 'true', collect_code_visible_strata: '' });
      expect(row('138814421', 'ceo-collector-1')).toMatchObject({ actively_saved: 'false', collect_code_visible_strata: '', collect_code_confidence: 'high' });

      // the time spent in CEO, and a record event for each submission (progress counts them)
      const stored = await ctx.store.listRecords(projectId);
      const first = stored.find((r) => r.recordKey === '138814414,1' && r.operator === 'ceo-collector-1')!;
      expect(first.activeSeconds).toBe(95);
      // received when CEO saved it: the Progress tab does not take CEO's old work for work that arrives late
      expect(first.receivedAt).toBe(first.modifiedOn);
      const progress = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/progress`, headers: bearer(owner.token) });
      expect(progress.statusCode).toBe(200);
      expect(JSON.stringify(progress.json())).toContain('"submitted"');

      // the log says how many, never who in CEO
      const log = await ctx.store.listAudit(projectId, { limit: 10 });
      expect(log.find((e) => e.action === 'project.imported')?.details).toMatchObject({ records: 5, collectors: 2 });
      expect(JSON.stringify(log)).not.toContain('example.org');
      const cep = unzipSync(new Uint8Array((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: bearer(owner.token) })).rawPayload));
      expect(strFromU8(cep['ceo_import_report.txt'])).not.toContain('example.org');

      // for CeoRecordsXmlTest: the survey served and the records, which Collect itself reads
      await javaFixtures(projectId, '20170');
    });

    it("keeps CEO's confidence, and the answer of most samples", async () => {
      const res = await post('', { ceoProject: ceo(30918), ceoPlots: ceoPlots(30918), ceoAnswers: ceoAnswers(30918) });
      expect(res.statusCode, res.body).toBe(201);
      const rows = exportRows((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${res.json().projectId}/export.csv`, headers: bearer(owner.token) })).body);
      const plot = rows.find((r) => r.plot === '1425')!;
      expect(plot).toMatchObject({ collect_code_forest2017: 'yes', collect_code_forest_trend_2013to2017: 'decreasing', collect_integer_ceo_confidence: '80', collect_code_land_cover_change_2013to2017: '' });
      expect(rows.find((r) => r.plot === '1680')).toMatchObject({ collect_real_stable_canopy_cover: '72.5', collect_integer_ceo_confidence: '100' });
      expect(res.json().report.find((e: { subject: string }) => e.subject === 'Samples that disagree')).toMatchObject({ outcome: 'changed' });
    });

    it("reads a real download of CEO's sample data (RLCMS Cambodia, its emails replaced)", async () => {
      const res = await post('', { ceoProject: ceo(37), ceoPlots: ceoPlots(37), ceoAnswers: ceoAnswers(37) });
      expect(res.statusCode, res.body).toBe(201);
      const body = res.json();
      // 50 plots; three nobody answered in CEO, four flagged
      expect(body.answers).toMatchObject({ plots: 47, flagged: 4 });
      expect(body.collectors.map((c: { email: string; username: string }) => c.username)).toContain('ceo-collector-1');
      expect(body.collectors.some((c: { email: string }) => c.email === 'guest')).toBe(true);
      expect(body.doneFile.plots + body.plotFile.plots).toBe(50);
      expect(body.report.find((e: { subject: string }) => e.subject === 'Samples that disagree')).toMatchObject({ outcome: 'changed' });

      // the columns of the plot file uploaded to CEO, on the plots and on the records
      const content = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${body.projectId}/csv-files/${body.doneFile.csvFileId}/content`, headers: bearer(owner.token) });
      expect(content.body.split('\n')[0]).toMatch(/^id,YCoordinate,XCoordinate,elevation,slope,aspect,year,class,country,countryname/);
      expect(content.body).toMatch(/\n1,11\.57\d+,105\.08\d+,0,0,0,2013,0,5,Cambodia/);
      const rows = exportRows((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${body.projectId}/export.csv`, headers: bearer(owner.token) })).body);
      expect(rows.find((r) => r.plot === '1')).toMatchObject({ collect_code_lulc: 'aquatic_veg_other', collect_text_year: '2013', collect_text_countryname: 'Cambodia', actively_saved: 'true', modified_on: '2019-03-01T00:00:00.000Z' });

      // CEO's "0.0 secs" (answers loaded in bulk) is no time spent
      const stored = await ctx.store.listRecords(body.projectId);
      expect(stored.find((r) => r.recordKey === '1,1')?.activeSeconds ?? null).toBeNull();
      expect(stored.some((r) => (r.activeSeconds ?? 0) > 0)).toBe(true);
      await javaFixtures(body.projectId, '37');
    });

    it('refuses an account that does not exist, and makes nothing', async () => {
      const res = await post('', withAnswers({ collectors: { 'ana@example.org': 'nobody' } }));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'unknown_account', username: 'nobody' });
      expect(await ctx.store.listMemberships(owner.userId)).toEqual([]);
    });
  });

  it('every importable fixture makes a project whose round is added', async () => {
    for (const id of [1, 743, 5455, 20170, 30918, 46643, 53855, 54724, 17814, 32770, 33290, 37956]) {
      const res = await post('', { ceoProject: ceo(id) });
      expect(res.statusCode, `${id}: ${res.body.slice(0, 200)}`).toBe(201);
      expect(res.json().round, String(id)).toBe('added');
    }
  });
});
