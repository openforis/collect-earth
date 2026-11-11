// A new project from a Collect Earth backup (src/backupImport.ts, src/routes/backupImport.ts, plan
// docs/plans/2026-11-11-backup-import.md), on the made-up backup of test/backupSampleData.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupError, openBackup, recordReader, suggestedLayout, layoutOf } from '../src/backupImport.js';
import { parseCsv } from '../src/ceo/answers.js';
import { backupReader } from '../src/collectImport.js';
import { cepProperties, readCep, zipCep } from '../src/cep.js';
import { SAMPLE_RECORDS, SAMPLE_SURVEY, sampleBackupZip } from './backupSampleData.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const JAVA_RESOURCES = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/backup/', import.meta.url));

/** The sample survey without its own round key, and its records without round: the server adds one */
const NO_ROUND_SURVEY = SAMPLE_SURVEY.replace(/\s*<code id="3" name="round"[^\n]*/, '');
const NO_ROUND_RECORDS = Object.fromEntries(
  Object.entries(SAMPLE_RECORDS)
    .filter(([path]) => path !== '1/104.xml')
    .map(([path, xml]) => [path, xml.replace(/\n  <round>\n    <code>\d<\/code>\n  <\/round>/, '')]),
);

/** A plot file as Collect Earth's projects have them: the keys, the place, then the columns filled from it */
const PLOT_FILE = [
  'id,round,YCoordinate,XCoordinate,elevation,slope,region',
  'P1,1,42.4842216299026,1.42032362698269,2149,11.0,North',
  'P2,1,42.51,1.53,1740,27.5,South',
  'P3,1,42.53,1.55,2428,-0.5,',
  'P4,1,42.55,1.57,1900,3.0,East',
  'P5,1,42.57,1.59,2000,4.0,East',
  '',
].join('\n');

