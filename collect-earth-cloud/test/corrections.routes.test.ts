import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// Corrections (docs/plans/2026-11-20-review-at-scale.md, B1-B4): plots decided "Correct it in Collect Earth", assigned by
// a coordinator to people of the project (a warning, never a refusal, for someone's own plots), corrected in their
// Collect Earth, and the correction the plot's final answer in the export.

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

describe('corrections', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  let rita: { token: string; userId: string };
  let maria: { token: string; userId: string };

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string, userId: res.json().userId as string };
  };
  const fresh = async () => {
    for (let i = 0; i < 200; i++) {
      const body = (await call('GET', '/quality/review-list?state=all', owner.token)).json();
      if (!body.stale) return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };
  const t0 = Date.UTC(2026, 9, 1, 9);
  const main = (plot: number, operator: string, landUse = 'F') =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: t0 + plot * 1000, xml: `<plot><id>${plot}</id><by>${operator}</by></plot>`, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '1' } });
  const check = (plot: number, operator: string, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: t0 + 100_000 + plot * 1000, xml: `<plot><id>${plot}</id><by>${operator}</by></plot>`, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '2' } });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Corrections');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 10 }, (_, i) => `${i + 1},${-10 - i / 10},${20 + i / 10}`)].join('\n'), { 'content-type': 'text/csv' });
    // 1-4 differ; rita answered 2 (first) and 3 (check)
    const res = await batchRequest(ctx.app, pid, projectToken, [
      main(1, 'ana'),
      check(1, 'ben', 'G'),
      main(2, 'rita'),
      check(2, 'ben', 'G'),
      main(3, 'ana'),
      check(3, 'rita', 'C'),
      main(4, 'ana'),
      check(4, 'ben', 'C'),
    ]);
    expect(res.statusCode, res.body).toBe(200);
    await fresh();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('a coordinator decides plots "correct" and assigns them at once: shared evenly, their own plots said, one audit entry each', async () => {
    const apply = (dry: boolean, assign: string[]) => call('POST', `/quality/decisions:apply${dry ? '?dryRun=1' : ''}`, owner.token, { plots: ['1', '2', '3', '4'], decision: 'correct', comment: 'land use', assign });
    const dry = await apply(true, [rita.userId, maria.userId]);
    expect(dry.statusCode, dry.body).toBe(200);
    // 1 and 3 to rita, 2 and 4 to maria: rita answered 3 (and 2, which is maria's)
    expect(dry.json()).toMatchObject({
      decision: 'correct',
      count: 4,
      dryRun: true,
      assignment: {
        people: expect.arrayContaining([
          { userId: rita.userId, username: 'rita', plots: 2, own: 1 },
          { userId: maria.userId, username: 'maria', plots: 2, own: 0 },
        ]),
        own: [{ plot: '3', username: 'rita' }],
        ownCount: 1,
      },
    });
    expect(await ctx.store.listCorrections(pid)).toEqual([]);
    const done = await apply(false, [rita.userId, maria.userId]);
    expect(done.json()).toMatchObject({ count: 4, dryRun: false });
    expect((await ctx.store.listQualityDecisions(pid)).map((d) => [d.plot, d.decision, d.comment])).toEqual(['1', '2', '3', '4'].map((p) => [p, 'correct', 'land use']));
    expect((await ctx.store.listCorrections(pid)).map((c) => [c.plot, c.assignedToName, c.assignedBy])).toEqual([
      ['1', 'rita', 'owner'],
      ['2', 'maria', 'owner'],
      ['3', 'rita', 'owner'],
      ['4', 'maria', 'owner'],
    ]);
    const audit = await ctx.store.listAudit(pid, { limit: 10 });
    expect(audit.filter((e) => e.action === 'corrections.assigned').map((e) => e.details)).toEqual([{ count: 4, people: 2, own: 1 }]);
    // Only with "correct", only coordinators, only members who sign in
    expect((await call('POST', '/quality/decisions:apply', owner.token, { plots: ['1'], decision: 'first', assign: [maria.userId] })).statusCode).toBe(400);
    expect((await call('POST', '/quality/decisions:apply', rita.token, { plots: ['1'], decision: 'correct', assign: [maria.userId] })).statusCode).toBe(403);
    expect((await call('POST', '/quality/decisions:apply', owner.token, { plots: ['1'], decision: 'correct', assign: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(400);
  });

  it('the coordinators\' list: who corrects which, the own plots, the counts; plots reassigned or to nobody; a plot decided otherwise skipped', async () => {
    await call('POST', '/quality/decisions:apply', owner.token, { plots: ['1', '2', '3'], decision: 'correct' });
    let list = (await call('GET', '/quality/corrections', owner.token)).json();
    expect(list.counts).toEqual({ unassigned: 3, assigned: 0, corrected: 0 });
    expect(list.people.map((p: { username: string }) => p.username).sort()).toEqual(['maria', 'owner', 'rita']);
    const assign = await call('POST', '/quality/corrections:assign', owner.token, { plots: ['2', '3', '4'], people: [rita.userId] });
    expect(assign.json()).toMatchObject({ count: 2, skipped: ['4'], skippedCount: 1, own: [{ plot: '2', username: 'rita' }, { plot: '3', username: 'rita' }], ownCount: 2 });
    list = (await call('GET', '/quality/corrections', owner.token)).json();
    expect(list.lines.map((l: { plot: string; assignedTo: { username: string } | null; own: boolean }) => [l.plot, l.assignedTo?.username ?? null, l.own])).toEqual([
      ['1', null, false],
      ['2', 'rita', true],
      ['3', 'rita', true],
    ]);
    expect(list.counts).toEqual({ unassigned: 1, assigned: 2, corrected: 0 });
    // To nobody
    await call('POST', '/quality/corrections:assign', owner.token, { plots: ['3'], people: [] });
    expect((await call('GET', '/quality/corrections', owner.token)).json().counts).toEqual({ unassigned: 2, assigned: 1, corrected: 0 });
    // Coordinators only
    expect((await call('GET', '/quality/corrections', rita.token)).statusCode).toBe(403);
    expect((await call('POST', '/quality/corrections:assign', maria.token, { plots: ['1'], people: [] })).statusCode).toBe(403);
    expect((await call('POST', '/quality/corrections:assign', owner.token, { plots: [], people: [] })).statusCode).toBe(400);
  });

  it('Collect Earth gets the person\'s plots to correct: the first answer first, where they differ, the comment; their plot file', async () => {
    await call('POST', '/quality/decisions:apply', owner.token, { plots: ['1', '3'], decision: 'correct', comment: 'look at the trees', assign: [maria.userId] });
    const mine = await call('GET', '/my-corrections', maria.token);
    expect(mine.statusCode, mine.body).toBe(200);
    const body = mine.json();
    expect(body.plots.map((p: { plot: string }) => p.plot)).toEqual(['1', '3']);
    const one = body.plots[0];
    expect(one).toMatchObject({ plot: '1', comment: 'look at the trees', decidedBy: 'owner', own: false, correctedAt: null });
    expect(one.answers.map((a: { operator: string; assessment: string; xml: string }) => [a.operator, a.assessment, a.xml])).toEqual([
      ['ana', 'main', '<plot><id>1</id><by>ana</by></plot>'],
      ['ben', 'check', '<plot><id>1</id><by>ben</by></plot>'],
    ]);
    expect(one.differences).toEqual([{ key: LAND_USE, question: expect.any(String), values: [expect.objectContaining({ operator: 'ana', value: 'F' }), expect.objectContaining({ operator: 'ben', value: 'G' })] }]);
    // The plot id and its round (the survey's records are "<plot>,<round>")
    expect(body.keyColumns).toBe(2);
    // The same version while nothing changed; the plot file of those plots
    expect((await call('GET', '/my-corrections', maria.token)).json().version).toBe(body.version);
    const csv = await ctx.app.inject({ method: 'GET', url: body.downloadPath, headers: bearer(maria.token) });
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body.trim().split(/\r?\n/).map((l) => l.split(',')[0])).toEqual(['id', '1', '3']);
    // Each plot's id in that file is its keys there (Collect Earth finds the plot by it)
    const rowIds = csv.body.trim().split(/\r?\n/).slice(1).map((l) => l.split(',').slice(0, body.keyColumns).join(','));
    expect(body.plots.map((p: { placemarkId: string }) => p.placemarkId)).toEqual(rowIds);
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/my-corrections.csv?v=old`, headers: bearer(maria.token) })).statusCode).toBe(409);
    // Someone else: none; a project token: no person
    expect((await call('GET', '/my-corrections', rita.token)).json().plots).toEqual([]);
    expect((await call('GET', '/my-corrections', projectToken)).statusCode).toBe(403);
  });

  it('a correction: kept by whom it is assigned to, the plot\'s final answer in the export; refused when no longer theirs or no longer to correct', async () => {
    await call('POST', '/quality/decisions:apply', owner.token, { plots: ['1', '4'], decision: 'correct', assign: [maria.userId] });
    const correction = { recordKey: '1,1', xml: '<plot><id>1</id><by>maria</by></plot>', summary: { [LAND_USE]: 'C', [FOREST]: '40', collect_code_round: '1' }, baseOperator: 'ana' };
    expect((await call('PUT', '/corrections/1', rita.token, correction)).json()).toMatchObject({ error: 'not_assigned' });
    const saved = await call('PUT', '/corrections/1', maria.token, correction);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ plot: '1', correctedAt: expect.any(Number) });
    expect((await call('GET', '/my-corrections', maria.token)).json().plots[0].correctedAt).toBe(saved.json().correctedAt);
    expect((await call('GET', '/quality/corrections', owner.token)).json().counts).toEqual({ unassigned: 0, assigned: 1, corrected: 1 });
    // The export: the correction a row of its own, final yes; the plot's records no; a plot not corrected yet "correct"
    // (fields quoted when they hold a comma: the record keys "1,1")
    const fields = (line: string) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m) => m[1].replace(/^"|"$/g, '')).slice(0, -1);
    const csv = (await call('GET', '/export.csv', owner.token)).body.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(fields);
    const col = (name: string) => csv[0].indexOf(name);
    const rows = csv.slice(1).map((r) => [r[col('record_key')], r[col('operator')], r[col('assessment')], r[col('final')], r[col(LAND_USE)]]);
    expect(rows.filter((r) => r[0].startsWith('1,'))).toEqual(
      expect.arrayContaining([
        ['1,1', 'ana', 'main', 'no', 'F'],
        ['1,1', 'maria', 'correction', 'yes', 'C'],
        ['1,2', 'ben', 'check', 'no', 'G'],
      ]),
    );
    expect(rows.filter((r) => r[0].startsWith('4,')).map((r) => r[3])).toEqual(['correct', 'correct']);
    // The decision changed: no longer to correct
    await call('PUT', '/quality/decisions/4', owner.token, { decision: 'first' });
    expect((await call('PUT', '/corrections/4', maria.token, { ...correction, recordKey: '4,1' })).json()).toMatchObject({ error: 'not_to_correct' });
    expect((await call('GET', '/my-corrections', maria.token)).json().plots.map((p: { plot: string }) => p.plot)).toEqual(['1']);
    for (const bad of [{ ...correction, xml: '' }, { ...correction, summary: { a: 1 } }, { ...correction, recordKey: undefined }]) {
      expect((await call('PUT', '/corrections/1', maria.token, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await ctx.store.listAudit(pid, { limit: 20, action: 'correction.saved' })).map((e) => [e.actor, e.details])).toEqual([['maria', { plot: '1' }]]);
  });
});
