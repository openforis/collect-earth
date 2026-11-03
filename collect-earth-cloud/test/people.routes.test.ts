import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const DAY = 86_400_000;

describe('GET /people, /people/:userId and /my-work', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let jose: { token: string; userId: string };
  let rita: { token: string; userId: string };
  let csvId: string;

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, password: 'password12', inviteToken: invite.json().inviteToken },
    });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'People' } })).json().projectId;
    maria = await join('maria', 'operator');
    jose = await join('jose', 'operator');
    rita = await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    csvId = (await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n', { 'content-type': 'text/csv' })).json().id;
    const more = (await call('PUT', '/csv-files/more.csv', owner.token, 'id,lat,lon\n5,0,0\n6,0,0\n', { 'content-type': 'text/csv' })).json().id;
    await call('PUT', '/assignments', owner.token, {
      assignments: [
        { userId: maria.userId, csvFileId: csvId },
        { userId: jose.userId, csvFileId: more },
      ],
    });
    const now = Date.now();
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: now - 2 * DAY, activelySaved: true }),
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: now - 2 * DAY + 20_000, activelySaved: true }),
      envelope({ recordKey: '3', operator: 'maria', modifiedOn: now, activelySaved: false }),
    ]);
    // An invitation link nobody used yet.
    await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 5 });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("a coordinator gets one row per person, agreeing with the Progress tab's totals, the open links and the week", async () => {
    const res = await call('GET', '/people?tz=Europe/Rome', owner.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timeZone).toBe('Europe/Rome');
    expect(body.quietDays).toBe(3);
    expect(body.people.map((p: { username: string }) => p.username).sort()).toEqual(['jose', 'maria', 'owner', 'rita']);
    const row = (name: string) => body.people.find((p: { username: string }) => p.username === name);
    expect(row('maria').plots).toEqual({ assigned: 4, submitted: 2, started: 1, remaining: 2, done: 0.5 });
    expect(row('maria').status).toEqual({ kind: 'working' });
    expect(row('maria').lastSyncAt).not.toBeNull();
    expect(row('maria').agreement).toBeNull();
    // jose holds plots but never downloaded them nor synced.
    expect(row('jose').status).toEqual({ kind: 'neverStarted' });
    expect(row('owner').status).toEqual({ kind: 'noPlots' });
    const progress = (await call('GET', '/progress', owner.token)).json();
    const submitted = body.people.reduce((s: number, p: { plots: { submitted: number } }) => s + p.plots.submitted, 0);
    expect(submitted).toBe(progress.totals.submitted);
    // Only the unused link is open (the members' links were for one person each).
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({ role: 'operator', usedCount: 0, maxUses: 5 });
    expect(body.week.days).toHaveLength(7);
    expect(body.week.mostActive).toEqual([{ userId: maria.userId, username: 'maria', submitted: 2 }]);
    expect(body.week.leastActive.map((p: { username: string }) => p.username)).toEqual(['jose']);
    expect(body.quality).toEqual({ available: false, computedAt: null, stale: false });
  });

  it('reviewers and collectors get 403 on /people and /people/:userId', async () => {
    for (const token of [rita.token, maria.token]) {
      expect((await call('GET', '/people', token)).statusCode).toBe(403);
      expect((await call('GET', `/people/${maria.userId}`, token)).statusCode).toBe(403);
      expect((await call('GET', `/people/${jose.userId}`, token)).statusCode).toBe(403);
    }
  });

  it("a person's page: calendar, hours, files and plots, speed, sync health and quality; 404 for someone not in the project", async () => {
    const res = await call('GET', `/people/${maria.userId}?tz=UTC`, owner.token);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.person.username).toBe('maria');
    expect(d.calendar.reduce((s: number, c: { plots: number }) => s + c.plots, 0)).toBe(2);
    expect(d.hours).toHaveLength(24);
    expect(d.hours.reduce((s: number, h: number) => s + h, 0)).toBe(2);
    expect(d.files).toHaveLength(1);
    expect(d.files[0]).toMatchObject({ csvFileId: csvId, filename: 'plots.csv', divided: false, plots: { total: 4, submitted: 2, started: 1, notStarted: 1, doneByOther: 0 } });
    expect(d.speed).toMatchObject({ submissions: 2, sessions: 1, gaps: 1, medianGapMs: 20_000, veryFast: 0 });
    expect(d.sync.lastSyncAt).not.toBeNull();
    expect(d.sync.syncsCount).toBeGreaterThan(0);
    expect(d.quality).toMatchObject({ available: false, asFirst: null, asChecker: null, sentBack: [] });
    expect((await call('GET', '/people/00000000-0000-4000-8000-000000000000', owner.token)).statusCode).toBe(404);
  });

  it('the quality figures are only glanced at: never computed for these pages', async () => {
    const LAND_USE = 'collect_code_land_use_category';
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '4,1', operator: 'maria', summary: { [LAND_USE]: 'F' } })]);
    await batchRequest(ctx.app, pid, rita.token, [envelope({ recordKey: '4,2', operator: 'rita', summary: { [LAND_USE]: 'G' } })]);
    expect((await call('GET', '/people', owner.token)).json().quality.available).toBe(false);
    expect((await call('GET', `/people/${maria.userId}`, owner.token)).json().quality.available).toBe(false);
    expect((await call('GET', '/my-work', maria.token)).json().quality.available).toBe(false);
    expect((await call('GET', '/quality', owner.token)).statusCode).toBe(200);
    const body = (await call('GET', '/people', owner.token)).json();
    expect(body.quality.available).toBe(true);
    expect(body.people.find((p: { username: string }) => p.username === 'maria').agreement).toMatchObject({ compared: 1, agreeing: 0 });
  });

  it("My work: any member's own page, never anyone else's", async () => {
    const mine = await call('GET', '/my-work?tz=UTC', maria.token);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().person.username).toBe('maria');
    expect(mine.json().person.plots.submitted).toBe(2);
    expect('asChecker' in mine.json().quality).toBe(false);
    // The route takes no one else: a userId in the query or the path changes nothing.
    const other = await call('GET', `/my-work?userId=${jose.userId}`, maria.token);
    expect(other.json().person.username).toBe('maria');
    expect((await call('GET', `/my-work/${jose.userId}`, maria.token)).statusCode).toBe(404);
    expect((await call('GET', '/my-work', jose.token)).json().person.username).toBe('jose');
    expect((await call('GET', '/my-work', rita.token)).json().person).toMatchObject({ username: 'rita', status: { kind: 'noPlots' } });
    expect((await call('GET', '/my-work', owner.token)).json().person.username).toBe('owner');
  });

  it("My work of a collector holding quality-check copies never tells which plots are checks", async () => {
    // A divided file: jose holds 7 and 8, maria holds 7 as a copy and checked it.
    const div = (await call('PUT', '/csv-files/div.csv', owner.token, ['id,lat,lon', '7,0,0', '8,0,0', ''].join('\n'), { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setDivision(pid, div, { mode: 'manual' }, [
      { plotKey: '7', userId: jose.userId, overlap: false },
      { plotKey: '8', userId: jose.userId, overlap: false },
      { plotKey: '7', userId: maria.userId, overlap: true },
    ]);
    await batchRequest(ctx.app, pid, jose.token, [envelope({ recordKey: '7', operator: 'jose', modifiedOn: Date.now() - 1000, activelySaved: true })]);
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '7', operator: 'maria', modifiedOn: Date.now(), activelySaved: true })]);
    const mine = await call('GET', '/my-work?tz=UTC', maria.token);
    expect(mine.statusCode).toBe(200);
    expect(mine.body).not.toMatch(/check|cop(y|ies)|overlap|"kind":"main"/i);
    const body = mine.json();
    // 4 plots of plots.csv and the copy of 7, counted as a plot: 3 submitted (1, 2 and 7).
    expect(body.person.plots).toMatchObject({ assigned: 5, submitted: 3 });
    expect(body.files.find((f: { filename: string }) => f.filename === 'div.csv').list).toEqual([{ plot: '7', status: 'submitted' }]);
    // The coordinator sees it as a check.
    const theirs = (await call('GET', `/people/${maria.userId}`, owner.token)).json();
    expect(theirs.person.checks).toEqual({ assigned: 1, submitted: 1, remaining: 0 });
    expect(theirs.person.plots.submitted).toBe(2);
  });

  it('a link for someone already in the project: a collector link for one person, a week, labelled with their name', async () => {
    const res = await call('POST', '/invites', owner.token, { role: 'admin', maxUses: 50, forUserId: rita.userId });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ role: 'operator', maxUses: 1 });
    expect(res.json().expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const entry = (await ctx.store.listAudit(pid, { limit: 1, action: 'invite.created' }))[0];
    expect(entry.details).toMatchObject({ role: 'operator', maxUses: 1, forUserId: rita.userId });
    const invites = (await call('GET', '/people', owner.token)).json().invites;
    expect(invites.map((i: { forUsername: string | null }) => i.forUsername).sort()).toEqual([null, 'rita']);
    expect((await call('POST', '/invites', owner.token, { forUserId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400);
    expect((await call('POST', '/invites', owner.token, { forUserId: 5 })).statusCode).toBe(400);
  });

  it('asked again within 5 s, My work gives its last answer; a person page says what removing them leaves', async () => {
    const first = (await call('GET', '/my-work', maria.token)).json();
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '4', operator: 'maria', modifiedOn: Date.now(), activelySaved: true })]);
    expect((await call('GET', '/my-work', maria.token)).json()).toEqual(first);
    const page = (await call('GET', `/people/${maria.userId}`, owner.token)).json();
    expect(page.person.plots.submitted).toBe(3);
    expect(page.removal).toEqual({ plots: 1, copies: 0 });
    expect(page.asOf).toBeNull();
  });

  it('My work needs someone signed in and a member', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/my-work` })).statusCode).toBe(401);
    const other = await setupOtherProjectMember();
    expect((await call('GET', '/my-work', other)).statusCode).toBe(404);
  });

  async function setupOtherProjectMember(): Promise<string> {
    const otherPid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Other' } })).json().projectId;
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${otherPid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ines', password: 'password12', inviteToken: invite.json().inviteToken } });
    return res.json().token as string;
  }
});
