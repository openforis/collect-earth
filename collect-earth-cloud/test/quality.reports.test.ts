import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

/** Distinctive names, so a leak shows up even as part of another string. */
const FIRST = 'zebulonfirst';
const CHECKER = 'quixotecheck';
const REVIEWER = 'xanthippereview';
const COORDINATOR = 'wilhelminacoord';
const SECOND_CHECKER = 'ottokarcheck';
const NAMES = [FIRST, CHECKER, REVIEWER, COORDINATOR, SECOND_CHECKER];
/** The demo survey's land use options, as the reports give them for showing answers. */
const LAND_USE_OPTIONS = [
  { code: 'F', label: 'Forest' },
  { code: 'C', label: 'Cropland' },
  { code: 'G', label: 'Grassland' },
  { code: 'S', label: 'Settlement' },
  { code: 'W', label: 'Wetland' },
  { code: 'O', label: 'Otherland' },
];
/** When the checks were made: must not appear in the personal report. */
const CHECK_TIME = Date.UTC(2026, 9, 28, 13, 37, 42, 123);

async function registerUser(app: FastifyInstance, pid: string, adminToken: string, username: string, role = 'operator') {
  const invite = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(adminToken), payload: { role, maxUses: 1 } });
  expect(invite.statusCode, invite.body).toBe(201);
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
  expect(res.statusCode, res.body).toBe(201);
  return { userId: res.json().userId as string, token: res.json().token as string, username };
}

