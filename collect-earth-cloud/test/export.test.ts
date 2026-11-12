import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analysisModel, recordId } from '../src/analysis.js';
import { readCep, type RoundInfo } from '../src/cep.js';
import { answerLabels, csvFormatOf, exportRoundOf, recordsCsv, recordsTable } from '../src/export.js';
import type { RecordRow } from '../src/types.js';
import { demoCep, idOnlyCep, realDemoCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

function row(summary: Record<string, string>, recordKey = '1', operator = 'maria'): RecordRow {
  return {
    projectId: 'p',
    recordKey,
    operator,
    modifiedOn: 0,
    receivedAt: 0,
    activelySaved: true,
    step: 0,
    xml: null,
    summary,
    deleted: false,
    deletedOn: null,
  };
}

const phases = [
  { code: '1', label: 'First assessment' },
  { code: '2', label: 'Re-assessment' },
];
const added: RoundInfo = { state: 'added', refusal: null, keyCount: 2, roundIndex: 1, roundCodes: phases, reassessmentCode: '2' };
const ownYears: RoundInfo = {
  state: 'own',
  refusal: null,
  keyCount: 2,
  roundIndex: 1,
  roundCodes: [
    { code: '2025', label: '2025' },
    { code: '2', label: 'check' },
  ],
  reassessmentCode: null,
};
const ownWithCode: RoundInfo = { ...ownYears, reassessmentCode: '2' };
const noCopies = new Map<string, Set<string>>();

/** The lines of a CSV (records without summary: just the fixed columns). */
function fixed(csv: string): string[] {
  return csv.slice(1).split('\r\n').filter((l) => l !== '');
}

describe('recordsCsv', () => {
  it('neutralises values a spreadsheet would run as a formula, but keeps numbers', () => {
    const csv = recordsCsv(
      [row({ a: '=HYPERLINK("http://x","y")', b: '+1+1', c: '@SUM(A1)', d: '-70.25', e: '\t=1', f: '-x', g: '1e5' })],
      exportRoundOf(null, new Set(['1']), noCopies),
    );
    const values = csv.split('\r\n')[1];
    expect(values).toBe(
      `1,1,1,main,,,maria,true,1970-01-01T00:00:00.000Z,"'=HYPERLINK(""http://x"",""y"")",'+1+1,'@SUM(A1),-70.25,'\t=1,'-x,1e5`,
    );
  });

  it('the round the server added: plot, round and assessment come from the key', () => {
    const csv = recordsCsv(
      [row({}, '17,1', 'maria'), row({}, '17,2', 'jose'), row({}, '18,3', 'maria')],
      exportRoundOf(added, new Set(['17', '18']), noCopies),
    );
    expect(fixed(csv)).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on',
      '"17,1",17,1,main,,,maria,true,1970-01-01T00:00:00.000Z',
      '"17,2",17,2,check,,,jose,true,1970-01-01T00:00:00.000Z',
      '"18,3",18,3,other,,,maria,true,1970-01-01T00:00:00.000Z',
    ]);
  });

  it('an own round with a reassessment code: the code is the check, every other code the main assessment', () => {
    const csv = recordsCsv(
      [row({}, '17,2025', 'maria'), row({}, '17,2', 'jose')],
      exportRoundOf(ownWithCode, new Set(['17,2025']), new Map([['17,2025', new Set(['jose'])]])),
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toMatch(/^"17,2",17,2,check,,,jose,/);
    expect(lines[2]).toMatch(/^"17,2025",17,2025,main,,,maria,/);
  });

  it('an own round without a code: the person who holds the plot as a copy did the check', () => {
    const csv = recordsCsv(
      [row({}, '17,2025', 'maria'), row({}, '17,2025', 'jose')],
      exportRoundOf(ownYears, new Set(['17,2025']), new Map([['17,2025', new Set(['jose'])]])),
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toMatch(/^"17,2025",17,2025,check,,,jose,/);
    expect(lines[2]).toMatch(/^"17,2025",17,2025,main,,,maria,/);
  });

  it('a project without round still gets round 1 or 2, from who holds the plot', () => {
    for (const info of [null, { state: 'none', refusal: 'balloon_missing', keyCount: 1, roundIndex: null, roundCodes: [], reassessmentCode: null } satisfies RoundInfo]) {
      const csv = recordsCsv(
        [row({}, '17', 'maria'), row({}, '17', 'jose'), row({}, '99', 'jose')],
        exportRoundOf(info, new Set(['17']), new Map([['17', new Set(['jose'])]])),
      );
      expect(fixed(csv).slice(1)).toEqual([
        '17,17,2,check,,,jose,true,1970-01-01T00:00:00.000Z',
        '17,17,1,main,,,maria,true,1970-01-01T00:00:00.000Z',
        // A plot in no file (or not divided) is a main assessment.
        '99,99,1,main,,,jose,true,1970-01-01T00:00:00.000Z',
      ]);
    }
  });
});

describe('recordsCsv in the person\'s language, with the labels and the weights', () => {
  const roundOf = exportRoundOf(null, new Set(['1', '2']), noCopies);
  const answers = { collect_real_slope: '-12.5', collect_integer_trees: '3', collect_coord_location: '-12.5,34.25', collect_code_lu: '1.1', collect_text_note: 'a;b', 'collect_entity_cover[1.5].real_canopy': '0.25', f: '=1' };

  it('in English as always; in another language ; between cells and a decimal comma in the survey\'s numbers only', () => {
    expect(recordsCsv([row(answers)], roundOf).split('\r\n')[1]).toBe(`1,1,1,main,,,maria,true,1970-01-01T00:00:00.000Z,1.1,"'-12.5,34.25",0.25,3,-12.5,a;b,'=1`);
    const csv = recordsCsv([row(answers)], roundOf, undefined, undefined, undefined, { format: csvFormatOf('es') });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(fixed(csv)).toEqual([
      'record_key;plot;round;assessment;final;reference;operator;actively_saved;modified_on;collect_code_lu;collect_coord_location;collect_entity_cover[1.5].real_canopy;collect_integer_trees;collect_real_slope;collect_text_note;f',
      // a code "1.1" and a text stay as they are; a place's two numbers are split by the separator, in one quoted cell
      `1;1;1;main;;;maria;true;1970-01-01T00:00:00.000Z;1.1;"'-12,5;34,25";0,25;3;-12,5;"a;b";'=1`,
    ]);
  });

  it('adds the label of each code answer after it, in the language asked when the survey has it, else its default one', () => {
    const files = readCep(realDemoCep());
    const model = analysisModel(new TextDecoder().decode(files.entries.get(files.surveyPath)!));
    const records = [
      row({ collect_text_id: '1', collect_code_land_use_category: 'F', collect_code_land_use_subdivision: 'broadleaf_dec::a qualifier===zz', 'collect_entity_land_cover[trees].code_coverage': '2' }, '1,1'),
      row({ collect_text_id: '2' }, '2,1'),
    ];
    const table = (language: string) => recordsTable(records, roundOf, undefined, undefined, undefined, { labelsOf: answerLabels(model, language) });
    const spanish = table('es');
    expect(spanish.columns.slice(9)).toEqual([
      'collect_code_land_use_category',
      'collect_code_land_use_category_label',
      'collect_code_land_use_subdivision',
      'collect_code_land_use_subdivision_label',
      'collect_entity_land_cover[trees].code_coverage',
      'collect_entity_land_cover[trees].code_coverage_label',
      'collect_text_id',
    ]);
    // several values: their labels joined as the codes are; a code not in the list stays the code; no answer, no label
    expect(spanish.rows.map((r) => r.slice(9))).toEqual([
      ['F', 'Bosque', 'broadleaf_dec::a qualifier===zz', 'Bosque de hoja ancha caducifolio===zz', '2', '1 puntos', '1'],
      ['', '', '', '', '', '', '2'],
    ]);
    expect(table('tr').rows[0].slice(9, 11)).toEqual(['F', 'Forest']);
  });

  it('fills the weights only on the record that counts for its plot; a choice of records keeps every record\'s columns', () => {
    const records = [row({ a: '1' }, '1', 'maria'), row({ c: 'x' }, '1', 'jose'), row({ b: '3' }, '2', 'maria')];
    const weights = new Map([[recordId('1', 'maria'), { factor: 12.5, weight: 1 }], [recordId('2', 'maria'), { factor: 25, weight: 2 }]]);
    const answersOf = (csv: string) => fixed(csv).map((l) => l.split(';').slice(9).join(';'));
    expect(answersOf(recordsCsv(records, roundOf, undefined, undefined, undefined, { weights, format: csvFormatOf('fr') }))).toEqual([
      'a;b;c;expansion_factor;plot_weight',
      ';;x;;',
      '1;;;12,5;1',
      ';3;;25;2',
    ]);
    expect(answersOf(recordsCsv(records, roundOf, undefined, undefined, undefined, { weights, keep: (r) => r.operator === 'maria', format: csvFormatOf('fr') }))).toEqual([
      'a;b;c;expansion_factor;plot_weight',
      '1;;;12,5;1',
      ';3;;25;2',
    ]);
  });
});

describe('GET export.csv', () => {
  let ctx: TestContext;
  let pid: string;
  let admin: string;

  beforeEach(async () => {
    ctx = await makeContext();
    const project = await createProject(ctx.app, 'Export project');
    pid = project.projectId;
    admin = project.adminToken;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  async function join(username: string) {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(admin), payload: { role: 'operator', maxUses: 1 } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, password: 'password12', inviteToken: invite.json().inviteToken },
    });
    return { userId: res.json().userId as string, token: res.json().token as string };
  }

  async function uploadPlots(content: string, filename = 'plots.csv') {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/${filename}`,
      headers: { ...bearer(admin), 'content-type': 'text/csv' },
      payload: content,
    });
    return res.json().id as string;
  }

  async function exported(query = ''): Promise<string[]> {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/export.csv${query}`, headers: bearer(admin) });
    expect(res.statusCode).toBe(200);
    return res.rawPayload.subarray(3).toString('utf8').split('\r\n').filter((l) => l !== '');
  }

  it('an id-only project: whoever holds a plot as a copy in a divided file did round 2, the check', async () => {
    const maria = await join('maria');
    const jose = await join('jose');
    const divided = await uploadPlots('id,lat,lon\n1,0,0\n2,0,0\n');
    await ctx.store.setDivision(pid, divided, { mode: 'manual' }, [
      { plotKey: '1', userId: maria.userId, overlap: false },
      { plotKey: '1', userId: jose.userId, overlap: true },
      { plotKey: '2', userId: jose.userId, overlap: false },
    ]);
    // A whole file: nobody holds its plots as copies.
    await uploadPlots('id,lat,lon\n3,0,0\n', 'whole.csv');
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '1', operator: 'maria', summary: {} }), envelope({ recordKey: '3', operator: 'maria', summary: {} })]);
    await batchRequest(ctx.app, pid, jose.token, [envelope({ recordKey: '1', operator: 'jose', summary: {} }), envelope({ recordKey: '2', operator: 'jose', summary: {} })]);
    expect(await exported()).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on',
      '1,1,2,check,,,jose,true,1970-01-01T00:00:01.000Z',
      '1,1,1,main,,,maria,true,1970-01-01T00:00:01.000Z',
      '2,2,1,main,,,jose,true,1970-01-01T00:00:01.000Z',
      '3,3,1,main,,,maria,true,1970-01-01T00:00:01.000Z',
    ]);
  });

  it('someone holding a plot as main in one divided file and as a copy in another did the main assessment', async () => {
    const maria = await join('maria');
    const jose = await join('jose');
    const a = await uploadPlots('id,lat,lon\n1,0,0\n', 'a.csv');
    const b = await uploadPlots('id,lat,lon\n1,0,0\n2,0,0\n', 'b.csv');
    await ctx.store.setDivision(pid, a, { mode: 'manual' }, [{ plotKey: '1', userId: maria.userId, overlap: false }]);
    await ctx.store.setDivision(pid, b, { mode: 'manual' }, [
      { plotKey: '1', userId: jose.userId, overlap: false },
      { plotKey: '1', userId: maria.userId, overlap: true },
      { plotKey: '2', userId: jose.userId, overlap: false },
      { plotKey: '2', userId: maria.userId, overlap: true },
    ]);
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '1', operator: 'maria', summary: {} }), envelope({ recordKey: '2', operator: 'maria', summary: {} })]);
    expect(await exported()).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on',
      '1,1,1,main,,,maria,true,1970-01-01T00:00:01.000Z',
      '2,2,2,check,,,maria,true,1970-01-01T00:00:01.000Z',
    ]);
  });

  it('exports a record whose plot is in no plot file, and skips a plot file it cannot read', async () => {
    const maria = await join('maria');
    const jose = await join('jose');
    const good = await uploadPlots('id,lat,lon\n1,0,0\n', 'good.csv');
    const bad = await uploadPlots('id,lat,lon\n5,0,0\n', 'bad.csv');
    await ctx.store.setDivision(pid, good, { mode: 'manual' }, [
      { plotKey: '1', userId: jose.userId, overlap: false },
      { plotKey: '1', userId: maria.userId, overlap: true },
    ]);
    const getCsvFile = ctx.store.getCsvFile.bind(ctx.store);
    ctx.store.getCsvFile = async (projectId: string, csvFileId: string) => {
      if (csvFileId === bad) throw new Error('unreadable');
      return getCsvFile(projectId, csvFileId);
    };
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria', summary: {} }),
      envelope({ recordKey: '99', operator: 'maria', summary: {} }),
      envelope({ recordKey: '=1+1', operator: 'maria', summary: {} }),
    ]);
    expect(await exported()).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on',
      '1,1,2,check,,,maria,true,1970-01-01T00:00:01.000Z',
      '99,99,1,main,,,maria,true,1970-01-01T00:00:01.000Z',
      // A formula-like key is neutralised in both the record_key and plot columns.
      "'=1+1,'=1+1,1,main,,,maria,true,1970-01-01T00:00:01.000Z",
    ]);
  });

  it('the round the server added: the key says the round', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/cep`,
      headers: { ...bearer(admin), 'content-type': 'application/zip' },
      payload: idOnlyCep(),
    });
    expect(put.json().round.state).toBe('added');
    const maria = await join('maria');
    await uploadPlots('id,lat,lon\n17,0,0\n');
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '17,1', operator: 'maria', summary: {} }),
      envelope({ recordKey: '17,2', operator: 'maria', summary: {} }),
    ]);
    expect(await exported()).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on',
      '"17,1",17,1,main,,,maria,true,1970-01-01T00:00:01.000Z',
      '"17,2",17,2,check,,,maria,true,1970-01-01T00:00:01.000Z',
    ]);
  });

  it('has the answer columns of records sent with null for their empty attributes, as Collect Earth sends them', async () => {
    const maria = await join('maria');
    await uploadPlots('id,lat,lon\n1,0,0\n2,0,0\n');
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria', summary: { collect_code_land_use_category: 'F', collect_text_comments: null } as never }),
      envelope({ recordKey: '2', operator: 'maria', summary: { collect_code_land_use_category: null, collect_text_comments: 'cloudy' } as never }),
    ]);
    expect(await exported()).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on,collect_code_land_use_category,collect_text_comments',
      '1,1,1,main,,,maria,true,1970-01-01T00:00:01.000Z,F,',
      '2,2,1,main,,,maria,true,1970-01-01T00:00:01.000Z,,cloudy',
    ]);
  });

  it('weighs the plots as the analysis does, on the record of each plot\'s first assessment only', async () => {
    const maria = await join('maria');
    const jose = await join('jose');
    const divided = await uploadPlots('id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n');
    await ctx.store.setDivision(pid, divided, { mode: 'manual' }, [
      { plotKey: '1', userId: maria.userId, overlap: false },
      { plotKey: '1', userId: jose.userId, overlap: true },
      { plotKey: '2', userId: jose.userId, overlap: false },
      { plotKey: '3', userId: maria.userId, overlap: false },
    ]);
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '1', operator: 'maria', summary: {} }), envelope({ recordKey: '3', operator: 'maria', activelySaved: false, summary: {} })]);
    await batchRequest(ctx.app, pid, jose.token, [envelope({ recordKey: '1', operator: 'jose', summary: {} }), envelope({ recordKey: '2', operator: 'jose', summary: {} })]);
    // no areas: no weights
    expect((await exported())[0]).not.toContain('plot_weight');
    await ctx.store.setAreaSettings(pid, { mode: 'total', area: 300 });
    // the check and the draft: blank, so a sum of the column counts each plot once
    expect(await exported()).toEqual([
      'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on,expansion_factor,plot_weight',
      '1,1,2,check,,,jose,true,1970-01-01T00:00:01.000Z,,',
      '1,1,1,main,,,maria,true,1970-01-01T00:00:01.000Z,150,1',
      '2,2,1,main,,,jose,true,1970-01-01T00:00:01.000Z,150,1',
      '3,3,1,main,,,maria,false,1970-01-01T00:00:01.000Z,,',
    ]);
  });

  it('is written in the person\'s language, keeps the records changed from a date, and refuses a wrong choice', async () => {
    const maria = await join('maria');
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: Date.UTC(2026, 10, 2), summary: { collect_real_area: '2.5' } }),
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: Date.UTC(2026, 9, 30), summary: { collect_real_area: '1' } }),
    ]);
    expect(await exported('?lang=pt&since=2026-11-01')).toEqual([
      'record_key;plot;round;assessment;final;reference;operator;actively_saved;modified_on;collect_real_area',
      '1;1;1;main;;;maria;true;2026-11-02T00:00:00.000Z;2,5',
    ]);
    for (const [query, reason] of [
      ['?since=yesterday', /not a date/],
      ['?since=2026-13-45', /not a date/],
      // no project file: no question to keep the records by
      ['?question=collect_code_land_use_category&value=F', /not a question of the survey/],
    ] as const) {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/export.csv${query}`, headers: bearer(admin) });
      expect(res.statusCode, query).toBe(400);
      expect(res.json().reason).toMatch(reason);
    }
  });
});

