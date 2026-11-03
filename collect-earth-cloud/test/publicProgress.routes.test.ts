import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { buildServer } from '../src/server.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

describe('Progress links for funders (Task 18)', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let ben: { token: string; userId: string };
  let rita: { token: string; userId: string };

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };
  const view = (token: string, query = '') => ctx.app.inject({ method: 'GET', url: `/v1/public/progress/${token}${query}` });
  const create = async (label = 'For the donor') => {
    const res = await call('POST', '/share-links', owner.token, { label });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { token: string; path: string; url: string; link: { id: string; label: string; createdAt: number; lastUsedAt: number | null } };
  };
  const t0 = Date.now() - 3 * 86_400_000;
  const at = (minutes: number) => t0 + minutes * 60_000;
  const main = (plot: number, operator: string, minutes: number, landUse = 'F', submitted = true) =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: at(minutes), activelySaved: submitted, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '1', comment: 'secret answer text' } });
  const check = (plot: number, operator: string, minutes: number, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: at(minutes), summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '2' } });
  const figures = async () => {
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', '/quality', owner.token);
      expect(res.statusCode, res.body).toBe(200);
      if (!res.json().stale) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };

  beforeEach(async ({ task }) => {
    ctx = await makeContext(task.name.includes('[limited]') ? { rateLimitPerMinute: 3 } : {});
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Forest inventory 2026' } })).json().projectId;
    maria = await join('maria', 'operator');
    ben = await join('ben', 'operator');
    rita = await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = await call('PUT', '/csv-files/plots-north.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 10 }, (_, i) => `${i + 101},12.3456,-3.2109`)].join('\n'), {
      'content-type': 'text/csv',
    });
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csv.json().id }, { userId: ben.userId, csvFileId: csv.json().id }] });
    expect((await batchRequest(ctx.app, pid, maria.token, [main(101, 'maria', 0), main(102, 'maria', 10, 'F', false), main(103, 'maria', 24 * 60)])).statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, ben.token, [check(101, 'ben', 30, 'C'), main(104, 'ben', 2 * 24 * 60)])).statusCode).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('a coordinator creates a link (the token shown once), lists it and the page shows the progress without names, answers or plot ids', async () => {
    const made = await create();
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made.path).toBe(`/p/${made.token}`);
    expect(made.url.endsWith(made.path)).toBe(true);
    expect(made.link).toMatchObject({ label: 'For the donor', lastUsedAt: null });
    const listed = (await call('GET', '/share-links', owner.token)).json();
    expect(listed.links).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(made.token);
    expect(listed.links[0]).toMatchObject({ id: made.link.id, label: 'For the donor', createdBy: 'owner', lastUsedAt: null });

    const res = await view(made.token, '?tz=Europe/Rome');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    const body = res.json();
    expect(body.project).toEqual({ name: 'Forest inventory 2026' });
    expect(body.timeZone).toBe('Europe/Rome');
    // The same numbers as the Progress tab.
    const progress = (await call('GET', '/progress?tz=Europe/Rome', owner.token)).json();
    expect(body.totals).toEqual(progress.totals);
    expect(body.daily).toEqual(progress.daily);
    expect(body.forecast).toEqual(progress.forecast);
    expect(body.totals).toMatchObject({ plots: 10, submitted: 3, started: 1 });
    // Nobody opened the Quality tab: not available, and this page did not work the figures out.
    expect(body.quality).toEqual({ available: false, agreement: null, computedAt: null });
    expect(Object.keys(body).sort()).toEqual(['asOf', 'daily', 'forecast', 'project', 'quality', 'timeZone', 'today', 'totals']);

    const text = res.body;
    for (const secret of ['maria', 'ben', 'rita', 'owner', 'secret answer', LAND_USE, FOREST, 'plots-north', '12.3456', '-3.2109', pid, owner.userId, maria.userId, '"101', '101,', 'attention', 'username', 'settings']) {
      expect(text, secret).not.toContain(secret);
    }
    // Used: the list says when.
    expect((await call('GET', '/share-links', owner.token)).json().links[0].lastUsedAt).toEqual(expect.any(Number));
  });

  it('quality agreement as one figure: stored when the figures are worked out, read from the store across a restart, never computed for the link', async () => {
    const made = await create();
    expect((await view(made.token)).json().quality).toEqual({ available: false, agreement: null, computedAt: null });
    // The link never works the figures out.
    expect(await ctx.store.getPublicQuality(pid)).toBeNull();
    await figures();
    const stored = await ctx.store.getPublicQuality(pid);
    expect(stored).toEqual({ compared: 1, agreeing: 0, rate: null, computedAt: expect.any(Number) });
    const q = (await view(made.token)).json().quality;
    expect(q).toEqual({ available: true, agreement: { compared: 1, agreeing: 0, rate: null }, computedAt: stored!.computedAt });
    // A restart (or another instance): a new server on the same store has no figures in memory, and the link still has its figure.
    const again = await buildServer({ store: ctx.store, config: { port: 0, host: '127.0.0.1', storeBackend: 'memory', rateLimitPerMinute: 0, qualityMinIntervalMs: 0, stateStaleMs: 0 }, webDir: null });
    try {
      const res = await again.inject({ method: 'GET', url: `/v1/public/progress/${made.token}` });
      expect(res.json().quality).toEqual(q);
      // Nothing was worked out there: its weekly summary has no figures at hand.
      const weekly = await again.inject({ method: 'GET', url: `/v1/projects/${pid}/weekly`, headers: bearer(owner.token) });
      expect(weekly.json().quality.available).toBe(false);
    } finally {
      await again.close();
    }
  });

  it('the stored figure only moves forward in time', async () => {
    await ctx.store.setPublicQuality(pid, { compared: 30, agreeing: 27, rate: 0.9, computedAt: 2000 });
    await ctx.store.setPublicQuality(pid, { compared: 10, agreeing: 1, rate: null, computedAt: 1000 });
    expect(await ctx.store.getPublicQuality(pid)).toEqual({ compared: 30, agreeing: 27, rate: 0.9, computedAt: 2000 });
  });

  it('at most 20 links, even made at once', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => call('POST', '/share-links', owner.token, { label: `l${i}` })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(20);
    expect(results.filter((r) => r.statusCode === 409).map((r) => r.json().error)).toEqual(Array(5).fill('too_many_links'));
    expect((await call('GET', '/share-links', owner.token)).json().links).toHaveLength(20);
  });

  it('a revoked link and an unknown one are both 404, with the same body and headers', async () => {
    const made = await create();
    const other = await create('For the ministry');
    expect((await view(made.token)).statusCode).toBe(200);
    expect((await call('DELETE', `/share-links/${made.link.id}`, owner.token)).statusCode).toBe(204);
    expect((await call('DELETE', `/share-links/${made.link.id}`, owner.token)).statusCode).toBe(404);
    const revoked = await view(made.token);
    const unknown = await view('A'.repeat(43));
    const malformed = await view('not-a-token');
    for (const res of [revoked, unknown, malformed]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    // The other link still works, and the list has it alone.
    expect((await view(other.token)).statusCode).toBe(200);
    expect((await call('GET', '/share-links', owner.token)).json().links.map((l: { label: string }) => l.label)).toEqual(['For the ministry']);
    const audited = await ctx.store.listAudit(pid, { limit: 10, actions: ['link.created', 'link.revoked'] });
    expect(audited.map((a) => [a.action, a.details])).toEqual([
      ['link.revoked', { linkId: made.link.id, label: 'For the donor' }],
      ['link.created', { linkId: other.link.id, label: 'For the ministry' }],
      ['link.created', { linkId: made.link.id, label: 'For the donor' }],
    ]);
  });

  it('the token is kept hashed: the store holds its sha256, never the token', async () => {
    const made = await create();
    const held = JSON.stringify([...((ctx.store as unknown as { shareLinks: Map<string, unknown> }).shareLinks.entries())]);
    expect(held).not.toContain(made.token);
    expect(held).toContain(createHash('sha256').update(made.token, 'utf8').digest('hex'));
  });

  it('coordinators only manage links; labels are checked', async () => {
    for (const who of [rita, maria]) {
      expect((await call('POST', '/share-links', who.token, { label: 'x' })).statusCode).toBe(403);
      expect((await call('GET', '/share-links', who.token)).statusCode).toBe(403);
    }
    const made = await create();
    expect((await call('DELETE', `/share-links/${made.link.id}`, rita.token)).statusCode).toBe(403);
    expect((await call('POST', '/share-links', owner.token, { label: 'x'.repeat(101) })).statusCode).toBe(400);
    expect((await call('POST', '/share-links', owner.token, { label: 'a\u0000b' })).statusCode).toBe(400);
    expect((await call('POST', '/share-links', owner.token, { label: 7 })).statusCode).toBe(400);
    // No label is fine.
    expect((await call('POST', '/share-links', owner.token, {})).json().link.label).toBe('');
    expect((await call('DELETE', '/share-links/not-an-id', owner.token)).statusCode).toBe(404);
  });

  it('isolation: a link shows its own project only; another project cannot list or revoke it', async () => {
    const made = await create();
    const other = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Other project' } })).json().projectId as string;
    const otherLink = (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${other}/share-links`, headers: bearer(owner.token), payload: { label: 'B' } })).json();
    expect((await view(otherLink.token)).json().project.name).toBe('Other project');
    expect((await view(made.token)).json().project.name).toBe('Forest inventory 2026');
    // B's link through A's path: not found, and still working.
    expect((await call('DELETE', `/share-links/${otherLink.link.id}`, owner.token)).statusCode).toBe(404);
    expect((await view(otherLink.token)).statusCode).toBe(200);
    expect((await call('GET', '/share-links', owner.token)).json().links.map((l: { id: string }) => l.id)).toEqual([made.link.id]);
    // A collector of A is no member of the other: 404 there.
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other}/share-links`, headers: bearer(maria.token) })).statusCode).toBe(404);
    // A project deleted: its links go.
    expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/projects/${other}`, headers: bearer(owner.token), payload: { confirmName: 'Other project' } })).statusCode).toBe(204);
    expect((await view(otherLink.token)).statusCode).toBe(404);
  });

  it('rate-limited per client address [limited]', async () => {
    const made = await create();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await view(made.token)).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const refused = await view('A'.repeat(43));
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
