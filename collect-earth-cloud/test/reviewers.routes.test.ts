import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';

/**
 * Decision 10 (the final review's reviewer findings): reviewers do not learn which plots are
 * reference plots (map, flags, decisions), get no per-person figures, are not default checkers,
 * and a copy they hold is their own plot until their check is submitted. A decision on a plot
 * that is not there is a 404 (M-2).
 */
describe('reviewers (Decision 10) and decisions on plots that are not there (M-2)', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};
  let fileId: string;
  const at = Date.UTC(2026, 10, 2, 9);

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer' = 'operator') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };
  const send = async (operator: string, round: 1 | 2, plots: number[], landUse: (p: number) => string = () => 'F', activelySaved = true) => {
    const res = await batchRequest(
      ctx.app,
      pid,
      projectToken,
      plots.map((p) => envelope({ recordKey: `${p},${round}`, operator, modifiedOn: at + p, activelySaved, summary: { [LAND_USE]: landUse(p), collect_code_round: String(round) } })),
    );
    expect(res.statusCode, res.body).toBe(200);
  };
  /** A route's answer once the quality figures follow the records. */
  const settled = async (path: string, token: string, done: (body: Record<string, unknown>) => boolean = () => true) => {
    let last: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', path, token);
      expect(res.statusCode, res.body).toBe(200);
      last = res.json();
      if (!last.stale && done(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return last;
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Reviewers');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const n of ['maria', 'jose', 'ana']) await join(n);
    await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const rows = Array.from({ length: 12 }, (_, i) => `${i + 1};-10;${20 + i}`).join('\r\n');
    fileId = (await call('PUT', '/csv-files/north.csv', owner.token, `id;lat;lon\r\n${rows}\r\n`, { 'content-type': 'text/csv' })).json().id;
    // maria holds 1-6, jose 7-12.
    const put = await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.maria.userId, people.jose.userId], order: 'file' });
    expect(put.statusCode, put.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('I-1: a reviewer neither sees reference plots on the map nor among the flags; deciding one answers as a plot that is not there', async () => {
    expect((await call('POST', '/reference/plots', owner.token, { csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '2'] })).statusCode).toBe(200);
    // The reference assessments at one moment (very fast), and maria's plots 3-6.
    await send('owner', 1, [1, 2]);
    await send('maria', 1, [3, 4, 5, 6]);
    await send('ana', 2, [1, 2]);

    // The map: the coordinator's has 12 plots, the reviewer's 10, counts too.
    const mapOf = async (token: string) => {
      const res = await call('GET', '/map/plots', token);
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { plots: string[]; counts: number[]; notOnMap: number; files: { plots: number }[] };
    };
    const forOwner = await mapOf(owner.token);
    const forRita = await mapOf(people.rita.token);
    expect(sum(forOwner.counts)).toBe(12);
    expect(sum(forRita.counts)).toBe(10);
    expect(forRita.files[0].plots).toBe(10);
    expect(forRita.plots).not.toContain('1');
    expect(forRita.plots).not.toContain('2');
    if (forOwner.plots.length > 0) expect(forOwner.plots).toContain('1');

    // The flags: the coordinator's list the reference plots (very fast), the reviewer's never, nor count them.
    const ownerFlags = await settled('/quality/flags', owner.token, (b) => (b.flags as { plot: string }[]).some((f) => f.plot === '2'));
    expect((ownerFlags.flags as { plot: string }[]).some((f) => f.plot === '2')).toBe(true);
    const ritaFlags = await settled('/quality/flags', people.rita.token);
    expect((ritaFlags.flags as { plot: string }[]).some((f) => f.plot === '1' || f.plot === '2')).toBe(false);
    const ownerOwn = (ownerFlags.flags as { plot: string }[]).filter((f) => f.plot !== '1' && f.plot !== '2').length;
    expect(ritaFlags.total).toBe(ownerOwn);

    // Deciding: the coordinator is told it is a reference plot; the reviewer gets the answer of a plot that is not there.
    const ownerPut = await call('PUT', '/quality/decisions/1', owner.token, { decision: 'first' });
    expect(ownerPut.statusCode).toBe(409);
    expect(ownerPut.json().error).toBe('reference_plot');
    const ritaRef = await call('PUT', '/quality/decisions/1', people.rita.token, { decision: 'first' });
    const ritaNone = await call('PUT', '/quality/decisions/nowhere', people.rita.token, { decision: 'first' });
    expect(ritaRef.statusCode).toBe(404);
    expect(ritaRef.body).toBe(ritaNone.body);
    const ritaDelRef = await call('DELETE', '/quality/decisions/1', people.rita.token);
    const ritaDelNone = await call('DELETE', '/quality/decisions/nowhere', people.rita.token);
    expect(ritaDelRef.statusCode).toBe(404);
    expect(ritaDelRef.body).toBe(ritaDelNone.body);
  });

  it('I-1: a reviewer who is a reference plot\'s assessor is told it is their own plot first', async () => {
    expect((await call('POST', '/reference/plots', owner.token, { csvFileId: fileId, assessorUserId: people.rita.userId, plots: ['1'] })).statusCode).toBe(200);
    await send('rita', 1, [1]);
    await settled('/quality/flags', owner.token);
    const res = await call('PUT', '/quality/decisions/1', people.rita.token, { decision: 'first' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('own_plot');
  });

  it('M-2: a decision on a plot in no plot file and without records is a 404 for everyone; one with records only is decided', async () => {
    const none = await call('PUT', '/quality/decisions/999', owner.token, { decision: 'first' });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'not_found', reason: 'no plot file of this project has this plot' });
    expect((await ctx.store.listQualityDecisions(pid)).length).toBe(0);
    // A plot in a file, and a plot in no file with a record (the queue's "plot in no file").
    expect((await call('PUT', '/quality/decisions/3', owner.token, { decision: 'first' })).statusCode).toBe(200);
    await send('maria', 1, [500]);
    expect((await call('PUT', '/quality/decisions/500', owner.token, { decision: 'first' })).statusCode).toBe(200);
  });

  it('I-2: the default checkers are collectors only; a reviewer or coordinator chosen comes with a warning', async () => {
    const view = await call('PUT', '/sampling', owner.token, { firstN: 5 });
    expect(view.statusCode, view.body).toBe(200);
    const eligible = view.json().checkers.filter((c: { eligible: boolean }) => c.eligible).map((c: { username: string }) => c.username).sort();
    expect(eligible).toEqual(['ana', 'jose', 'maria']);
    expect(view.json().warning).toBeNull();
    const chosen = await call('PUT', '/sampling', owner.token, { firstN: 5, checkers: [people.ana.userId, people.rita.userId, owner.userId] });
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(chosen.json().warning).toEqual({ code: 'checkers_not_blind', usernames: ['owner', 'rita'] });
    expect((await call('GET', '/sampling', owner.token)).json().warning).toEqual({ code: 'checkers_not_blind', usernames: ['owner', 'rita'] });
  });

  it('I-2: a reviewer holding a copy not yet checked: no plot page, not in their queue, no decision; once checked the page opens', async () => {
    // rita holds a copy of maria's plot 3 (a check to make blind); maria and jose differ on 3? no: jose checks 4.
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, [
      ...(await ctx.store.listPlotAssignments(pid, fileId)),
      { plotKey: '3', userId: people.rita.userId, overlap: true },
      { plotKey: '4', userId: people.ana.userId, overlap: true },
    ]);
    await send('maria', 1, [3, 4]);
    await send('ana', 2, [4], () => 'G');
    // Plot 3 differs too, by a check of jose's made anyway (a record of his).
    await send('jose', 2, [3], () => 'G');
    const queue = await settled('/quality/queue', owner.token, (b) => (b.counts as { difference: number }).difference === 2);
    expect((queue.items as { plot: string }[]).map((i) => i.plot).sort()).toEqual(['3', '4']);

    expect((await call('GET', '/plots/3', people.rita.token)).statusCode).toBe(404);
    expect((await call('GET', '/plots/4', people.rita.token)).statusCode).toBe(200);
    const ritaQueue = await settled('/quality/queue', people.rita.token);
    expect((ritaQueue.items as { plot: string }[]).map((i) => i.plot)).toEqual(['4']);
    expect(ritaQueue.excludedOwn).toBe(1);
    const refused = await call('PUT', '/quality/decisions/3', people.rita.token, { decision: 'first' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('own_plot');

    // A draft is not a submitted check: still no page.
    await send('rita', 2, [3], () => 'F', false);
    expect((await call('GET', '/plots/3', people.rita.token)).statusCode).toBe(404);
    await send('rita', 2, [3], () => 'F', true);
    const page = await call('GET', '/plots/3', people.rita.token);
    expect(page.statusCode).toBe(200);
    expect(page.json().ownPlot).toBe(true);
  });

  it('I-3: a reviewer gets no flags per person and no answers per person (team figures stay)', async () => {
    await send('maria', 1, [1, 2, 3, 4, 5, 6], (p) => (p % 2 ? 'F' : 'G'));
    await send('jose', 1, [7, 8, 9, 10, 11, 12], () => 'G');
    const ownerFlags = await settled('/quality/flags', owner.token);
    expect((ownerFlags.people as unknown[]).length).toBeGreaterThan(0);
    const ritaFlags = await settled('/quality/flags', people.rita.token);
    expect(ritaFlags.people).toEqual([]);
    expect(ritaFlags.counts).toEqual(ownerFlags.counts);

    const ownerAnswers = await settled('/quality/answers', owner.token);
    const ritaAnswers = await settled('/quality/answers', people.rita.token);
    expect((ownerAnswers.people as unknown[]).length).toBe(2);
    expect(ritaAnswers.people).toEqual([]);
    expect(ritaAnswers.plots).toBe(ownerAnswers.plots);
    expect((ritaAnswers.filters as { people: string[] }).people).toEqual([]);
    expect(ritaAnswers.flags).toEqual([]);
    const choices = ritaAnswers.choices as { key: string; people: unknown[]; codes: unknown[] }[];
    expect(choices.length).toBeGreaterThan(0);
    for (const c of choices) {
      expect(c.people).toEqual([]);
      expect(c.codes).toEqual((ownerAnswers.choices as { key: string; codes: unknown[] }[]).find((o) => o.key === c.key)!.codes);
    }
    expect(JSON.stringify(ritaAnswers)).not.toMatch(/maria|jose/);
    expect((await call('GET', '/quality/answers?person=maria', people.rita.token)).statusCode).toBe(403);
    expect((await call('GET', '/quality/answers?person=maria', owner.token)).statusCode).toBe(200);
  });
});
