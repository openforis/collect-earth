// A repeat survey (src/repeatSurvey.ts, src/routes/repeatSurvey.ts, plan docs/plans/2026-11-11-repeat-survey.md): a new
// project collecting the plots of an earlier one again, with the earlier answers kept apart as a period.
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changeAreas, compareRepeat, defaultHeaderQuestions, earlierRecords, labelOf, matchToSurvey, yearOf, type SourceRecord } from '../src/repeatSurvey.js';
import { surveyOutline } from '../src/surveyOutline.js';
import { stratifiedTotal, uncertainty } from '../src/uncertainty.js';
import { cepWith, idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';
const demoSurvey = () => strFromU8(unzipSync(idOnlyCep())['placemark.idm.xml']);

describe('the earlier period of a repeat survey', () => {
  const t = (day: number) => Date.UTC(2020, 5, day);
  const rec = (recordKey: string, operator: string, day: number, landUse: string, extra: Partial<SourceRecord> = {}): SourceRecord => ({
    recordKey, operator, modifiedOn: t(day), activelySaved: true, deleted: false, summary: { [LAND_USE]: landUse }, ...extra,
  });
  const roundOf = (r: SourceRecord) => {
    const [plot, round] = r.recordKey.split(',');
    return { plot, round, assessment: round === '2' ? ('check' as const) : ('main' as const) };
  };

  it("takes one record per plot: the coordinator's final one, else the latest submitted first assessment", () => {
    const records = [
      rec('1,1', 'maria', 1, 'F'),
      rec('1,1', 'ana', 3, 'G'),
      rec('1,2', 'ben', 4, 'C'),
      rec('2,1', 'maria', 2, 'C'),
      rec('2,2', 'ben', 5, 'S'),
      rec('3,1', 'maria', 6, 'W', { activelySaved: false }),
      rec('4,1', 'maria', 7, 'O', { deleted: true }),
    ];
    // plot 2 was decided for the check: ben's answer is the final one
    const finalOf = (r: SourceRecord) => (r.recordKey === '2,2' ? 'yes' : r.recordKey === '2,1' ? 'no' : '');
    const earlier = earlierRecords(records, roundOf, finalOf);
    expect(earlier.map((r) => [r.plot, r.operator, r.answers[LAND_USE]])).toEqual([
      ['1', 'ana', 'G'],
      ['2', 'ben', 'S'],
    ]);
    expect(earlier[0].savedAt).toBe(t(3));
  });

  it('matches the answers to the new survey: what it no longer asks is left out and reported, with unknown codes', () => {
    const outline = surveyOutline(demoSurvey());
    const { records, report } = matchToSurvey(
      [
        { plot: '1', operator: 'maria', savedAt: 1, answers: { [LAND_USE]: 'F', collect_text_gone_question: 'x', collect_text_operator: 'maria', collect_text_id: '1' } },
        { plot: '2', operator: 'maria', savedAt: 1, answers: { [LAND_USE]: 'ZZ', collect_text_gone_question: '' } },
      ],
      outline,
    );
    expect(records[0].answers).toEqual({ [LAND_USE]: 'F' });
    expect(records[1].answers).toEqual({ [LAND_USE]: 'ZZ' });
    // the plot's keys and the bookkeeping are the new records' own: not reported
    expect(report.questionsLeftOut).toEqual([{ key: 'collect_text_gone_question', plots: 1 }]);
    expect(report.unknownAnswers).toEqual([{ key: LAND_USE, code: 'ZZ', plots: 1 }]);
  });

  it("shows the plot's land in the header by default, and labels periods by year", () => {
    const header = defaultHeaderQuestions(surveyOutline(demoSurvey()));
    expect(header).toContain(LAND_USE);
    expect(header.length).toBeLessThanOrEqual(4);
    expect(header.every((k) => !k.includes('.'))).toBe(true);
    expect(yearOf([{ savedAt: Date.UTC(2020, 1) }, { savedAt: Date.UTC(2020, 8) }, { savedAt: Date.UTC(2021, 0) }])).toBe('2020');
    expect(yearOf([])).toBeNull();
    expect(labelOf(' 2020 ')).toBe('2020');
    expect(labelOf('')).toBeNull();
    expect(labelOf('x'.repeat(41))).toBeNull();
    expect(labelOf(2020)).toBeNull();
  });
});

describe('comparing a repeat survey with its earlier period', () => {
  const STATUS = 'collect_code_period_status';
  const a = (land: string, status?: string) => ({ [LAND_USE]: land, ...(status ? { [STATUS]: status } : {}) });

  it('tells each plot unchanged, changed, corrected, new or pending, and the transition matrix of real changes', () => {
    const change = compareRepeat(
      [
        { plot: '1', answers: a('F') },
        { plot: '2', answers: a('F') },
        { plot: '3', answers: a('C') },
        { plot: '4', answers: a('G') },
        { plot: '10', answers: a('F::old') },
      ],
      [
        { plot: '1', answers: a('F', 'same') },
        { plot: '2', answers: a('C', 'changed') },
        { plot: '3', answers: a('G', 'corrected') },
        { plot: '5', answers: a('S') },
        { plot: '10', answers: a('F', 'changed') },
      ],
      LAND_USE,
      STATUS,
    );
    expect(change.rows.map((r) => [r.plot, r.earlier, r.now, r.outcome, r.mismatch])).toEqual([
      ['1', 'F', 'F', 'unchanged', null],
      ['2', 'F', 'C', 'changed', null],
      ['3', 'C', 'G', 'corrected', null],
      ['4', 'G', null, 'pending', null],
      ['5', null, 'S', 'new', null],
      // the qualifier is no answer of its own; said changed with the same answer: to look at again
      ['10', 'F', 'F', 'unchanged', 'changedButSame'],
    ]);
    expect(change.counts).toEqual({ unchanged: 2, changed: 1, corrected: 1, new: 1, pending: 1, mismatches: 1 });
    expect(change.matrix).toEqual(expect.arrayContaining([{ from: 'F', to: 'F', plots: 2 }, { from: 'F', to: 'C', plots: 1 }]));
    expect(change.matrix).toHaveLength(2);
    // corrections are kept out of the matrix, counted apart
    expect(change.corrections).toEqual([{ from: 'C', to: 'G', plots: 1 }]);
  });

  it('flags a plot said to be the same whose answer differs', () => {
    const change = compareRepeat([{ plot: '1', answers: a('F') }], [{ plot: '1', answers: a('C', 'same') }], LAND_USE, STATUS);
    expect(change.rows[0]).toMatchObject({ outcome: 'changed', mismatch: 'sameButDiffers' });
  });
});

describe('the areas of the changes and their uncertainty', () => {
  const STATUS = 'collect_code_period_status';
  const a = (land: string, status?: string) => ({ [LAND_USE]: land, ...(status ? { [STATUS]: status } : {}) });
  const rows = compareRepeat(
    [
      { plot: '1', answers: a('F') },
      { plot: '2', answers: a('F') },
      { plot: '3', answers: a('C') },
      { plot: '4', answers: a('C') },
      { plot: '5', answers: a('G') },
    ],
    [
      { plot: '1', answers: a('F', 'same') },
      { plot: '2', answers: a('C', 'changed') },
      { plot: '3', answers: a('C', 'same') },
      { plot: '4', answers: a('G', 'corrected') },
      { plot: '6', answers: a('S') },
    ],
    LAND_USE,
    STATUS,
  ).rows;

  it('works out each area as the IPCC uncertainty does: one stratum, the share of the plots times the area', () => {
    const areas = changeAreas(rows, () => '', new Map([['', 100]]));
    expect(areas).toMatchObject({ estimator: 'simple', totalArea: 100, plots: 4, skipped: { notCompared: 2, noArea: 0 } });
    // 1 plot of 4 changed: 25 ha, SE = 100·√(0.25·0.75/3) = 25, 95% CI = 1.96·25
    expect(areas.outcomes.changed).toMatchObject({ plots: 1, area: 25, share: 0.25, se: 25 });
    expect(areas.outcomes.changed.ci).toBeCloseTo(49, 10);
    expect(areas.outcomes.changed.uncertainty).toBeCloseTo(196, 10);
    expect(areas.outcomes.unchanged.area).toBe(50);
    expect(areas.matrix.map((m) => [m.from, m.to, m.estimate.area])).toEqual([['C', 'C', 25], ['F', 'C', 25], ['F', 'F', 25]]);
    expect(areas.corrections.map((m) => [m.from, m.to, m.estimate.area])).toEqual([['C', 'G', 25]]);
    // the earlier period as now known: the corrected plot was Grassland then too, so no change of Grassland
    const cls = Object.fromEntries(areas.classes.map((c) => [c.code, c]));
    expect([cls.F.then.area, cls.F.now.area, cls.F.net.area]).toEqual([50, 25, -25]);
    expect([cls.C.then.area, cls.C.now.area, cls.C.net.area]).toEqual([25, 50, 25]);
    expect([cls.G.then.area, cls.G.now.area, cls.G.net.area, cls.G.net.uncertainty]).toEqual([25, 25, 0, null]);
    // the net loss of Forest: y = −1 on one plot of 4, s² = 0.25, SE = 100·√(0.25/4) = 25
    expect(cls.F.net.se).toBeCloseTo(25, 10);
    expect(cls.F.net.plots).toBe(1);
  });

  it('by strata: the plots in no stratum are left out, and a stratum of one plot has no variance', () => {
    const stratum: Record<string, string | null> = { '1': 'A', '2': 'A', '3': 'B', '4': 'B', '6': 'A' };
    const areas = changeAreas(rows, (p) => stratum[p] ?? null, new Map([['A', 1000], ['B', 3000], ['C', 500]]));
    expect(areas).toMatchObject({ estimator: 'stratified', totalArea: 4000, plots: 4 });
    // A: 1 of 2 plots changed (500 ha, var 1000²·0.25/1); B: none
    expect(areas.outcomes.changed.area).toBe(500);
    expect(areas.outcomes.changed.se).toBeCloseTo(500, 10);
    expect(areas.notEstimable).toEqual([{ key: 'C', area: 500, plots: 0 }]);
    expect(changeAreas(rows, (p) => (p === '1' ? 'A' : null), new Map([['A', 10]])).skipped).toEqual({ notCompared: 2, noArea: 3 });
  });

  it('the stratified total of a plot in a class or not is the uncertainty page\'s estimate', () => {
    const plots = [
      ...['F', 'F', 'C'].map((c) => ({ initial: c, final: c, stratum: 'A' })),
      ...['F', 'C', 'C', 'C'].map((c) => ({ initial: c, final: c, stratum: 'B' })),
    ];
    const ipcc = uncertainty(plots, new Map([['A', 300], ['B', 800]]), { codes: { l: { F: 'forest', C: 'cropland' } }, initialList: 'l', finalList: 'l' });
    const forest = ipcc.categories.find((c) => c.category === 'forest')!.final;
    const ours = stratifiedTotal([{ area: 300, values: [1, 1, 0] }, { area: 800, values: [1, 0, 0, 0] }]);
    expect(ours.total).toBeCloseTo(forest.area, 10);
    expect(ours.se).toBeCloseTo(forest.se, 10);
    expect(ours.ci).toBeCloseTo(forest.ci, 10);
  });
});

describe('repeating a survey in the dashboard', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let ben: { token: string; userId: string };

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}, project = pid) =>
    ctx.app.inject({ method, url: `/v1/projects/${project}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };
  const t0 = Date.UTC(2020, 5, 1, 9);
  const main = (plot: number, operator: string, landUse: string, submitted = true) =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: t0 + plot * 60_000, activelySaved: submitted, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '1' } });
  const check = (plot: number, operator: string, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: t0 + 3_600_000, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '2' } });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Land 2020' } })).json().projectId;
    maria = await join('maria', 'operator');
    ben = await join('ben', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 5 }, (_, i) => `${i + 1},0,0`)].join('\n'), { 'content-type': 'text/csv' });
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csv.json().id }, { userId: ben.userId, csvFileId: csv.json().id }] });
    // maria: plots 1 (Forest) and 2 (Cropland) submitted, plot 3 a draft; ben checks plot 1 (Grassland)
    expect((await batchRequest(ctx.app, pid, maria.token, [main(1, 'maria', 'F'), main(2, 'maria', 'C'), main(3, 'maria', 'G', false)])).statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, ben.token, [check(1, 'ben', 'G')])).statusCode).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('the preview counts the plots and proposes the labels and the header; nothing is made', async () => {
    const res = await call('POST', '/repeat/preview', owner.token, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ plots: 2, earlierLabel: '2020', label: String(new Date().getUTCFullYear()), periods: [] });
    expect(res.json().headerQuestions).toContain(LAND_USE);
    expect(res.json().questions.find((q: { key: string }) => q.key === LAND_USE)).toMatchObject({ kind: 'choice' });
    expect(res.json().report).toEqual({ questionsLeftOut: [], unknownAnswers: [] });
    // collectors may not repeat a survey
    expect((await call('POST', '/repeat/preview', maria.token, {})).statusCode).toBe(403);
  });

  it("makes the new project with the earlier answers apart: the first assessments, never its own records", async () => {
    const res = await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020', members: true, headerQuestions: [LAND_USE, 'collect_text_id', 'nothing'] });
    expect(res.statusCode, res.body).toBe(201);
    const { projectId } = res.json();
    expect(res.json()).toMatchObject({ name: 'Land 2025', status: 'draft', label: '2025', periods: [{ label: '2020', plots: 2 }], headerQuestions: [LAND_USE] });

    // the earlier answers, not records of the new project
    expect(await ctx.store.listRecords(projectId)).toHaveLength(0);
    // the survey it serves asks the period status, which the source's does not
    const served = strFromU8(unzipSync(new Uint8Array((await ctx.store.getCep(projectId))!))['placemark.idm.xml']);
    expect(surveyOutline(served).get('collect_code_period_status')?.options?.map((o) => o.code)).toEqual(['same', 'changed', 'corrected']);
    expect(strFromU8(unzipSync(new Uint8Array((await ctx.store.getCep(pid))!))['placemark.idm.xml'])).not.toContain('period_status');
    const earlier = await ctx.store.listPeriodAnswers(projectId, '2020');
    expect(earlier.map((r) => [r.plotKey, r.operator, r.answers[LAND_USE]]).sort()).toEqual([
      ['1', 'maria', 'F'],
      ['2', 'maria', 'C'],
    ]);
    // the survey, the plot files and the people came along
    expect((await call('GET', '/csv-files', owner.token, undefined, {}, projectId)).json().csvFiles).toHaveLength(1);

    const periods = await call('GET', '/periods', maria.token, undefined, {}, projectId);
    expect(periods.statusCode, periods.body).toBe(200);
    expect(periods.json()).toMatchObject({ settings: { label: '2025', earlier: [{ label: '2020', sourceProjectId: pid, sourceName: 'Land 2020', plots: 2 }] }, periods: [{ label: '2020', plots: 2 }] });
    expect(periods.json().questions[0].key).toBe(LAND_USE);
    expect(periods.json().questions[0].label).not.toBe(LAND_USE);

    // one plot's earlier answers: who collected them is told to coordinators only
    const forOwner = await call('GET', '/periods/plots/1', owner.token, undefined, {}, projectId);
    expect(forOwner.json().periods).toEqual([{ label: '2020', savedAt: t0 + 60_000, answers: expect.objectContaining({ [LAND_USE]: 'F' }), operator: 'maria' }]);
    // with the questions' labels and the answers' names, though the new project has no record of the plot
    expect(forOwner.json().labels[LAND_USE]).not.toBe(LAND_USE);
    expect(forOwner.json().options[LAND_USE].some((o: { code: string }) => o.code === 'F')).toBe(true);
    const forCollector = await call('GET', '/periods/plots/1', maria.token, undefined, {}, projectId);
    expect(forCollector.json().periods[0]).not.toHaveProperty('operator');
    expect((await call('GET', '/periods/plots/3', owner.token, undefined, {}, projectId)).json().periods).toEqual([]);
    // as the desktop names the plot (with the round the server added), with what the form's header shows
    const asDesktop = (await call('GET', '/periods/plots/1,1', maria.token, undefined, {}, projectId)).json();
    expect(asDesktop.periods[0].answers[LAND_USE]).toBe('F');
    expect(asDesktop).toMatchObject({ label: '2025', header: [LAND_USE] });

    // the header's questions, changed by the coordinator, only the survey's
    const header = await call('PUT', '/periods/header', owner.token, { headerQuestions: [FOREST, LAND_USE, 'nothing'] }, {}, projectId);
    expect(header.json()).toEqual({ headerQuestions: [FOREST, LAND_USE] });
    expect((await call('PUT', '/periods/header', maria.token, { headerQuestions: [FOREST] }, {}, projectId)).statusCode).toBe(403);
    // the earlier project has no periods of its own
    expect((await call('GET', '/periods', owner.token)).json()).toEqual({ settings: null, periods: [], questions: [] });
    expect((await call('PUT', '/periods/header', owner.token, { headerQuestions: [FOREST] })).statusCode).toBe(404);
  });

  it("takes the coordinator's final answer of a decided plot", async () => {
    await ctx.store.setQualityDecision(pid, '1', 'check', null, owner.userId);
    const res = await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020' });
    expect(res.statusCode, res.body).toBe(201);
    const earlier = await ctx.store.getPlotPeriodAnswers(res.json().projectId, '1');
    expect(earlier.map((r) => [r.operator, r.answers[LAND_USE]])).toEqual([['ben', 'G']]);
  });

  it('a repeat of a repeat brings every earlier period, each with a label of its own', async () => {
    const first = (await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020', members: true })).json().projectId;
    // a new project is a draft until the coordinator opens it
    expect((await call('PUT', '/status', owner.token, { status: 'active' }, {}, first)).statusCode).toBe(200);
    const r2 = (n: number) => envelope({ recordKey: `${n},1`, operator: 'maria', modifiedOn: Date.UTC(2025, 5, 1), summary: { [LAND_USE]: 'S', collect_code_round: '1' } });
    expect((await batchRequest(ctx.app, first, maria.token, [r2(1)])).statusCode).toBe(200);
    // 2025 is taken: the periods need labels of their own
    expect((await call('POST', '/repeat', owner.token, { name: 'Land 2030', label: '2020', earlierLabel: '2025' }, {}, first)).statusCode).toBe(400);
    expect((await call('POST', '/repeat', owner.token, { name: 'Land 2030', label: '2030', earlierLabel: '2020' }, {}, first)).statusCode).toBe(400);
    const preview = (await call('POST', '/repeat/preview', owner.token, {}, {}, first)).json();
    expect(preview).toMatchObject({ plots: 1, earlierLabel: '2025', periods: [{ label: '2020', plots: 2 }] });
    const res = await call('POST', '/repeat', owner.token, { name: 'Land 2030', label: '2030', earlierLabel: '2025' }, {}, first);
    expect(res.statusCode, res.body).toBe(201);
    const third = res.json().projectId;
    expect(res.json().periods.map((p: { label: string; plots: number }) => [p.label, p.plots])).toEqual([['2020', 2], ['2025', 1]]);
    expect((await ctx.store.getPlotPeriodAnswers(third, '1')).map((r) => [r.label, r.answers[LAND_USE]])).toEqual([['2020', 'F'], ['2025', 'S']]);
  });

  it('takes a newer project file, and reports the answers it no longer asks for', async () => {
    // the newer survey has no forest percentage any more
    const survey = demoSurvey().replace(/[ \t]*<number[^>]*name="forest_percentage"[\s\S]*?<\/number>\r?\n/, '');
    expect(survey).not.toContain('name="forest_percentage"');
    const newer = cepWith(Object.entries(unzipSync(idOnlyCep())).map(([k, v]) => [k, k === 'placemark.idm.xml' ? Buffer.from(survey) : Buffer.from(v)] as [string, Buffer]));
    const preview = await call('POST', '/repeat/preview', owner.token, { projectFile: newer.toString('base64') });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().report.questionsLeftOut).toEqual([{ key: FOREST, plots: 2 }]);
    const res = await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020', projectFile: newer.toString('base64') });
    expect(res.statusCode, res.body).toBe(201);
    expect((await ctx.store.getPlotPeriodAnswers(res.json().projectId, '2'))[0].answers).not.toHaveProperty(FOREST);
    expect((await call('POST', '/repeat/preview', owner.token, { projectFile: Buffer.from('nope').toString('base64') })).json()).toMatchObject({ error: 'cep_unreadable' });
  });

  it('compares a question between the two periods: the counts, the matrix, the plots, and a file of them', async () => {
    const made = await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020', members: true });
    const projectId = made.json().projectId;
    expect((await call('PUT', '/status', owner.token, { status: 'active' }, {}, projectId)).statusCode).toBe(200);
    const now = (plot: number, land: string, status: string) =>
      envelope({ recordKey: `${plot},1`, operator: 'maria', modifiedOn: Date.UTC(2025, 5, plot), summary: { [LAND_USE]: land, collect_code_round: '1', collect_code_period_status: status } });
    // 2020: plot 1 Forest, plot 2 Cropland (plot 3 a draft then)
    expect((await batchRequest(ctx.app, projectId, maria.token, [now(1, 'F', 'same'), now(2, 'G', 'corrected'), now(3, 'S', 'changed')])).statusCode).toBe(200);
    const res = await call('GET', '/periods/change', owner.token, undefined, {}, projectId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      period: '2020', label: '2025', periods: ['2020'], question: { key: LAND_USE },
      counts: { unchanged: 1, changed: 0, corrected: 1, new: 1, pending: 0, mismatches: 0 },
      matrix: [{ from: 'F', to: 'F', plots: 1 }],
      corrections: [{ from: 'C', to: 'G', plots: 1 }],
    });
    expect(res.json().options.some((o: { code: string }) => o.code === 'F')).toBe(true);
    expect(res.json().questions.map((q: { key: string }) => q.key)).toContain(LAND_USE);
    const csv = await call('GET', '/periods/change.csv', owner.token, undefined, {}, projectId);
    expect(csv.statusCode).toBe(200);
    const lines = csv.body.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe(`plot,${LAND_USE} 2020,${LAND_USE} 2025,2020 label,2025 label,period_status,outcome,to_look_at`);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['1', '2', '3']);
    expect(lines[2]).toMatch(/^2,C,G,[^,]+,[^,]+,corrected,corrected,$/);
    // collectors do not see it; a project that repeats no survey has none
    expect((await call('GET', '/periods/change', maria.token, undefined, {}, projectId)).statusCode).toBe(403);
    expect((await call('GET', '/periods/change', owner.token)).statusCode).toBe(404);
  });

  it('gives the areas of the changes: shares until the total area is known, then hectares, and a file of them', async () => {
    const made = await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020', members: true });
    const projectId = made.json().projectId;
    expect((await call('PUT', '/status', owner.token, { status: 'active' }, {}, projectId)).statusCode).toBe(200);
    const now = (plot: number, land: string, status: string) =>
      envelope({ recordKey: `${plot},1`, operator: 'maria', modifiedOn: Date.UTC(2025, 5, plot), summary: { [LAND_USE]: land, collect_code_round: '1', collect_code_period_status: status } });
    // 2020: plot 1 Forest, plot 2 Cropland; 2025: plot 1 changed to Cropland, plot 2 the same
    expect((await batchRequest(ctx.app, projectId, maria.token, [now(1, 'C', 'changed'), now(2, 'C', 'same')])).statusCode).toBe(200);
    const shares = (await call('GET', '/periods/change', owner.token, undefined, {}, projectId)).json();
    expect(shares.areas).toMatchObject({ areaKnown: false, source: null, savedArea: null, estimator: 'simple', totalArea: 1, plots: 2, outcomes: { changed: { plots: 1, share: 0.5 } } });
    expect(shares.canEdit).toBe(true);

    expect((await call('PUT', '/periods/area', maria.token, { totalArea: 5000 }, {}, projectId)).statusCode).toBe(403);
    expect((await call('PUT', '/periods/area', owner.token, { totalArea: -1 }, {}, projectId)).statusCode).toBe(400);
    expect((await call('PUT', '/periods/area', owner.token, { totalArea: 5000 }, {}, projectId)).statusCode).toBe(200);
    const ha = (await call('GET', '/periods/change', owner.token, undefined, {}, projectId)).json().areas;
    expect(ha).toMatchObject({ areaKnown: true, savedArea: 5000, totalArea: 5000, outcomes: { changed: { area: 2500 } } });
    // Forest lost 2500 ha, Cropland gained them; SE = 5000·√(0.5/2) = 2500
    const forest = ha.classes.find((c: { code: string }) => c.code === 'F');
    expect(forest.net).toMatchObject({ area: -2500, se: 2500, plots: 1 });
    // an area asked in the query is used without being saved
    expect((await call('GET', '/periods/change?area=100', owner.token, undefined, {}, projectId)).json().areas.totalArea).toBe(100);

    const csv = await call('GET', '/periods/change-areas.csv', owner.token, undefined, {}, projectId);
    expect(csv.statusCode).toBe(200);
    const lines = csv.body.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('table,from,to,from label,to label,plots,area_ha,share_pct,se_ha,ci95_ha,uncertainty_pct');
    expect(lines[2]).toBe('outcome changed,,,,,1,2500,50,2500,4900,196');
    expect(lines.some((l) => /^net change,F,F,[^,]+,[^,]+,1,-2500,-50,2500,4900,196$/.test(l))).toBe(true);
    expect((await call('GET', '/periods/change-areas.csv', maria.token, undefined, {}, projectId)).statusCode).toBe(403);

    // cleared, it is shares again
    expect((await call('PUT', '/periods/area', owner.token, { totalArea: null }, {}, projectId)).statusCode).toBe(200);
    expect((await call('GET', '/periods/change', owner.token, undefined, {}, projectId)).json().areas.areaKnown).toBe(false);
    expect((await call('PUT', '/periods/area', owner.token, { totalArea: 10 })).statusCode).toBe(404);
  });

  it("takes the strata of the project file's areas file", async () => {
    const files = unzipSync(idOnlyCep());
    const regional = cepWith([...Object.entries(files).map(([k, v]) => [k, Buffer.from(v)] as [string, Buffer]), ['region_areas.csv', 'region,plot_file,area\nNorth,,1000\nSouth,,3000\n']]);
    expect((await call('PUT', '/cep', owner.token, regional, { 'content-type': 'application/zip' })).statusCode).toBe(200);
    const made = await call('POST', '/repeat', owner.token, { name: 'Land 2025', label: '2025', earlierLabel: '2020', members: true });
    const projectId = made.json().projectId;
    expect((await call('PUT', '/status', owner.token, { status: 'active' }, {}, projectId)).statusCode).toBe(200);
    const now = (plot: number, land: string, region: string) =>
      envelope({ recordKey: `${plot},1`, operator: 'maria', modifiedOn: Date.UTC(2025, 5, plot), summary: { [LAND_USE]: land, collect_code_round: '1', collect_text_region: region, collect_code_period_status: 'same' } });
    expect((await batchRequest(ctx.app, projectId, maria.token, [now(1, 'C', 'North'), now(2, 'C', 'South')])).statusCode).toBe(200);
    const areas = (await call('GET', '/periods/change', owner.token, undefined, {}, projectId)).json().areas;
    // plot 1 (North, 1000 ha) changed from Forest; plot 2 (South, 3000 ha) still Cropland
    expect(areas).toMatchObject({ source: 'region_areas.csv', areaKnown: true, estimator: 'stratified', totalArea: 4000, outcomes: { changed: { area: 1000 }, unchanged: { area: 3000 } } });
    expect(areas.notEstimable).toHaveLength(2);
  });

  it('needs a name, two labels and a person to coordinate it', async () => {
    expect((await call('POST', '/repeat', owner.token, { label: '2025', earlierLabel: '2020' })).statusCode).toBe(400);
    expect((await call('POST', '/repeat', owner.token, { name: 'x', label: '2020', earlierLabel: '2020' })).statusCode).toBe(400);
    expect((await call('POST', '/repeat', owner.token, { name: 'x', label: '', earlierLabel: '2020' })).statusCode).toBe(400);
    expect((await call('POST', '/repeat', maria.token, { name: 'x', label: '2025', earlierLabel: '2020' })).statusCode).toBe(403);
  });
});

describe('the period status a repeat survey asks', () => {
  it('is added once to the survey, after the keys, with its list; a project file uploaded again keeps it', async () => {
    const { addPeriodStatus, readCep } = await import('../src/cep.js');
    const first = addPeriodStatus(idOnlyCep());
    expect(first.added).toBe(true);
    const files = readCep(first.cep);
    const survey = strFromU8(files.entries.get(files.surveyPath)!);
    const outline = surveyOutline(survey);
    expect(outline.get('collect_code_period_status')).toMatchObject({ kind: 'choice', label: 'Since the earlier period' });
    // after the plot's key
    const attribute = survey.search(/<code id="\d+" name="period_status" ui:tab="[^"]+" list="period_status">/);
    expect(attribute).toBeGreaterThan(survey.indexOf('<text id="2" name="id"'));
    // every id once
    const ids = [...survey.matchAll(/ id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Number(/lastId="(\d+)"/.exec(survey)![1])).toBeGreaterThanOrEqual(Math.max(...ids.map(Number)));
    // a second time: nothing to add
    const again = addPeriodStatus(first.cep);
    expect(again.added).toBe(false);
    expect(again.cep).toBe(first.cep);
  });

  it('comes back when the coordinator uploads a project file to a repeat survey', async () => {
    const ctx = await makeContext();
    try {
      const owner = await setupPlatformAdmin(ctx.app);
      const pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Land 2020' } })).json().projectId;
      await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: idOnlyCep() });
      const made = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/repeat`, headers: bearer(owner.token), payload: { name: 'Land 2025', label: '2025', earlierLabel: '2020' } });
      const projectId = made.json().projectId;
      const upload = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: idOnlyCep() });
      expect(upload.statusCode, upload.body).toBe(200);
      const served = strFromU8(unzipSync(new Uint8Array((await ctx.store.getCep(projectId))!))['placemark.idm.xml']);
      expect(surveyOutline(served).has('collect_code_period_status')).toBe(true);
    } finally {
      await ctx.app.close();
    }
  });
});