describe('the data download\'s choices: the labels, the records changed since the last download or with an answer', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let ana: string;

  const get = (path: string) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}${path}`, headers: bearer(owner.token) });
  /** The lines of a download in Spanish (; between cells: the record keys "1,1" unquoted). */
  const lines = async (path: string) => {
    const res = await get(path);
    expect(res.statusCode, res.body).toBe(200);
    return res.rawPayload.subarray(3).toString('utf8').split('\r\n').filter((l) => l !== '');
  };
  const keysOf = (csv: string[]) => csv.slice(1).map((l) => l.split(';')[0]);

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Choices')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    ana = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: invite.json().inviteToken } })).json().token;
    const cep = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: demoCep() });
    expect(cep.statusCode, cep.body).toBe(200);
    const sent = await batchRequest(ctx.app, pid, ana, [
      envelope({ recordKey: '1,1', operator: 'ana', summary: { collect_code_land_use_category: 'F', collect_text_province: 'Sofala' } }),
      envelope({ recordKey: '2,1', operator: 'ana', summary: { collect_code_land_use_category: 'C', collect_text_province: 'sofala' } }),
      envelope({ recordKey: '3,1', operator: 'ana', summary: { collect_code_land_use_category: 'F::planted', collect_text_province: 'Tete' } }),
    ]);
    expect(sent.statusCode, sent.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('offers the survey\'s plot questions with the code lists of the code ones', async () => {
    const res = await get('/export/choices');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.languages).toEqual(['en', 'fr', 'pt', 'es']);
    expect(body.questions).toContainEqual(expect.objectContaining({ key: 'collect_code_land_use_category', name: 'land_use_category', list: 'land_uses' }));
    expect(body.questions).toContainEqual(expect.objectContaining({ key: 'collect_text_province', list: null }));
    expect(body.lists.land_uses[0]).toMatchObject({ code: 'F', labels: { es: 'Bosque' } });
  });

  it('adds the labels of the answers in the person\'s language, to the map files too', async () => {
    const csv = await lines('/export.csv?lang=es&labels=include');
    const header = csv[0].split(';');
    const at = header.indexOf('collect_code_land_use_category');
    expect(header[at + 1]).toBe('collect_code_land_use_category_label');
    expect(csv.slice(1).map((l) => l.split(';')[at + 1])).toEqual(['Bosque', expect.any(String), 'Bosque']);
    const geojson = (await get('/export.geojson?lang=fr&labels=include')).json();
    expect(geojson.features[0].properties).toMatchObject({ collect_code_land_use_category: 'F', collect_code_land_use_category_label: 'Forêt' });
    const [logged] = await ctx.store.listAudit(pid, { limit: 1, action: 'export.downloaded' });
    expect(logged.details).toEqual({ records: 3, format: 'geojson', labels: true });
  });

  it('keeps the records with an answer: a code among its codes, any other answer exactly', async () => {
    expect(keysOf(await lines('/export.csv?lang=es&question=collect_code_land_use_category&value=F'))).toEqual(['1,1', '3,1']);
    expect(keysOf(await lines('/export.csv?lang=es&question=collect_text_province&value=Sofala'))).toEqual(['1,1']);
    // the question is noted, never the answer
    const [logged] = await ctx.store.listAudit(pid, { limit: 1, action: 'export.downloaded' });
    expect(logged.details).toEqual({ records: 1, question: 'collect_text_province' });
    const missing = await get('/export.csv?question=collect_text_province');
    expect(missing.statusCode).toBe(400);
  });

  it('keeps the records changed since the person\'s last download of the data; before the first, every record', async () => {
    const lastDownload = async () => (await get('/export/choices')).json().lastDownload;
    expect(await lastDownload()).toBeNull();
    expect(keysOf(await lines('/export.csv?lang=es&since=last'))).toEqual(['1,1', '2,1', '3,1']);
    const [first] = await ctx.store.listAudit(pid, { limit: 1, action: 'export.downloaded' });
    expect(first.details).toEqual({ records: 3, since: null, sinceLast: true });
    // another download (the people table) is not a download of the data
    expect((await get('/exports/people')).statusCode).toBe(200);
    expect(await lastDownload()).toBe(first.at);
    await batchRequest(ctx.app, pid, ana, [envelope({ recordKey: '2,1', operator: 'ana', modifiedOn: first.at + 1000, summary: { collect_code_land_use_category: 'G' } })]);
    expect(keysOf(await lines('/export.csv?lang=es&since=last'))).toEqual(['2,1']);
    const [second] = await ctx.store.listAudit(pid, { limit: 1, action: 'export.downloaded' });
    expect(second.details).toEqual({ records: 1, since: first.at, sinceLast: true });
  });
});
