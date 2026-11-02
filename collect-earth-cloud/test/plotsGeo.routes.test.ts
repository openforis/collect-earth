import { strFromU8, strToU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cepWith, idOnlyCep } from './fixtures/cep.js';
import { GEO_PAGE_SIZE, GEO_STATUSES } from '../src/plotsGeo.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const S = Object.fromEntries(GEO_STATUSES.map((s, i) => [s, i])) as Record<(typeof GEO_STATUSES)[number], number>;

interface GeoBody {
  version: string;
  offset: number;
  total: number;
  next: number | null;
  points: [number, number, number, number][];
  plots: string[];
  names: string[] | null;
  statuses: string[];
  counts: number[];
  notOnMap: number;
  files: { id: string; filename: string; plots: number; onMap: number }[];
  people: string[] | null;
  holders: string[][] | null;
  figures: { computedAt: number; stale: boolean } | null;
  asOf: number | null;
  unsupportedSrs?: string;
}

describe('map of progress: GET /map/plots', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  let rita: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let ben: { token: string; userId: string };
  let plotsFile: string;
  let southFile: string;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const geo = async (query: string, token = owner.token): Promise<GeoBody> => {
    const res = await call('GET', `/map/plots${query}`, token);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string, userId: (await ctx.store.getUserByUsername(username))!.id };
  };
  const t0 = Date.UTC(2026, 9, 1, 9);
  const main = (plot: number, operator: string, landUse = 'F', extra = {}) =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: t0 + plot * 1000, summary: { [LAND_USE]: landUse, collect_code_round: '1' }, ...extra });
  const check = (plot: number, operator: string, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: t0 + 5_000_000, summary: { [LAND_USE]: landUse, collect_code_round: '2' } });
  const figures = async () => {
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', '/quality', owner.token);
      expect(res.statusCode, res.body).toBe(200);
      if (!res.json().stale) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };
  const statusOf = (body: GeoBody, plot: string) => body.points[body.plots.indexOf(plot)]?.[2];

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Map');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    ben = await join('ben', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    // 120 plots, plot 120 without numeric coordinates.
    const rows = Array.from({ length: 120 }, (_, i) => `${i + 1},${i === 119 ? 'north' : -10 - i / 10},${20 + i / 10}`);
    plotsFile = (await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...rows].join('\n'), { 'content-type': 'text/csv' })).json().id;
    // Plot 1 again (placed elsewhere here) and plot 200: a divided file, ben holds 200 and a copy of 1.
    southFile = (await call('PUT', '/csv-files/south.csv', owner.token, 'id,lat,lon\n1,5,6\n200,7,8', { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setAssignments(pid, [{ userId: maria.userId, csvFileId: plotsFile }]);
    await ctx.store.setDivision(pid, southFile, { mode: 'manual' }, [
      { plotKey: '200', userId: ben.userId, overlap: false },
      { plotKey: '1', userId: ben.userId, overlap: true },
    ]);
    const res = await batchRequest(ctx.app, pid, projectToken, [
      main(1, 'maria'),
      check(1, 'ben', 'G'),
      main(2, 'maria'),
      main(3, 'maria'),
      main(4, 'maria'),
      main(10, 'maria', 'F', { activelySaved: false }),
      main(200, 'ben'),
    ]);
    expect(res.statusCode, res.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('gives every placed plot with its status and holders; decisions always, disagreements from the figures at hand', async () => {
    let body = await geo('');
    expect(body.statuses).toEqual([...GEO_STATUSES]);
    expect(body.total).toBe(120);
    expect(body.offset).toBe(0);
    expect(body.next).toBeNull();
    expect(body.plots.slice(0, 3)).toEqual(['1', '2', '3']);
    // Plot 1 takes its place from the first file listed.
    expect(body.points[0]).toEqual([-10, 20, S.submitted, 0]);
    expect(body.plots).toContain('200');
    expect(body.plots).not.toContain('120');
    expect(statusOf(body, '10')).toBe(S.started);
    expect(statusOf(body, '11')).toBe(S.notStarted);
    // No figures at hand: no disagreement yet, and the answer says so.
    expect(body.figures).toBeNull();
    expect(body.counts).toEqual([115, 1, 5, 0, 0, 0, 0]);
    expect(body.names).toBeNull();
    expect(body.notOnMap).toBe(1);
    expect(body.files).toEqual([
      { id: plotsFile, filename: 'plots.csv', plots: 120, onMap: 119 },
      { id: southFile, filename: 'south.csv', plots: 2, onMap: 2 },
    ]);
    expect(body.people).toEqual(['ben', 'maria']);
    expect(body.holders).toEqual([['maria'], ['ben']]);
    expect(body.points[body.plots.indexOf('200')][3]).toBe(1);

    await figures();
    body = await geo('');
    expect(body.figures).toMatchObject({ stale: false });
    expect(statusOf(body, '1')).toBe(S.differs);
    // Decisions: plot 1 both need another look, plot 2 the first is right.
    expect((await call('PUT', '/quality/decisions/1', owner.token, { decision: 'recheck' })).statusCode).toBe(200);
    expect((await call('PUT', '/quality/decisions/2', owner.token, { decision: 'first' })).statusCode).toBe(200);
    body = await geo('');
    expect(statusOf(body, '1')).toBe(S.recheck);
    expect(statusOf(body, '2')).toBe(S.accepted);
    expect(body.counts).toEqual([115, 1, 3, 1, 1, 0, 0]);

    // Plot 1 submitted again after "both need another look" (the review queue's rule, from the figures).
    const again = await batchRequest(ctx.app, pid, projectToken, [main(1, 'maria', 'C', { modifiedOn: Date.now() + 1000 })]);
    expect(again.statusCode, again.body).toBe(200);
    await figures();
    body = await geo('');
    expect(statusOf(body, '1')).toBe(S.resubmitted);
    expect(body.counts).toEqual([115, 1, 3, 1, 0, 0, 1]);
  });

  it('pages: each plot once across the pages, with the same version, at most GEO_PAGE_SIZE a page', async () => {
    const seen: string[] = [];
    const versions = new Set<string>();
    let offset: number | null = 0;
    let pages = 0;
    let version = '';
    while (offset !== null) {
      // Pages after the first name the map they belong to.
      const body = await geo(`?size=50&offset=${offset}${version ? `&version=${version}` : ''}`);
      version = body.version;
      expect(body.offset).toBe(offset);
      expect(body.points).toHaveLength(body.plots.length);
      seen.push(...body.plots);
      versions.add(body.version);
      offset = body.next;
      pages += 1;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(versions.size).toBe(1);
    // Past the end: an empty page.
    expect((await geo('?offset=500')).points).toEqual([]);
    // A larger size is held at GEO_PAGE_SIZE.
    expect((await geo(`?size=${GEO_PAGE_SIZE * 2}`)).total).toBe(120);
    for (const bad of ['?offset=-1', '?offset=1.5', '?offset=x', '?size=0', '?size=x', `?file=${'x'.repeat(1001)}`, '?file=nope']) {
      expect((await call('GET', `/map/plots${bad}`, owner.token)).statusCode, bad).toBe(400);
    }
  });

  it('serves pages 2..n from one build: decisions made meanwhile do not change them, an unknown or expired map is a 409', async () => {
    let reads = 0;
    const getCsvFile = ctx.store.getCsvFile.bind(ctx.store);
    ctx.store.getCsvFile = async (...args) => {
      reads += 1;
      return getCsvFile(...args);
    };
    const first = await geo('?size=50');
    const afterFirst = reads;
    expect((await call('PUT', '/quality/decisions/60', owner.token, { decision: 'first' })).statusCode).toBe(200);
    const second = await geo(`?size=50&offset=50&version=${first.version}`);
    // The same build: the counts of the first page, no plot file read again.
    expect(second.counts).toEqual(first.counts);
    expect(second.version).toBe(first.version);
    expect(reads).toBe(afterFirst);
    // A new map (offset 0, no version) is built again, its places kept while the files stay the same.
    const fresh = await geo('?size=50');
    expect(fresh.version).not.toBe(first.version);
    expect(reads).toBe(afterFirst);
    // A map this server does not have (expired, another instance): 409, read it again from the start.
    const gone = await call('GET', '/map/plots?offset=50&version=nope', owner.token);
    expect(gone.statusCode).toBe(409);
    expect(gone.json()).toMatchObject({ error: 'map_changed' });
    // Another person's or another filter's map is not this one.
    expect((await call('GET', `/map/plots?offset=50&version=${first.version}&person=ben`, owner.token)).statusCode).toBe(409);
    expect((await call('GET', `/map/plots?offset=50&version=${first.version}`, rita.token)).statusCode).toBe(409);
  });

  it("reads many plot files at once and keeps each project's places apart", async () => {
    for (let f = 0; f < 12; f++) {
      const rows = Array.from({ length: 30 }, (_, i) => `F${f}-${i},${f},${i / 10}`);
      expect((await call('PUT', `/csv-files/f${f}.csv`, owner.token, ['id,lat,lon', ...rows].join('\n'), { 'content-type': 'text/csv' })).statusCode).toBe(201);
    }
    const body = await geo('');
    expect(body.files).toHaveLength(14);
    // 119 placed plots of plots.csv, 200 of south.csv, 30 in each new file.
    expect(body.total).toBe(119 + 1 + 12 * 30);
    let reads = 0;
    const getCsvFile = ctx.store.getCsvFile.bind(ctx.store);
    ctx.store.getCsvFile = async (...args) => {
      reads += 1;
      return getCsvFile(...args);
    };
    // Another project's map does not push this one's places out.
    const other = await createProject(ctx.app, 'Other');
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${other.projectId}/csv-files/o.csv`, headers: { ...bearer(other.adminToken), 'content-type': 'text/csv' }, payload: 'id,lat,lon\n1,1,1' });
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other.projectId}/map/plots`, headers: bearer(other.adminToken) })).json().total).toBe(1);
    reads = 0;
    expect((await geo('')).total).toBe(body.total);
    expect(reads).toBe(0);
  });

  it('filters by plot file and by person; the version changes with the filters', async () => {
    const south = await geo(`?file=${southFile}`);
    expect(south.plots).toEqual(['1', '200']);
    // Plot 1 placed by the file asked for.
    expect(south.points[0].slice(0, 2)).toEqual([5, 6]);
    expect(south.version).not.toBe((await geo('')).version);
    expect((await geo('?person=ben')).plots).toEqual(['200']);
    const mariaPlots = await geo('?person=maria');
    expect(mariaPlots.total).toBe(119);
    expect((await geo(`?person=maria&file=${southFile}`)).plots).toEqual(['1']);
    expect((await geo('?person=nobody')).plots).toEqual([]);
  });

  it('reviewers see the map without who holds the plots; collectors and project tokens get 403; other projects 404', async () => {
    const body = await geo('', rita.token);
    expect(body.total).toBe(120);
    expect(body.people).toBeNull();
    expect(body.holders).toBeNull();
    expect(body.points.every((p) => p[3] === -1)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/maria|ben/);
    // The person filter is the coordinators'.
    expect((await call('GET', '/map/plots?person=maria', rita.token)).statusCode).toBe(403);
    expect((await call('GET', '/map/plots', maria.token)).statusCode).toBe(403);
    expect((await call('GET', '/map/plots', projectToken)).statusCode).toBe(403);
    const other = await createProject(ctx.app, 'Other');
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other.projectId}/map/plots`, headers: bearer(owner.token) })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/map/plots`, headers: bearer(other.adminToken) })).statusCode).toBe(404);
  });

  it('puts no plot on the map when the survey uses another coordinate system, and says which', async () => {
    const files = unzipSync(idOnlyCep());
    files['placemark.idm.xml'] = strToU8(strFromU8(files['placemark.idm.xml']).replace('<spatialReferenceSystem srid="EPSG:4326">', '<spatialReferenceSystem srid="EPSG:32633">'));
    const put = await call('PUT', '/cep', owner.token, cepWith(Object.entries(files).map(([path, data]): [string, Buffer] => [path, Buffer.from(data)])), { 'content-type': 'application/zip' });
    expect(put.statusCode, put.body).toBe(200);
    const body = await geo('');
    expect(body.unsupportedSrs).toBe('EPSG:32633');
    expect(body.points).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.notOnMap).toBe(121);
    expect(body.counts.reduce((a, b) => a + b, 0)).toBe(121);
    expect(body.files.map((f) => f.onMap)).toEqual([0, 0]);
  });
});