describe('reading a Collect Earth backup', () => {
  it('reads the survey: its keys, its plot area and points, the columns of its plot file', () => {
    const { survey, records } = openBackup(sampleBackupZip());
    expect(survey).toMatchObject({ root: 'plot', title: 'Backup sample', surveyName: 'backup_sample', plotAreaHa: 1, samplePoints: 25 });
    expect(survey.keys).toEqual(['id', 'round']);
    expect(survey.plotColumns).toEqual(['elevation', 'slope', 'region']);
    expect(records.map((r) => r.name)).toEqual(['1/101.xml', '1/102.xml', '2/103.xml', '1/104.xml']);
  });

  it('reads each record: its key, plot, place, collector, step, time and plot file columns', () => {
    const { survey, records } = openBackup(sampleBackupZip());
    const [first, second, third] = records.map(recordReader(survey));
    expect(first).toMatchObject({
      keyValues: ['P1', '1'], plotId: 'P1', location: { lat: 42.4842216299026, lon: 1.42032362698269 }, operator: 'Marta', activelySaved: true, step: 1,
      modifiedOn: Date.parse('2025-09-24T13:09:26.160+02:00'), columns: { elevation: '2149', slope: '11.0', region: 'North' },
    });
    expect(second).toMatchObject({ plotId: 'P2', activelySaved: false, operator: 'Collect Earth User' });
    expect(third).toMatchObject({ plotId: 'P3', location: null, step: 2, columns: { elevation: '2428', slope: '-0.5' } });
  });

  it('summarizes a record as the import into a project does (collectImport.ts, checked against Collect Earth in CeoRecordsXmlTest)', () => {
    const read = backupReader(SAMPLE_SURVEY, null);
    const [first, second] = ['1/101.xml', '1/102.xml'].map((name) => {
      const r = read({ name, step: 1, xml: SAMPLE_RECORDS[name] });
      if ('problem' in r) throw new Error(r.problem);
      return r.summary;
    });
    expect(first).toMatchObject({
      collect_code_land_use: 'other::orchard & vines',
      collect_real_canopy: '1.0E-4',
      collect_time_survey_time: '09:05',
      collect_real_range_height: '2.5-12',
      collect_integer_range_years: '2001',
      collect_code_species: 'pine===oak',
      collect_date_observed_on: '12/31/2024',
      collect_coord_landmark: '42.0,1.5',
      'collect_entity_trees[2].real_dbh': '1.23456789E7',
      'collect_entity_cover[grass].integer_percent': '10',
      'collect_entity_visit.text_inspector': 'R. Ortega',
    });
    // empty: '' at the root (a multiple attribute too, as Collect Earth's own summaries in
    // test/fixtures/collect-import/types have it), left out in a row; a coordinate is "null,null"; the cover rows the
    // record lacks have their key
    expect(second).toMatchObject({ collect_real_canopy: '', collect_code_species: '', collect_coord_landmark: 'null,null', 'collect_entity_cover[trees].code_element': 'trees' });
    expect(second).not.toHaveProperty('collect_entity_trees[1].code_tree_species');
    expect(second).not.toHaveProperty('collect_entity_cover[grass].integer_percent');
  });

  it("reads Collect's areas per stratum (files/ce_area) in UTF-8, or else in Windows-1252", () => {
    const zip = (areas: Uint8Array) => zipCep(new Map([['idml.xml', new Uint8Array(Buffer.from(SAMPLE_SURVEY))], ['files/ce_area/areas.csv', areas]]), new Date());
    expect(openBackup(zip(new Uint8Array(Buffer.from('region,area\nRegi\xe3o,1000\n', 'latin1')))).areas).toBe('region,area\nRegião,1000\n');
    expect(openBackup(zip(new Uint8Array(Buffer.from('region,area\nRegião,1000\n', 'utf8')))).areas).toBe('region,area\nRegião,1000\n');
  });

  it('refuses what is not a backup, saying what it is', () => {
    const notZip = () => openBackup(Buffer.from('not a zip'));
    expect(notZip).toThrow(BackupError);
    const cep = zipCep(new Map([['placemark.idm.xml', new Uint8Array(Buffer.from(SAMPLE_SURVEY))], ['project_definition.properties', new Uint8Array()]]), new Date());
    expect(() => openBackup(cep)).toThrow(/project file/);
    const other = zipCep(new Map([['readme.txt', new Uint8Array(Buffer.from('hello'))]]), new Date());
    expect(() => openBackup(other)).toThrow(/no idml.xml/);
  });

  it('suggests a square layout from the plot area and points, and checks the one asked for', () => {
    expect(suggestedLayout({ plotAreaHa: 0.5, samplePoints: 49 })).toMatchObject({ shape: 'SQUARE', points: 49 });
    const l = suggestedLayout({ plotAreaHa: 0.5, samplePoints: 49 });
    // 7 points 10.1 m apart, 5.06 m from the edge (in centimetres): a side of 70.7 m, half a hectare
    expect(l).toMatchObject({ distance: 10.1, boundary: 5.06 });
    expect(Math.abs((6 * l.distance + 2 * l.boundary) ** 2 - 5000)).toBeLessThan(5);
    expect(suggestedLayout({ plotAreaHa: null, samplePoints: null })).toMatchObject({ points: 25, distance: 20 });
    expect(layoutOf({ shape: 'SQUARE', points: 10, distance: 5, boundary: 2, pointSide: 2 })).toMatch(/square number/);
    expect(layoutOf({ shape: 'CIRCLE', points: 10, distance: 5, boundary: 0, pointSide: 2 })).toMatchObject({ shape: 'CIRCLE', points: 10 });
  });
});

