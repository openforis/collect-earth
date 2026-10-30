import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readCep, surveyInfo, zipCep, type RoundInfo } from '../src/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { demoCep, FIXTURE_DATE, idOnlyCep } from './fixtures/cep.js';

const keysOf = (cep: Buffer) => {
  const files = readCep(cep);
  return surveyInfo(new TextDecoder().decode(files.entries.get(files.surveyPath)!)).keys.map((k) => k.name);
};

const BALLOON_MARKER = '<!-- START OF EXTRA CSV DATA -->';

/** The project file with one entry's text changed (the test survey files are UTF-8). */
const withEntry = (cep: Buffer, path: string, change: (text: string) => string) => {
  const entries = new Map(readCep(cep).entries);
  const before = new TextDecoder().decode(entries.get(path)!);
  const after = change(before);
  if (after === before) throw new Error(`withEntry: ${path} did not change`);
  entries.set(path, new TextEncoder().encode(after));
  return zipCep(entries, FIXTURE_DATE);
};

describe('project file and round routes', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  const admin = () => bearer(project.adminToken);

  const putCep = (body: Buffer) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { ...admin(), 'content-type': 'application/zip' },
      payload: body,
    });
  const get = (path: string, headers = admin()) =>
    ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}${path}`, headers });
  const putRound = (payload: unknown) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/round`, headers: admin(), payload: payload as object });
  const addRecord = async () =>
    expect((await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope()])).statusCode).toBe(200);

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Rounds');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('adds round to an id-only upload before collection, and keeps the upload', async () => {
    const upload = idOnlyCep();
    const put = await putCep(upload);
    expect(put.statusCode, put.body).toBe(200);
    const round = put.json().round as RoundInfo;
    expect(round).toMatchObject({ state: 'added', refusal: null, keyCount: 2, roundIndex: 1, reassessmentCode: '2' });
    expect(put.json()).toMatchObject({ ok: true, bytes: upload.length });

    const served = await get('/cep', bearer(project.projectToken));
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(upload)).toBe(false);
    expect(keysOf(served.rawPayload)).toEqual(['id', 'round']);

    const original = await get('/cep/original');
    expect(original.statusCode).toBe(200);
    expect(original.headers['content-type']).toContain('application/zip');
    expect(original.rawPayload.equals(upload)).toBe(true);

    expect((await get('/round')).json()).toEqual(round);
    // Both files count towards the project's storage.
    const storage = await ctx.store.getProjectStorage(project.projectId);
    expect(storage.cepBytes).toBe(served.rawPayload.length + upload.length);
  });

  it('stamps the served file with the upload time', async () => {
    const before = Date.now();
    await putCep(idOnlyCep());
    const served = (await get('/cep')).rawPayload;
    const centralAt = served.readUInt32LE(served.length - 22 + 16);
    const dosDate = served.readUInt16LE(centralAt + 14);
    const day = new Date(before);
    expect(dosDate).toBe(((day.getUTCFullYear() - 1980) << 9) | ((day.getUTCMonth() + 1) << 5) | day.getUTCDate());
  });

  it('serves a survey with its own round as uploaded; /cep/original is the same file', async () => {
    const upload = demoCep();
    const put = await putCep(upload);
    expect(put.json().round).toMatchObject({ state: 'own', reassessmentCode: '2' });
    expect((await get('/cep')).rawPayload.equals(upload)).toBe(true);
    expect((await get('/cep/original')).rawPayload.equals(upload)).toBe(true);
    expect((await ctx.store.getProjectStorage(project.projectId)).cepBytes).toBe(upload.length);
  });

  it('does not change the survey once records exist', async () => {
    await addRecord();
    const upload = idOnlyCep();
    const put = await putCep(upload);
    expect(put.statusCode).toBe(200);
    expect(put.json().round).toEqual({
      state: 'none',
      refusal: null,
      keyCount: 1,
      roundIndex: null,
      roundCodes: [],
      reassessmentCode: null,
    });
    expect((await get('/cep')).rawPayload.equals(upload)).toBe(true);
  });

  it('counts deleted records as records', async () => {
    expect(await ctx.store.hasRecords(project.projectId)).toBe(false);
    await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope({ deleted: true, xml: null })]);
    expect(await ctx.store.hasRecords(project.projectId)).toBe(true);
  });

  it('adds round again, once records exist, to an id-only file for a project the server added round to', async () => {
    await putCep(idOnlyCep());
    await addRecord();
    const upload = idOnlyCep();
    const res = await putCep(upload);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().round).toMatchObject({ state: 'added', keyCount: 2, roundIndex: 1, reassessmentCode: '2' });
    expect(keysOf((await get('/cep')).rawPayload)).toEqual(['id', 'round']);
    expect((await get('/cep/original')).rawPayload.equals(upload)).toBe(true);
  });

  it('keeps round as added when the coordinator uploads the served file again after records exist', async () => {
    await putCep(idOnlyCep());
    await addRecord();
    const served = (await get('/cep')).rawPayload;
    const res = await putCep(served);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().round).toMatchObject({ state: 'added', refusal: null, keyCount: 2, roundIndex: 1, reassessmentCode: '2' });
    expect((await get('/cep')).rawPayload.equals(served)).toBe(true);
    expect((await get('/cep/original')).rawPayload.equals(served)).toBe(true);
    expect((await get('/round')).json().state).toBe('added');
  });

  it('refuses, once records exist, the added round coming back without code 1 or 2', async () => {
    await putCep(idOnlyCep());
    await addRecord();
    const served = (await get('/cep')).rawPayload;
    const codes13 = withEntry(served, 'placemark.idm.xml', (t) =>
      t.replace(/(name="assessment_phases"[\s\S]*?<code>)2(<\/code>)/, (_, a: string, b: string) => `${a}3${b}`),
    );
    const res = await putCep(codes13);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('round_codes_changed');
    expect(res.json().reason).toMatch(/must stay 1 First assessment and 2 Re-assessment/);
    expect((await get('/cep')).rawPayload.equals(served)).toBe(true);
  });

  it('refuses with 413 a survey above its own cap, quickly, before parsing it', async () => {
    // 20 MB that does not compress: within the zip's own allowance, above the survey's 10 MB.
    const survey = randomBytes(20 * 1024 * 1024);
    const upload = zipCep(new Map([['placemark.idm.xml', new Uint8Array(survey)]]), FIXTURE_DATE);
    const started = performance.now();
    const res = await putCep(upload);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(res.statusCode).toBe(413);
    expect(res.json().reason).toMatch(/survey \(placemark\.idm\.xml\) is larger than 10 MB/);
  });

  it('refuses with 413, once records exist, a too-large upload to a project the server added round to', async () => {
    await putCep(idOnlyCep());
    await addRecord();
    const bomb = zipCep(new Map([['big.bin', new Uint8Array(25 * 1024 * 1024)]]), FIXTURE_DATE);
    const res = await putCep(bomb);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'too_large', reason: expect.stringMatching(/more than 20 MB/) });
    expect((await get('/round')).json().state).toBe('added');
  });

  it('refuses, once records exist, a file without round the server cannot add it to', async () => {
    await putCep(idOnlyCep());
    await addRecord();
    const servedBefore = (await get('/cep')).rawPayload;
    const res = await putCep(withEntry(idOnlyCep(), 'balloon.html', (t) => t.replace(BALLOON_MARKER, '')));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('round_removed');
    expect(res.json().reason).toMatch(/balloon/);
    expect((await get('/cep')).rawPayload.equals(servedBefore)).toBe(true);
    expect((await get('/round')).json().state).toBe('added');
  });

  it('refuses, once records exist, a file whose keys differ from the one collected with', async () => {
    const extraKey = (cep: Buffer) =>
      withEntry(cep, 'placemark.idm.xml', (t) =>
        t.replace('<text id="4" name="operator" required="true"', '<text id="4" name="operator" required="true" key="true"'),
      );
    const refused = async (upload: Buffer) => {
      const res = await putCep(upload);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('key_shape_changed');
      expect(typeof res.json().reason).toBe('string');
    };

    // Added round, then a file with a third key.
    await putCep(idOnlyCep());
    await addRecord();
    const served = (await get('/cep')).rawPayload;
    await refused(extraKey(served));
    expect((await get('/cep')).rawPayload.equals(served)).toBe(true);

    // Its own round, then id only, or a third key; the same keys are taken.
    project = await createProject(ctx.app, 'Own');
    await putCep(demoCep());
    await addRecord();
    await refused(idOnlyCep());
    await refused(extraKey(demoCep()));
    expect((await putCep(demoCep())).statusCode).toBe(200);

    // No round (uploaded after records), then a file with round.
    project = await createProject(ctx.app, 'None');
    await addRecord();
    expect((await putCep(idOnlyCep())).json().round).toMatchObject({ state: 'none', keyCount: 1 });
    await refused(demoCep());
    expect((await putCep(idOnlyCep())).statusCode).toBe(200);
  });

  it('sets the re-assessment code only for an own round, and only to one of its codes', async () => {
    await putCep(idOnlyCep());
    expect((await putRound({ reassessmentCode: '1' })).statusCode).toBe(400);

    await putCep(demoCep());
    expect((await putRound({ reassessmentCode: '9' })).statusCode).toBe(400);
    expect((await putRound({ reassessmentCode: 2 })).statusCode).toBe(400);
    expect((await putRound({})).statusCode).toBe(400);
    const ok = await putRound({ reassessmentCode: '1' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await get('/round')).json().reassessmentCode).toBe('1');
    expect((await putRound({ reassessmentCode: null })).statusCode).toBe(200);
    expect((await get('/round')).json().reassessmentCode).toBeNull();
  });

  it('keeps a chosen re-assessment code when the same kind of file is uploaded again', async () => {
    await putCep(demoCep());
    await putRound({ reassessmentCode: '1' });
    const again = await putCep(demoCep());
    expect(again.json().round.reassessmentCode).toBe('1');
  });

  it('a project file stored before round info existed (master) is read for round on first use', async () => {
    const pid = project.projectId;
    // As master left it: the demo survey ([id, round]) and a plot file counted with one key column,
    // and no round info.
    await ctx.store.putCsvFile(pid, 'plots.csv', Buffer.from('id,round,lat,lon\n17,1,0,0\n18,1,0,0\n18,3,0,0\n'));
    await ctx.store.putCep(pid, demoCep(), { state: 'none', refusal: null, keyCount: 0, roundIndex: null, roundCodes: [], reassessmentCode: null }, null);
    (ctx.store as unknown as { projects: Map<string, { roundInfo: RoundInfo | null }> }).projects.get(pid)!.roundInfo = null;
    expect((await ctx.store.listCsvFiles(pid))[0].plotCount).toBe(2);
    await batchRequest(ctx.app, pid, project.projectToken, [
      envelope({ recordKey: '17,1', operator: 'ana', summary: {} }),
      envelope({ recordKey: '17,2', operator: 'ben', summary: {} }),
    ]);

    const round = await get('/round');
    expect(round.statusCode).toBe(200);
    expect(round.json()).toMatchObject({ state: 'own', refusal: null, keyCount: 2, roundIndex: 1, reassessmentCode: '2' });
    // Saved, and the plot file counted again with the round column.
    expect((ctx.store as unknown as { projects: Map<string, { roundInfo: RoundInfo | null }> }).projects.get(pid)!.roundInfo).toMatchObject({ state: 'own' });
    expect((await ctx.store.listCsvFiles(pid))[0].plotCount).toBe(3);

    const exported = await get('/export.csv');
    const lines = exported.rawPayload.subarray(3).toString('utf8').split('\r\n').filter((l) => l !== '');
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 7).join(','))).toEqual([
      '"17,1",17,1,main,,ana',
      '"17,2",17,2,check,,ben',
    ]);
    const quality = (await get('/quality')).json();
    expect(quality.problems).toEqual([]);
    expect(quality.plotsChecked).toBe(1);
    expect((await putRound({ reassessmentCode: '1' })).statusCode).toBe(200);
  });

  it('has no round info and no original before any upload', async () => {
    expect((await get('/round')).json()).toBeNull();
    expect((await get('/cep/original')).statusCode).toBe(404);
  });

  it('refuses a zip that unzips to too much with 413 and a plain reason', async () => {
    const bomb = zipCep(new Map([['placemark.idm.xml', new Uint8Array(25 * 1024 * 1024)]]), FIXTURE_DATE);
    const res = await putCep(bomb);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('too_large');
    // The limit this upload had: a small zip may unzip to 20 MB.
    expect(res.json().reason).toMatch(/unzips to more than 20 MB/);
    expect(await ctx.store.getCep(project.projectId)).toBeNull();

    await addRecord();
    const again = await putCep(bomb);
    expect(again.statusCode).toBe(413);
    expect(again.json().reason).toMatch(/unzips to more than 20 MB/);
  });

  it('is for admins: a collector cannot read the original or the round, nor set it', async () => {
    await putCep(demoCep());
    const collector = bearer(project.projectToken);
    expect((await get('/cep/original', collector)).statusCode).toBe(403);
    expect((await get('/round', collector)).statusCode).toBe(403);
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/round`,
      headers: collector,
      payload: { reassessmentCode: '1' },
    });
    expect(put.statusCode).toBe(403);
  });
});
