import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { exportRoundOf, recordsCsv } from '../src/export.js';
import type { RecordRow } from '../src/types.js';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

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
      `1,1,1,main,,maria,true,1970-01-01T00:00:00.000Z,"'=HYPERLINK(""http://x"",""y"")",'+1+1,'@SUM(A1),-70.25,'\t=1,'-x,1e5`,
    );
  });

  it('the round the server added: plot, round and assessment come from the key', () => {
    const csv = recordsCsv(
      [row({}, '17,1', 'maria'), row({}, '17,2', 'jose'), row({}, '18,3', 'maria')],
      exportRoundOf(added, new Set(['17', '18']), noCopies),
    );
    expect(fixed(csv)).toEqual([
      'record_key,plot,round,assessment,final,operator,actively_saved,modified_on',
      '"17,1",17,1,main,,maria,true,1970-01-01T00:00:00.000Z',
      '"17,2",17,2,check,,jose,true,1970-01-01T00:00:00.000Z',
      '"18,3",18,3,other,,maria,true,1970-01-01T00:00:00.000Z',
    ]);
  });

  it('an own round with a reassessment code: the code is the check, every other code the main assessment', () => {
    const csv = recordsCsv(
      [row({}, '17,2025', 'maria'), row({}, '17,2', 'jose')],
      exportRoundOf(ownWithCode, new Set(['17,2025']), new Map([['17,2025', new Set(['jose'])]])),
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toMatch(/^"17,2",17,2,check,,jose,/);
    expect(lines[2]).toMatch(/^"17,2025",17,2025,main,,maria,/);
  });

  it('an own round without a code: the person who holds the plot as a copy did the check', () => {
    const csv = recordsCsv(
      [row({}, '17,2025', 'maria'), row({}, '17,2025', 'jose')],
      exportRoundOf(ownYears, new Set(['17,2025']), new Map([['17,2025', new Set(['jose'])]])),
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toMatch(/^"17,2025",17,2025,check,,jose,/);
    expect(lines[2]).toMatch(/^"17,2025",17,2025,main,,maria,/);
  });

  it('a project without round still gets round 1 or 2, from who holds the plot', () => {
    for (const info of [null, { state: 'none', refusal: 'balloon_missing', keyCount: 1, roundIndex: null, roundCodes: [], reassessmentCode: null } satisfies RoundInfo]) {
      const csv = recordsCsv(
        [row({}, '17', 'maria'), row({}, '17', 'jose'), row({}, '99', 'jose')],
        exportRoundOf(info, new Set(['17']), new Map([['17', new Set(['jose'])]])),
      );
      expect(fixed(csv).slice(1)).toEqual([
        '17,17,2,check,,jose,true,1970-01-01T00:00:00.000Z',
        '17,17,1,main,,maria,true,1970-01-01T00:00:00.000Z',
        // A plot in no file (or not divided) is a main assessment.
        '99,99,1,main,,jose,true,1970-01-01T00:00:00.000Z',
      ]);
    }
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

  async function exported(): Promise<string[]> {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/export.csv`, headers: bearer(admin) });
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
      'record_key,plot,round,assessment,final,operator,actively_saved,modified_on',
      '1,1,2,check,,jose,true,1970-01-01T00:00:01.000Z',
      '1,1,1,main,,maria,true,1970-01-01T00:00:01.000Z',
      '2,2,1,main,,jose,true,1970-01-01T00:00:01.000Z',
      '3,3,1,main,,maria,true,1970-01-01T00:00:01.000Z',
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
      'record_key,plot,round,assessment,final,operator,actively_saved,modified_on',
      '1,1,1,main,,maria,true,1970-01-01T00:00:01.000Z',
      '2,2,2,check,,maria,true,1970-01-01T00:00:01.000Z',
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
      'record_key,plot,round,assessment,final,operator,actively_saved,modified_on',
      '1,1,2,check,,maria,true,1970-01-01T00:00:01.000Z',
      '99,99,1,main,,maria,true,1970-01-01T00:00:01.000Z',
      // A formula-like key is neutralised in both the record_key and plot columns.
      "'=1+1,'=1+1,1,main,,maria,true,1970-01-01T00:00:01.000Z",
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
      'record_key,plot,round,assessment,final,operator,actively_saved,modified_on',
      '"17,1",17,1,main,,maria,true,1970-01-01T00:00:01.000Z',
      '"17,2",17,2,check,,maria,true,1970-01-01T00:00:01.000Z',
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
      'record_key,plot,round,assessment,final,operator,actively_saved,modified_on,collect_code_land_use_category,collect_text_comments',
      '1,1,1,main,,maria,true,1970-01-01T00:00:01.000Z,F,',
      '2,2,1,main,,maria,true,1970-01-01T00:00:01.000Z,,cloudy',
    ]);
  });
});