describe('a new project from a Collect Earth backup', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  const post = (path: string, payload: object, token = owner.token) =>
    ctx.app.inject({ method: 'POST', url: `/v1/projects/from-backup${path}`, headers: bearer(token), payload });
  const backup = (zip = sampleBackupZip()) => zip.toString('base64');
  const exportRows = async (projectId: string) => {
    const csv = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/export.csv`, headers: bearer(owner.token) })).body;
    const [header, ...rows] = parseCsv(csv.replace(/^﻿/, '')).filter((r) => r.length > 1);
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  };
  const plotFiles = async (projectId: string) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/csv-files`, headers: bearer(owner.token) });
    return (res.json() as { csvFiles: { id: string; filename: string }[] }).csvFiles;
  };
  const fileText = async (projectId: string, id: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/csv-files/${id}/content`, headers: bearer(owner.token) })).body;

  /**
   * For CeoRecordsXmlTest: the survey a project serves and its records with their summaries, in
   * src/test/resources/backup/<folder> of the desktop (UPDATE_CEO_IDML=1 writes them again)
   */
  const javaFixtures = async (projectId: string, folder: string) => {
    const stored = await ctx.store.listRecords(projectId);
    const xml = await ctx.store.getRecordXml(projectId, stored.map((r) => ({ recordKey: r.recordKey, operator: r.operator })));
    const files = readCep(Buffer.from((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: bearer(owner.token) })).rawPayload));
    const written = new Map<string, string>([['placemark.idm.xml', new TextDecoder().decode(files.entries.get(files.surveyPath)!)]]);
    for (const x of xml) {
      const name = `${x.recordKey}-${x.operator}`.replace(/[^\w-]+/g, '_');
      written.set(`${name}.xml`, x.xml!);
      const summary = stored.find((r) => r.recordKey === x.recordKey && r.operator === x.operator)!.summary;
      written.set(`${name}.summary.json`, JSON.stringify(Object.fromEntries(Object.entries(summary).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + '\n');
    }
    const dir = `${JAVA_RESOURCES}${folder}/`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const [name, text] of written) {
      const path = dir + name;
      if (process.env.UPDATE_CEO_IDML === '1' || !existsSync(path)) writeFileSync(path, text);
      expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), path).toBe(text.replace(/\r\n/g, '\n'));
    }
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('the preview counts the records, their collectors and plots, and suggests the layout; nothing is made', async () => {
    const res = await post('/preview', { backup: backup() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'Backup sample',
      surveyName: 'backup_sample',
      records: { total: 4, submitted: 3, drafts: 1, steps: { entry: 3, cleansing: 1, analysis: 0 }, unreadable: 0 },
      collectors: [
        { name: 'Collect Earth User', records: 1 },
        { name: 'Marta', records: 1 },
        { name: 'Marta P', records: 1 },
        { name: 'Rosa Vidal', records: 1 },
      ],
      // P1 and P2 placed by their records (P3 has no location), P1 submitted; without a plot file, P2 to give out
      plots: { withRecords: 2, done: 1, withoutPlace: 1, withoutPlaceExamples: ['P3'], inFile: null, toDo: 1, notInFile: null },
      layout: { shape: 'SQUARE', points: 25, distance: 20, boundary: 10 },
      survey: { plotAreaHa: 1, samplePoints: 25, plotColumns: ['elevation', 'slope', 'region'] },
    });
    const withFile = await post('/preview', { backup: backup(), plotFile: PLOT_FILE });
    // P1 and P3 are done (a submitted first assessment): P2, P4 and P5 are to give out
    expect(withFile.json().plots).toMatchObject({ inFile: 5, toDo: 3, notInFile: 0 });
    expect(await ctx.store.listMemberships(owner.userId)).toEqual([]);
  });

  it('refuses a file that is not a backup, and a plot file not in latitude and longitude', async () => {
    expect((await post('/preview', { backup: Buffer.from('nope').toString('base64') })).json()).toMatchObject({ error: 'backup_unreadable' });
    const cep = zipCep(new Map([['placemark.idm.xml', new Uint8Array(Buffer.from(SAMPLE_SURVEY))]]), new Date());
    expect((await post('/preview', { backup: cep.toString('base64') })).json()).toMatchObject({ error: 'backup_unreadable', reason: expect.stringContaining('project file') });
    expect((await post('/preview', {})).statusCode).toBe(400);
    const utm = 'id,round,YCoordinate,XCoordinate\nP1,1,4704512.3,376204.1\n';
    expect((await post('/preview', { backup: backup(), plotFile: utm })).json()).toMatchObject({ error: 'plot_file_unreadable', reason: expect.stringContaining('latitudes') });
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/projects/from-backup/preview', payload: { backup: backup() } })).statusCode).toBe(401);
  });

  it('makes the project: its project file from the survey, a plot file of the plots done, the records with their summaries', async () => {
    await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { signupOpen: true } });
    const signup = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'marta', password: 'password12' } });
    expect(signup.statusCode, signup.body).toBe(201);

    const res = await post('', { backup: backup(), collectors: { Marta: 'marta' } });
    expect(res.statusCode, res.body).toBe(201);
    const { projectId } = res.json();
    expect(res.json()).toMatchObject({
      name: 'Backup sample', round: 'own', records: 4,
      collectors: expect.arrayContaining([{ name: 'Marta', username: 'marta', account: true }, { name: 'Rosa Vidal', username: 'Rosa Vidal', account: false }]),
      doneFile: { filename: 'backup_sample_plots_done.csv', plots: 1 },
      plotFile: { filename: 'backup_sample_plots.csv', plots: 1 },
    });
    // the named account joined as a collector
    expect((await ctx.store.listMemberships(signup.json().userId)).map((m) => m.role)).toEqual(['operator']);

    // The project file: the survey, and the layout as asked (the survey's suggestion)
    const files = readCep(Buffer.from((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: bearer(owner.token) })).rawPayload));
    expect(Object.fromEntries(cepProperties(files))).toMatchObject({ survey_name: 'backup_sample', sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '25', distance_between_sample_points: '20' });

    // The plot files: P1 done, P2 to give out, with the columns read from the records
    const stored = await plotFiles(projectId);
    const done = stored.find((f) => f.filename.endsWith('_done.csv'))!;
    expect(await fileText(projectId, done.id)).toContain('P1,1,42.484222,1.420324,2149,11.0,North');
    const toDo = stored.find((f) => f.filename === 'backup_sample_plots.csv')!;
    expect(await fileText(projectId, toDo.id)).toContain('P2,1,42.510000,1.530000,1740,27.5,South');

    // The records, as Collect Earth would have synced them: by account or typed name, at their own time
    const rows = await exportRows(projectId);
    expect(rows.map((r) => `${r.plot}/${r.round}/${r.operator}/${r.actively_saved}`).sort()).toEqual([
      'P1/1/marta/true', 'P1/2/Marta P/true', 'P2/1/Collect Earth User/false', 'P3/1/Rosa Vidal/true',
    ]);
    const p1 = rows.find((r) => r.plot === 'P1' && r.round === '1')!;
    expect(p1.collect_code_land_use ?? p1.land_use).toBeDefined();
    const records = await ctx.store.listRecords(projectId);
    expect(records.find((r) => r.recordKey === 'P1,1')!.modifiedOn).toBe(Date.parse('2025-09-24T13:09:26.160+02:00'));
    await javaFixtures(projectId, 'sample');
  });

  it('gives out the plots of the original plot file without records, as written', async () => {
    const res = await post('', { backup: backup(), plotFile: PLOT_FILE, plotFileName: 'Grid 2024.csv' });
    expect(res.statusCode, res.body).toBe(201);
    const { projectId } = res.json();
    expect(res.json().plotFile).toMatchObject({ filename: 'Grid_2024.csv', plots: 3 });
    const toDo = (await plotFiles(projectId)).find((f) => f.filename === 'Grid_2024.csv')!;
    const text = await fileText(projectId, toDo.id);
    expect(text.split('\n').filter((l) => l !== '').map((l) => l.split(',')[0])).toEqual(['id', 'P2', 'P4', 'P5']);
    // P3's submitted record has no location: its row of the plot file places it in the done file
    expect(res.json().doneFile).toMatchObject({ plots: 2 });
    const done = (await plotFiles(projectId)).find((f) => f.filename.endsWith('_done.csv'))!;
    expect(await fileText(projectId, done.id)).toContain('P3,1,42.530000,1.550000,2428,-0.5,');
  });

  it("counts the plots done by the survey's first round, whatever its code, in the preview as in the project made", async () => {
    const survey = SAMPLE_SURVEY.replace('<code>1</code>\n          <label>First assessment</label>', '<code>A</code>\n          <label>First assessment</label>');
    const records = Object.fromEntries(Object.entries(SAMPLE_RECORDS).map(([p, x]) => [p, x.replace('<round>\n    <code>1</code>', '<round>\n    <code>A</code>')]));
    const zip = backup(sampleBackupZip(records, survey));
    // P1 is done by a submitted record of round A: P2 is to give out
    expect((await post('/preview', { backup: zip })).json().plots).toMatchObject({ withRecords: 2, done: 1, toDo: 1 });
    const res = await post('', { backup: zip });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ round: 'own', doneFile: { plots: 1 }, plotFile: { plots: 1 } });
  });

  it("keeps one copy of a record Collect wrote once per step (1/, 2/): the last step's, its step read from the folder", async () => {
    // Collect's own backup (.collect) writes data/<step>/<id>.xml; these records say no step of their own
    const p1 = SAMPLE_RECORDS['1/101.xml'].replace(/ step="\d"/, '');
    const draft = p1.replace('<actively_saved>\n    <value>true</value>', '<actively_saved>\n    <value>false</value>');
    const zip = backup(sampleBackupZip({ 'data/1/101.xml': draft, 'data/2/101.xml': p1 }));
    expect((await post('/preview', { backup: zip })).json().records).toMatchObject({ total: 1, submitted: 1, steps: { entry: 0, cleansing: 1, analysis: 0 } });
    const res = await post('', { backup: zip });
    expect(res.statusCode, res.body).toBe(201);
    expect((await ctx.store.listRecords(res.json().projectId)).map((r) => [r.recordKey, r.step, r.activelySaved])).toEqual([['P1,1', 2, true]]);
  });

  it("refuses records that do not fit the project's storage, keeping nothing", async () => {
    await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { maxProjectStorageMb: 1 } });
    const long = SAMPLE_RECORDS['1/101.xml'].replace('Burnt in 2019, regrowing', 'x'.repeat(1024 * 1024));
    const res = await post('', { backup: backup(sampleBackupZip({ ...SAMPLE_RECORDS, '1/101.xml': long })) });
    expect(res.statusCode, res.body).toBe(413);
    expect(res.json()).toMatchObject({ error: 'storage_limit_reached', limitBytes: 1024 * 1024 });
    expect(await ctx.store.listMemberships(owner.userId)).toEqual([]);
    // the same backup without the long notes fits
    expect((await post('', { backup: backup() })).statusCode).toBe(201);
  });

  it("reads Collect's own backup (.collect): its records under data/, or none, with its grid as the plot file", async () => {
    const collectLayout = Object.fromEntries(Object.entries(SAMPLE_RECORDS).map(([path, xml]) => [`data/${path}`, xml]));
    const withData = await post('/preview', { backup: backup(sampleBackupZip(collectLayout)) });
    expect(withData.statusCode, withData.body).toBe(200);
    expect(withData.json().records.total).toBe(Object.keys(SAMPLE_RECORDS).length);

    expect(withData.json().strata).toBeNull();

    // a backup of the survey alone: no records, its plots all to give out, the strata's areas into the project file
    const areas = 'region,area\nNorth,1000\nSouth,500\n';
    const surveyOnly = sampleBackupZip({ 'info.properties': 'survey_name=backup_sample\n', 'files/ce_area/areas.csv': areas });
    expect((await post('/preview', { backup: backup(surveyOnly) })).json().strata).toBe(2);
    const res = await post('', { backup: backup(surveyOnly), plotFile: PLOT_FILE, plotFileName: 'ce_grid.csv' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ records: 0, plotFile: { filename: 'ce_grid.csv', plots: 5 } });
    const cep = readCep(Buffer.from((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${res.json().projectId}/cep`, headers: bearer(owner.token) })).rawPayload));
    expect(new TextDecoder().decode(cep.entries.get('areas_per_attribute.csv'))).toBe(areas);
  });

  it('adds the round to a survey without one, and to its records', async () => {
    const res = await post('', { backup: backup(sampleBackupZip(NO_ROUND_RECORDS, NO_ROUND_SURVEY)) });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ round: 'added', records: 3 });
    const records = await ctx.store.listRecords(res.json().projectId);
    expect(records.map((r) => r.recordKey).sort()).toEqual(['P1,1', 'P2,1', 'P3,1']);
    expect(records.find((r) => r.recordKey === 'P1,1')!.summary).toMatchObject({ collect_code_round: '1', collect_text_id: 'P1' });
    await javaFixtures(res.json().projectId, 'sample-round-added');
  });

  it("keeps an account's name from records it did not make, and refuses an account that does not exist", async () => {
    await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { signupOpen: true } });
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'maria', password: 'password12' } });
    const asMaria = Object.fromEntries(Object.entries(SAMPLE_RECORDS).map(([p, x]) => [p, x.replace('<value>Marta</value>', '<value>maria</value>')]));
    const zip = backup(sampleBackupZip(asMaria));
    expect((await post('', { backup: zip })).json()).toMatchObject({ error: 'name_is_account', name: 'maria' });
    expect((await post('', { backup: zip, collectors: { maria: 'nobody' } })).json()).toMatchObject({ error: 'unknown_account', username: 'nobody' });
    expect(await ctx.store.listMemberships(owner.userId)).toEqual([]);
    expect((await post('', { backup: zip, collectors: { maria: 'maria' } })).statusCode).toBe(201);
  });

  it('takes the layout the coordinator confirms', async () => {
    const layout = { shape: 'CIRCLE', points: 12, distance: 25, boundary: 0, pointSide: 3 };
    const res = await post('', { backup: backup(), layout });
    expect(res.statusCode, res.body).toBe(201);
    const files = readCep(Buffer.from((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${res.json().projectId}/cep`, headers: bearer(owner.token) })).rawPayload));
    expect(Object.fromEntries(cepProperties(files))).toMatchObject({ sample_shape: 'CIRCLE', number_of_sampling_points_in_plot: '12', distance_between_sample_points: '25', inner_point_side: '3' });
    expect((await post('', { backup: backup(), layout: { ...layout, shape: 'HEXAGON' } })).statusCode).toBe(400);
  });
});
