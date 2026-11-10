// The shapes of a CEO project copied into the project in steps (src/ceo/shapes.ts, src/routes/ceoShapes.ts), with CEO's
// get-plot-sample-geom stood in for: FRA-like hexagons (drawn with many vertices, as CEO gives them) and a square sample.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../src/ceo/answers.js';
import { shapeOf, simplifyRing, withShapes } from '../src/ceo/shapes.js';
import { hasPolygonColumn } from '../src/plotShape.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/ceo/', import.meta.url));

/** A hexagon around a centre, each edge drawn with `per` points (CEO's have 64 per edge). */
function hexagon(lon: number, lat: number, per = 64): [number, number][] {
  const corners = [0, 60, 120, 180, 240, 300].map((a) => [lon + 0.003 * Math.cos((a * Math.PI) / 180), lat + 0.003 * Math.sin((a * Math.PI) / 180)]);
  const ring: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const [a, b] = [corners[i], corners[(i + 1) % 6]];
    for (let k = 0; k < per; k++) ring.push([a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per]);
  }
  ring.push(ring[0]);
  return ring;
}
const square = (lon: number, lat: number): [number, number][] => [[lon - 0.0005, lat - 0.0005], [lon - 0.0005, lat + 0.0005], [lon + 0.0005, lat + 0.0005], [lon + 0.0005, lat - 0.0005], [lon - 0.0005, lat - 0.0005]];
const ceoAnswer = (lon: number, lat: number) => ({
  plotGeom: JSON.stringify({ type: 'MultiPolygon', coordinates: [[hexagon(lon, lat)]] }),
  sampleGeoms: [JSON.stringify({ type: 'MultiPolygon', coordinates: [[square(lon, lat)]] })],
});

