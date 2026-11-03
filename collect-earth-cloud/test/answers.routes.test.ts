import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

describe('GET /quality/answers and /quality/answers/columns', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let rita: { token: string };
  let maria: { token: string };
  let csvId: string;
  let otherId: string;

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Answers' } })).json().projectId;
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    // Plots 1-40 with a region column (north for 1-20, south for 21-40), and plots 41-50 in another file.
    const rows = Array.from({ length: 40 }, (_, i) => `${i + 1},0,0,${i < 20 ? 'north' : 'south'}`);
    csvId = (await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon,region', ...rows].join('\n'), { 'content-type': 'text/csv' })).json().id;
    otherId = (await call('PUT', '/csv-files/more.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 10 }, (_, i) => `${i + 41},0,0`)].join('\n'), { 'content-type': 'text/csv' })).json().id;
    const ana = await join('ana', 'operator');
    const ben = await join('ben', 'operator');
    const records: ReturnType<typeof envelope>[] = [];
    const day = (d: number) => Date.UTC(2026, 9, d, 12);
    // ana: plots 1-25, cropland (C) on all of them; ben: plots 26-50, forest (F) on all;
    // ben also checks plot 1 (round 2): never counted here.
    for (let i = 1; i <= 50; i++) {
      const byAna = i <= 25;
      records.push(
        envelope({
          recordKey: `${i},1`,
          operator: byAna ? 'ana' : 'ben',
          modifiedOn: day(i <= 10 ? 1 : 2),
          summary: { [LAND_USE]: byAna ? 'C' : 'F', [FOREST]: String(byAna ? 10 : 80), collect_code_round: '1' },
        }),
      );
    }
    records.push(envelope({ recordKey: '1,2', operator: 'ben', modifiedOn: day(3), summary: { [LAND_USE]: 'G', collect_code_round: '2' } }));
    for (const [who, token] of [['ana', ana.token], ['ben', ben.token]] as const) {
      const res = await batchRequest(ctx.app, pid, token, records.filter((r) => r.operator === who));
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('the team and each person, first assessments only, with the flags and the filters to choose from', async () => {
    const res = await call('GET', '/quality/answers', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.plots).toBe(50);
    expect(body.stale).toBe(false);
    expect(typeof body.computedAt).toBe('number');
    const land = body.choices.find((c: { key: string }) => c.key === LAND_USE);
    expect(Object.fromEntries(land.codes.map((c: { code: string; count: number }) => [c.code, c.count]))).toEqual({ F: 25, C: 25 });
    // The check's G is not there.
    expect(land.codes.some((c: { code: string }) => c.code === 'G')).toBe(false);
    // Two people: ben against the rest (ana) is the same difference, listed once.
    expect(body.flags.map((f: { username: string; code: string }) => `${f.username}:${f.code}`).sort()).toEqual(['ana:C', 'ana:F']);
    const forest = body.numbers.find((n: { key: string }) => n.key === FOREST);
    expect(forest.team).toMatchObject({ values: 50, median: 45 });
    expect(forest.people).toEqual([
      { username: 'ana', values: 25, nonNumeric: 0, median: 10, q1: 10, q3: 10 },
      { username: 'ben', values: 25, nonNumeric: 0, median: 80, q1: 80, q3: 80 },
    ]);
    expect(body.filters.people).toEqual(['ana', 'ben']);
    // The figures name only the people who made first assessments.
    expect(body.people.map((p: { username: string }) => p.username)).toEqual(['ana', 'ben']);
    expect(body.filters.files.map((f: { filename: string }) => f.filename).sort()).toEqual(['more.csv', 'plots.csv']);
  });

  it('filters by person, plot file, a column value and days', async () => {
    const person = (await call('GET', '/quality/answers?person=ana', owner.token)).json();
    expect(person.person).toBe('ana');
    expect(person.people).toEqual([{ username: 'ana', plots: 25 }]);
    expect(person.plots).toBe(50);
    expect(person.flags.every((f: { username: string }) => f.username === 'ana')).toBe(true);

    expect((await call('GET', `/quality/answers?file=${otherId}`, owner.token)).json().plots).toBe(10);
    const south = (await call('GET', `/quality/answers?file=${csvId}&column=3&value=south`, owner.token)).json();
    expect(south.plots).toBe(20);
    expect(south.people).toEqual([
      { username: 'ana', plots: 5 },
      { username: 'ben', plots: 15 },
    ]);
    expect((await call('GET', '/quality/answers?from=2026-10-02&to=2026-10-02&tz=Europe/Rome', owner.token)).json().plots).toBe(40);
    expect((await call('GET', '/quality/answers?to=2026-10-01', owner.token)).json().plots).toBe(10);
  });

  it('refuses filters that make no sense', async () => {
    // A column of over 200 values is not offered, nor taken (as for dividing a file).
    const many = (await call('PUT', '/csv-files/many.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 201 }, (_, i) => `${i + 101},${i},0`)].join('\n'), { 'content-type': 'text/csv' })).json().id;
    const columns = (await call('GET', `/quality/answers/columns?file=${many}`, owner.token)).json().columns;
    expect(columns.find((c: { index: number }) => c.index === 1).values).toBeNull();
    for (const q of [`file=${many}&column=1&value=5`, 'from=2026-10-05&to=2026-10-01', 'file=nope', `file=${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, `file=${csvId}&column=9&value=x`, `file=${csvId}&column=0&value=1`, 'column=3&value=x', `file=${csvId}&column=3`, 'from=2026-13-01', 'to=yesterday']) {
      const res = await call('GET', `/quality/answers?${q}`, owner.token);
      expect(res.statusCode, q).toBe(400);
    }
  });

  it('the columns of a plot file, with their values', async () => {
    const res = await call('GET', `/quality/answers/columns?file=${csvId}`, rita.token);
    expect(res.statusCode, res.body).toBe(200);
    const region = res.json().columns.find((c: { name: string }) => c.name === 'region');
    expect(region).toEqual({ index: 3, name: 'region', distinctCount: 2, values: [{ value: 'north', count: 20 }, { value: 'south', count: 20 }] });
    expect((await call('GET', `/quality/answers/columns?file=nope`, rita.token)).statusCode).toBe(404);
  });

  it("a reviewer's filter, dates included, must hold at least 5 plots of at least 2 people", async () => {
    // 1 October holds plots 1-10, all ana's: as many plots as needed, but one person's answers.
    const day1 = '/quality/answers?from=2026-10-01&to=2026-10-01';
    expect((await call('GET', day1, owner.token)).json().plots).toBe(10);
    const refused = await call('GET', day1, rita.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().reason).toMatch(/at least 5 plots of at least 2 people/);
    // A plot file of one person's plots is refused the same way; 2 October (ana and ben) is not.
    expect((await call('GET', `/quality/answers?file=${csvId}&column=3&value=north`, rita.token)).statusCode).toBe(403);
    const day2 = await call('GET', '/quality/answers?from=2026-10-02&to=2026-10-02', rita.token);
    expect(day2.statusCode).toBe(200);
    expect(day2.json().plots).toBe(40);
  });

  it('coordinators and reviewers see it; collectors do not', async () => {
    expect((await call('GET', '/quality/answers', rita.token)).statusCode).toBe(200);
    expect((await call('GET', '/quality/answers', maria.token)).statusCode).toBe(403);
    expect((await call('GET', `/quality/answers/columns?file=${csvId}`, maria.token)).statusCode).toBe(403);
  });

  it('nothing about answers reaches My work', async () => {
    const res = await call('GET', '/my-work', maria.token);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/"flags"|"choices"|"codes"/);
  });
});