describe('quality reports for collectors and the team', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  let pid: string;
  let users: Record<string, { token: string; userId: string }>;
  let fileId: string;
  const url = (path: string, id = pid) => `/v1/projects/${id}${path}`;
  const get = (path: string, token: string, id = pid) => ctx.app.inject({ method: 'GET', url: url(path, id), headers: bearer(token) });

  const record = (recordKey: string, operator: string, landUse: string, round: '1' | '2', modifiedOn = 1000) =>
    envelope({ recordKey, operator, modifiedOn, summary: { [LAND_USE]: landUse, [FOREST]: '10', collect_code_round: round } });

  /**
   * FIRST assesses plots 1-24, CHECKER checks them: land use F→G on 21-24 (4 checks) and
   * F→C on 1-2. SECOND_CHECKER checks 23 and 24 again (F→G). CHECKER assesses 25 first,
   * FIRST checks it (S→F: CHECKER's mix-up, not FIRST's). REVIEWER assesses 26, checked
   * by FIRST, agreeing.
   */
  const collect = async (projectId = pid, token = project.projectToken) => {
    const records = [];
    for (let i = 1; i <= 24; i++) {
      records.push(record(`${i},1`, FIRST, 'F', '1'));
      records.push(record(`${i},2`, CHECKER, i > 20 ? 'G' : i <= 2 ? 'C' : 'F', '2', CHECK_TIME));
    }
    records.push(record('23,2', SECOND_CHECKER, 'G', '2', CHECK_TIME), record('24,2', SECOND_CHECKER, 'G', '2', CHECK_TIME));
    records.push(record('25,1', CHECKER, 'S', '1'), record('25,2', FIRST, 'F', '2', CHECK_TIME));
    records.push(record('26,1', REVIEWER, 'F', '1'), record('26,2', FIRST, 'F', '2', CHECK_TIME));
    const res = await batchRequest(ctx.app, projectId, token, records);
    expect(res.statusCode, res.body).toBe(200);
  };

  const note = async (body: Record<string, unknown>) => {
    const res = await ctx.app.inject({ method: 'POST', url: url('/quality/notes'), headers: bearer(users[COORDINATOR].token), payload: body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };

  const setUp = async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Quality');
    pid = project.projectId;
    const put = await ctx.app.inject({ method: 'PUT', url: url('/cep'), headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    expect(put.json().round.state).toBe('added');
    const csv = ['id,lat,lon', ...Array.from({ length: 30 }, (_, i) => `${i + 1},0,0`)].join('\n');
    const up = await ctx.app.inject({ method: 'PUT', url: url('/csv-files/plots.csv'), headers: { ...bearer(project.adminToken), 'content-type': 'text/csv' }, payload: csv });
    expect(up.statusCode, up.body).toBe(201);
    fileId = up.json().id;
    users = {};
    for (const [name, role] of [[FIRST, 'operator'], [CHECKER, 'operator'], [REVIEWER, 'reviewer'], [COORDINATOR, 'admin'], [SECOND_CHECKER, 'operator']] as const) {
      users[name] = await registerUser(ctx.app, pid, project.adminToken, name, role);
    }
  };

  beforeEach(setUp);
  afterEach(async () => {
    await ctx.app.close();
  });

  const others = (body: string, self: string | null) => {
    for (const name of NAMES) {
      if (name !== self) {
        expect(body, `${name} appears`).not.toContain(name);
      }
    }
  };

  it('my-quality: the caller\'s own checks, mix-ups with their plots, and the notes that match, naming no one else', async () => {
    await collect();
    const general = await note({ questionKey: LAND_USE, text: 'Look at the canopy before choosing a land use.' });
    const fg = await note({ questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: 'Sparse trees on grass are grassland.' });
    await note({ questionKey: LAND_USE, firstValue: 'G', checkValue: 'F', text: 'The other way round.' });
    await note({ questionKey: FOREST, text: 'A number question.' });

    const res = await get('/my-quality', users[FIRST].token);
    expect(res.statusCode, res.body).toBe(200);
    others(res.body, FIRST);
    expect(res.body).not.toContain(String(CHECK_TIME));
    expect(res.body).not.toContain(new Date(CHECK_TIME).toISOString().slice(0, 16));
    expect(res.body).not.toMatch(/operator|recordKey|updatedBy|updatedAt|"[0-9]+,2"/);
    const body = res.json();
    expect(body).toMatchObject({ username: FIRST, minChecks: 20, stale: false });
    expect(typeof body.computedAt).toBe('number');
    // 24 checks by CHECKER + 2 by SECOND_CHECKER of FIRST's plots; 20-2 agree.
    expect(body.asFirst).toEqual({ checks: 26, agreeing: 18, rate: 18 / 26 });
    const stripped = (n: { id: string; questionKey: string; firstValue: string | null; checkValue: string | null; text: string }) => ({
      id: n.id,
      questionKey: n.questionKey,
      firstValue: n.firstValue,
      checkValue: n.checkValue,
      text: n.text,
    });
    expect(body.confusions).toEqual([
      { key: LAND_USE, label: 'Land Use 2025', first: 'F', check: 'G', checks: 6, plots: ['21', '22', '23', '24'], notes: [stripped(general), stripped(fg)] },
      { key: LAND_USE, label: 'Land Use 2025', first: 'F', check: 'C', checks: 2, plots: ['1', '2'], notes: [stripped(general)] },
    ]);
    expect(Object.keys(body).sort()).toEqual(['asFirst', 'computedAt', 'confusions', 'minChecks', 'options', 'stale', 'username']);
    // The answer options of the questions shown, from the survey, to show labels instead of codes.
    expect(body.options).toEqual({ [LAND_USE]: LAND_USE_OPTIONS });
  });

  it('notes are shown with question labels in place of question keys (a draft of the assistant could hold one)', async () => {
    await collect();
    const keyed = await note({ questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: `Before you answer ${LAND_USE}, compare ${FOREST} with the plot.` });
    const labelled = 'Before you answer Land Use 2025, compare Land cover - Percentage of Forest with the plot.';
    const mine = (await get('/my-quality', users[FIRST].token)).json();
    expect(mine.confusions[0].notes).toEqual([{ id: keyed.id, questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: labelled }]);
    const team = (await get('/quality/team-report', users[COORDINATOR].token)).json();
    expect(team.notes.map((n: { text: string }) => n.text)).toEqual([labelled]);
    expect(team.confusions[0].notes.map((n: { text: string }) => n.text)).toEqual([labelled]);
    expect(team.options).toEqual({ [LAND_USE]: LAND_USE_OPTIONS });
    // The Quality tab gets the note as written (it is edited there), and the options too.
    const quality = (await get('/quality', users[COORDINATOR].token)).json();
    expect(quality.notes.map((n: { text: string }) => n.text)).toEqual([keyed.text]);
    expect(quality.options).toEqual({ [LAND_USE]: LAND_USE_OPTIONS });
  });

  it('my-quality for a checker shows only their own first assessments, and for every member with a session', async () => {
    await collect();
    const checker = await get('/my-quality', users[CHECKER].token);
    expect(checker.statusCode, checker.body).toBe(200);
    others(checker.body, CHECKER);
    // One check of their own plot 25: too few to give a rate.
    expect(checker.json().asFirst).toEqual({ checks: 1, agreeing: 0, rate: null });
    expect(checker.json().confusions).toMatchObject([{ first: 'S', check: 'F', checks: 1, plots: ['25'] }]);

    const reviewer = await get('/my-quality', users[REVIEWER].token);
    expect(reviewer.statusCode, reviewer.body).toBe(200);
    others(reviewer.body, REVIEWER);
    expect(reviewer.json()).toMatchObject({ username: REVIEWER, asFirst: { checks: 1, agreeing: 1, rate: null }, confusions: [] });

    // Only checks made, nothing assessed first: zero, too few, nothing to show.
    const second = await get('/my-quality', users[SECOND_CHECKER].token);
    expect(second.statusCode, second.body).toBe(200);
    others(second.body, SECOND_CHECKER);
    expect(second.json()).toMatchObject({ asFirst: { checks: 0, agreeing: 0, rate: null }, confusions: [] });

    const coordinator = await get('/my-quality', users[COORDINATOR].token);
    expect(coordinator.statusCode, coordinator.body).toBe(200);
    others(coordinator.body, COORDINATOR);
  });

  it('my-quality needs a user session: a project token gets 403, no token 401, another project 404', async () => {
    await collect();
    expect((await get('/my-quality', project.projectToken)).statusCode).toBe(403);
    expect((await get('/my-quality', project.adminToken)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: url('/my-quality') })).statusCode).toBe(401);
    const other = await createProject(ctx.app, 'Other');
    expect((await get('/my-quality', users[FIRST].token, other.projectId)).statusCode).toBe(404);
  });

  it('my-quality does not show another project\'s records of the same name', async () => {
    const other = await createProject(ctx.app, 'Other');
    await ctx.app.inject({ method: 'PUT', url: url('/cep', other.projectId), headers: { ...bearer(other.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    await ctx.app.inject({
      method: 'PUT',
      url: url('/csv-files/plots.csv', other.projectId),
      headers: { ...bearer(other.adminToken), 'content-type': 'text/csv' },
      payload: 'id,lat,lon\n777,0,0\n',
    });
    const res = await batchRequest(ctx.app, other.projectId, other.projectToken, [record('777,1', FIRST, 'LAVA', '1'), record('777,2', CHECKER, 'ICE', '2')]);
    expect(res.statusCode, res.body).toBe(200);
    const mine = await get('/my-quality', users[FIRST].token);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.body).not.toMatch(/777|LAVA|ICE/);
    expect(mine.json().asFirst).toEqual({ checks: 0, agreeing: 0, rate: null });
  });

  it('team-report: the top confusions with a few plots, the notes and agreement by question, with no names', async () => {
    await collect();
    const fg = await note({ questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: 'Sparse trees on grass are grassland.' });
    const res = await get('/quality/team-report', users[COORDINATOR].token);
    expect(res.statusCode, res.body).toBe(200);
    others(res.body, null);
    expect(res.body).not.toMatch(/operator|recordKey|username|updatedBy|updatedAt/);
    const body = res.json();
    expect(body).toMatchObject({ minChecks: 20, plotsChecked: 26, plotsDiffering: 7, stale: false });
    expect(body.questions).toEqual([
      { key: FOREST, label: 'Land cover - Percentage of Forest', kind: 'number', checks: 28, agreeing: 28, rate: 1, margin: 10 },
      { key: LAND_USE, label: 'Land Use 2025', kind: 'choice', checks: 28, agreeing: 19, rate: 19 / 28 },
    ]);
    const shown = { id: fg.id, questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: fg.text };
    expect(body.confusions).toEqual([
      { key: LAND_USE, label: 'Land Use 2025', first: 'F', check: 'G', checks: 6, plots: ['21', '22', '23', '24'], notes: [shown] },
      { key: LAND_USE, label: 'Land Use 2025', first: 'F', check: 'C', checks: 2, plots: ['1', '2'], notes: [] },
      { key: LAND_USE, label: 'Land Use 2025', first: 'S', check: 'F', checks: 1, plots: ['25'], notes: [] },
    ]);
    expect(body.notes).toEqual([shown]);
    // The project's admin token works too.
    expect((await get('/quality/team-report', project.adminToken)).statusCode).toBe(200);
  });

  it('team-report keeps the top 10 confusions with up to 5 plots each', async () => {
    const records = [];
    for (let i = 1; i <= 30; i++) {
      // Plots 1-19 all F→G; 20-30 each a different mix-up.
      records.push(record(`${i},1`, FIRST, 'F', '1'), record(`${i},2`, CHECKER, i < 20 ? 'G' : `X${i}`, '2'));
    }
    await batchRequest(ctx.app, pid, project.projectToken, records);
    const body = (await get('/quality/team-report', users[COORDINATOR].token)).json();
    expect(body.confusions).toHaveLength(10);
    expect(body.confusions[0]).toMatchObject({ first: 'F', check: 'G', checks: 19, plots: ['1', '2', '3', '4', '5'] });
  });

  it('team-report is for coordinators: an operator or reviewer gets 403, another project 404', async () => {
    await collect();
    expect((await get('/quality/team-report', users[FIRST].token)).statusCode).toBe(403);
    expect((await get('/quality/team-report', users[REVIEWER].token)).statusCode).toBe(403);
    expect((await get('/quality/team-report', project.projectToken)).statusCode).toBe(403);
    const other = await createProject(ctx.app, 'Other');
    expect((await get('/quality/team-report', other.adminToken)).statusCode).toBe(404);
  });

  it('a collector cannot read the checks of plots of others by posting a first assessment of them', async () => {
    const alice = await registerUser(ctx.app, pid, project.adminToken, 'alice');
    const bob = await registerUser(ctx.app, pid, project.adminToken, 'bob');
    const carol = await registerUser(ctx.app, pid, project.adminToken, 'carol');
    // Alice assesses 1-5, Carol checks them (G on 1-3), each syncing with their own session.
    const aliceRecords = [];
    const carolRecords = [];
    for (let i = 1; i <= 5; i++) {
      aliceRecords.push(record(`${i},1`, 'alice', 'F', '1'));
      carolRecords.push(record(`${i},2`, 'carol', i <= 3 ? 'G' : 'F', '2', 5000));
    }
    expect((await batchRequest(ctx.app, pid, alice.token, aliceRecords)).statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, carol.token, carolRecords)).statusCode).toBe(200);
    // Bob posts a later first assessment of each of Alice's plots (once as himself, once naming carol).
    const probe = [];
    for (let i = 1; i <= 5; i++) probe.push(record(`${i},1`, 'bob', 'X', '1', 9000));
    probe.push(record('3,1', 'carol', 'Y', '1', 9000));
    expect((await batchRequest(ctx.app, pid, bob.token, probe)).statusCode).toBe(200);

    const mine = await get('/my-quality', bob.token);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json()).toMatchObject({ username: 'bob', asFirst: { checks: 0, agreeing: 0, rate: null }, confusions: [] });
    expect(mine.body).not.toMatch(/"G"|carol|alice/);
    // The records were all stored as bob's: none as carol's main assessment.
    const carolMain = (await ctx.store.listRecords(pid)).filter((r) => r.operator === 'carol' && r.recordKey.endsWith(',1'));
    expect(carolMain).toEqual([]);
    // Alice's plots now have two main assessments: hers are left out too, and the coordinator sees why.
    expect((await get('/my-quality', alice.token)).json()).toMatchObject({ asFirst: { checks: 0 }, confusions: [] });
    const quality = (await get('/quality', project.adminToken)).json();
    expect(quality.problems.filter((p: { kind: string }) => p.kind === 'two_main')).toHaveLength(10);
  });

  it('in a divided file, a first assessment of a plot someone else holds is left out of the personal report', async () => {
    const alice = await registerUser(ctx.app, pid, project.adminToken, 'alice');
    const bob = await registerUser(ctx.app, pid, project.adminToken, 'bob');
    const carol = await registerUser(ctx.app, pid, project.adminToken, 'carol');
    const divided = await ctx.app.inject({
      method: 'PUT',
      url: url(`/csv-files/${fileId}/distribution`),
      headers: bearer(project.adminToken),
      payload: { mode: 'even', people: [alice.userId], order: 'file', overlapPercent: 0 },
    });
    expect(divided.statusCode, divided.body).toBe(200);
    // Bob assesses Alice's plot 7 before her; Carol checks it.
    await batchRequest(ctx.app, pid, bob.token, [record('7,1', 'bob', 'X', '1', 9000)]);
    await batchRequest(ctx.app, pid, carol.token, [record('7,2', 'carol', 'G', '2', 9500)]);
    const mine = (await get('/my-quality', bob.token)).json();
    expect(mine).toMatchObject({ asFirst: { checks: 0, agreeing: 0, rate: null }, confusions: [] });
    // The coordinator still sees the pair.
    const quality = (await get('/quality', project.adminToken)).json();
    expect(quality.people.find((p: { username: string }) => p.username === 'bob').asFirst.compared).toBe(1);
  });
});