describe('a CEO plot and its samples as one shape', () => {
  it("keeps a hexagon's six corners of the hundreds of vertices CEO gives", () => {
    const ring = hexagon(116.2, -31.7);
    expect(ring).toHaveLength(385);
    expect(simplifyRing(ring)).toHaveLength(7);
  });

  it('writes the plot, then its samples, as one MULTIPOLYGON; none for points only', () => {
    const wkt = shapeOf(ceoAnswer(116.2, -31.7))!;
    expect(wkt).toMatch(/^MULTIPOLYGON\(\(\(116\.203 -31\.7,.*\)\),\(\(116\.1995 -31\.7005,/);
    expect(wkt.match(/\(\(/g)).toHaveLength(2);
    expect(shapeOf({ plotGeom: '{"type":"Point","coordinates":[1,2]}', sampleGeoms: ['{"type":"Point","coordinates":[1,2]}'] })).toBeNull();
    expect(shapeOf('junk')).toBeNull();
  });

  it('adds the column to a plot file, a square for a plot without a shape, and leaves a file with polygons as it is', () => {
    const file = Buffer.from('id,YCoordinate,XCoordinate,elevation\n1,-31.7,116.2,0\n2,-31.8,116.3,0\n');
    const out = withShapes(file, 1, { '1': 'MULTIPOLYGON(((1 1,2 2,3 1,1 1)))' }, { kind: 'square', sideMeters: 100 })!.toString();
    const [header, one, two] = parseCsv(out);
    expect(header).toEqual(['id', 'YCoordinate', 'XCoordinate', 'elevation', 'plot_shape']);
    expect(one[4]).toBe('MULTIPOLYGON(((1 1,2 2,3 1,1 1)))');
    expect(two[4]).toMatch(/^MULTIPOLYGON\(\(\(116\.29\d+ -31\.79\d+,/);
    expect(withShapes(Buffer.from(out), 1, {}, { kind: 'square', sideMeters: 100 })).toBeNull();
    // Without a shape Collect Earth can draw for every plot, none: it tests the first plot for the whole file
    expect(withShapes(file, 1, { '1': 'MULTIPOLYGON(((1 1,2 2,3 1,1 1)))' }, { kind: 'place' })).toBeNull();
  });
});

describe('copying the shapes of a CEO project, step by step', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  const plots = JSON.parse(readFileSync(`${FIXTURES}project-54724-plots.json`, 'utf8')) as { plotId: number; id: number; center: string }[];
  const centre = new Map(plots.map((p) => [String(p.plotId), JSON.parse(p.center).coordinates as [number, number]]));

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await ctx.app.close();
  });

  it('reads every plot from CEO, carries on after CEO stops answering, then gives the plot files their shapes', async () => {
    const created = await ctx.app.inject({
      method: 'POST', url: '/v1/projects/from-ceo', headers: bearer(owner.token),
      payload: { ceoProject: readFileSync(`${FIXTURES}project-54724.json`, 'utf8'), ceoPlots: readFileSync(`${FIXTURES}project-54724-plots.json`, 'utf8') },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { projectId, plotFile, shapes } = created.json();
    expect(shapes).toEqual({ total: 33 });
    const url = `/v1/projects/${projectId}/ceo-shapes`;
    const get = async () => (await ctx.app.inject({ method: 'GET', url, headers: bearer(owner.token) })).json();
    const step = async () => ctx.app.inject({ method: 'POST', url: `${url}/step`, headers: bearer(owner.token) });
    expect(await get()).toEqual({ state: 'reading', total: 33, done: 0, missing: 0, error: null });

    // CEO stops answering after ten plots: those are kept, the rest wait for the next step
    const unknown = String(plots[5].plotId);
    let answered = 0;
    let down = true;
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      const id = new URL(u).searchParams.get('plotId')!;
      asked.push(u.slice(0, u.indexOf('?')));
      if (down && answered >= 10) throw new TypeError('fetch failed');
      answered++;
      if (id === unknown) return new Response('{"params":{"plotId":["unknown error"]}}', { status: 403 });
      const [lon, lat] = centre.get(id)!;
      return new Response(JSON.stringify(ceoAnswer(lon, lat)));
    }));
    const first = (await step()).json();
    expect(first).toMatchObject({ state: 'reading', total: 33, error: expect.stringContaining('did not answer') });
    expect(first.done).toBeGreaterThanOrEqual(10);
    expect(first.done).toBeLessThan(33);
    expect(new Set(asked)).toEqual(new Set(['https://app.collect.earth/get-plot-sample-geom']));

    down = false;
    const last = (await step()).json();
    expect(last).toEqual({ state: 'done', total: 33, done: 33, missing: 1, error: null });
    expect(answered).toBe(33);
    expect((await step()).json()).toMatchObject({ state: 'done' });
    expect(answered).toBe(33);

    const csv = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/csv-files/${plotFile.csvFileId}/content`, headers: bearer(owner.token) })).body;
    const [header, ...rows] = parseCsv(csv).filter((r) => r.length > 1);
    expect(header[header.length - 1]).toBe('plot_shape');
    expect(rows).toHaveLength(33);
    for (const row of rows) expect(hasPolygonColumn(row)).toBe(true);
    const shapeOfPlot = (visible: number) => rows.find((r) => r[0] === String(visible))![header.length - 1];
    expect(shapeOfPlot(plots[0].id).match(/\(\(/g)).toHaveLength(2); // the hexagon and its sample
    expect(shapeOfPlot(plots[5].id).match(/\(\(/g)).toHaveLength(1); // CEO had none: Collect Earth's square
  });

  it('is for coordinators of the project only, and none for a project not made from CEO', async () => {
    const created = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Own' } });
    const { projectId } = created.json();
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/ceo-shapes`, headers: bearer(owner.token) })).json()).toEqual({ state: 'none' });
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/ceo-shapes/step`, headers: bearer(owner.token) })).json()).toEqual({ state: 'none' });
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/ceo-shapes` })).statusCode).toBe(401);
  });
});
