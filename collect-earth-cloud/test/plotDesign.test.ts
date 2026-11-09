import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipCep } from '../src/cep.js';
import { parsePlotFile } from '../src/plots.js';
import { areaFromGeoJson, areaFromShapefileZip, designPlots, planDesign, plotFileCsv, type AreaOfInterest } from '../src/plotDesign.js';
import { placesOfPlotFile } from '../src/routes/plotPlaces.js';
import { readDbf, readShpPolygons, WGS84_PRJ, writeDbf, writeShp } from '../src/shapefile.js';
import { demoCep, idOnlyCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const inBox = ([x0, y0, x1, y1]: number[], p: { lon: number; lat: number }) => p.lon >= x0 && p.lon <= x1 && p.lat >= y0 && p.lat <= y1;

/** A square of 0.1° with a hole of 0.05° in the middle, and a second square apart: one multipolygon. */
const multi = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { zone: 'A', code: 1 },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[box(0, 0, 0.1, 0.1), box(0.025, 0.025, 0.075, 0.075)], [box(1, 0, 1.1, 0.1)]],
      },
    },
    { type: 'Feature', properties: { zone: 'B' }, geometry: { type: 'Point', coordinates: [5, 5] } },
  ],
};
const HOLE = [0.025, 0.025, 0.075, 0.075];
const FIRST = [0, 0, 0.1, 0.1];
const SECOND = [1, 0, 1.1, 0.1];

/** Stratum A of 0.1 × 0.1°, stratum B three times as large. */
const strata = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { zone: 'B' }, geometry: { type: 'Polygon', coordinates: [box(1, 0, 1.3, 0.1)] } },
    { type: 'Feature', properties: { zone: 'A' }, geometry: { type: 'Polygon', coordinates: [box(0, 0, 0.1, 0.1)] } },
  ],
};

describe('reading the area of interest', () => {
  it('GeoJSON: the polygons of a multipolygon with a hole, attributes as text; points left out', () => {
    const area = areaFromGeoJson(JSON.stringify(multi));
    expect(area.features).toHaveLength(1);
    expect(area.features[0].signs).toEqual([1, -1, 1]);
    expect(area.fields).toEqual(['zone', 'code']);
    expect(area.features[0].attributes).toEqual({ zone: 'A', code: '1' });
  });

  it('refuses what is not an area in latitude and longitude', () => {
    expect(() => areaFromGeoJson('not json')).toThrow(/not GeoJSON/);
    expect(() => areaFromGeoJson(JSON.stringify({ type: 'Point', coordinates: [0, 0] }))).toThrow(/no polygons/);
    expect(() => areaFromGeoJson(JSON.stringify({ type: 'Polygon', coordinates: [box(400000, 0, 500000, 10)] }))).toThrow(/WGS84/);
  });

  it('a zipped shapefile round-trips through the writer: rings (outer clockwise, hole counterclockwise) and the .dbf', () => {
    const polygon = { type: 'Polygon' as const, coordinates: [box(0, 0, 0.1, 0.1), box(0.025, 0.025, 0.075, 0.075).reverse()] };
    const { shp } = writeShp([polygon, null]);
    const rings = readShpPolygons(shp);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(2);
    expect(rings[1]).toBeNull();
    const dbf = writeDbf(['zone', 'name'], [['A', 'São'], ['B', '']], new Date());
    expect(readDbf(dbf)).toEqual({ fields: ['zone', 'name'], records: [['A', 'São'], ['B', '']] });
    const zip = zipCep(new Map<string, Uint8Array>([['aoi/Area.SHP', shp], ['aoi/area.dbf', dbf], ['aoi/area.prj', Buffer.from(WGS84_PRJ)]]), new Date());
    const area = areaFromShapefileZip(zip);
    expect(area.fields).toEqual(['zone', 'name']);
    expect(area.features).toHaveLength(1);
    expect(area.features[0].signs).toEqual([1, -1]);
    expect(area.features[0].attributes).toEqual({ zone: 'A', name: 'São' });
    // The hole is a hole: no random plot falls in it.
    const plots = designPlots(area, { method: 'random', count: 300 }, 7);
    expect(plots.every((p) => inBox(FIRST, p) && !inBox(HOLE, p))).toBe(true);
  });

  it('a shapefile in projected coordinates, or not of polygons, is refused', () => {
    const { shp } = writeShp([{ type: 'Polygon', coordinates: [box(0, 0, 1, 1)] }]);
    const projected = zipCep(new Map<string, Uint8Array>([['a.shp', shp], ['a.prj', Buffer.from('PROJCS["WGS_1984_UTM_Zone_33N",GEOGCS[]]')]]), new Date());
    expect(() => areaFromShapefileZip(projected)).toThrow(/projected/);
    const points = zipCep(new Map<string, Uint8Array>([['a.shp', writeShp([{ type: 'Point', coordinates: [0, 0] }]).shp]]), new Date());
    expect(() => areaFromShapefileZip(points)).toThrow(/type 1, not polygons/);
    expect(() => areaFromShapefileZip(Buffer.from('nope'))).toThrow(/not a zip/);
  });
});

describe('laying out plots', () => {
  const area = (json: unknown): AreaOfInterest => areaFromGeoJson(JSON.stringify(json));

  it('random: N plots inside the area (both parts, never in the hole), the same for the same seed', () => {
    const plots = designPlots(area(multi), { method: 'random', count: 400 }, 42);
    expect(plots).toHaveLength(400);
    expect(plots.every((p) => (inBox(FIRST, p) && !inBox(HOLE, p)) || inBox(SECOND, p))).toBe(true);
    // The second square has 4/3 of the first's area left by the hole: about 57% of the plots.
    const second = plots.filter((p) => inBox(SECOND, p)).length;
    expect(second).toBeGreaterThan(190);
    expect(second).toBeLessThan(270);
    expect(designPlots(area(multi), { method: 'random', count: 400 }, 42)).toEqual(plots);
    expect(designPlots(area(multi), { method: 'random', count: 400 }, 43)).not.toEqual(plots);
  });

  it('grid: one plot every spacing metres inside the area, the count known before', () => {
    const square = area({ type: 'Polygon', coordinates: [box(0, 0, 0.1, 0.1)] });
    // 0.1° is about 11.1 km: 11 rows of 11 plots 1 km apart, the grid centred in its cells.
    const plots = designPlots(square, { method: 'grid', spacingMeters: 1000, randomOffset: false }, 1);
    expect(plots).toHaveLength(121);
    expect(planDesign(square, { method: 'grid', spacingMeters: 1000, randomOffset: false }, 1)).toEqual({ plots: 121, tooMany: false, strata: null });
    // The first two plots of a row are 1 km apart.
    expect((plots[1].lon - plots[0].lon) * 111319.49).toBeCloseTo(1000, -1);
    const withHole = designPlots(area(multi), { method: 'grid', spacingMeters: 1000, randomOffset: true }, 5);
    expect(withHole.some((p) => inBox(HOLE, p))).toBe(false);
    expect(designPlots(area(multi), { method: 'grid', spacingMeters: 1000, randomOffset: true }, 5)).toEqual(withHole);
  });

  it('grid: too many plots is said before and refused when made', () => {
    const square = area({ type: 'Polygon', coordinates: [box(0, 0, 0.1, 0.1)] });
    const plan = planDesign(square, { method: 'grid', spacingMeters: 40, randomOffset: false }, 1, 1000);
    expect(plan.tooMany).toBe(true);
    expect(plan.plots).toBeGreaterThan(1000);
    expect(() => designPlots(square, { method: 'grid', spacingMeters: 40, randomOffset: false }, 1, 1000)).toThrow(/more than 1,000 plots/);
  });

  it('stratified: N per stratum, or N shared by area; each plot in its stratum', () => {
    const a = area(strata);
    const equal = designPlots(a, { method: 'stratified', field: 'zone', allocation: 'equal', count: 5 }, 3);
    expect(equal.map((p) => p.stratum)).toEqual(['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B']);
    const plan = planDesign(a, { method: 'stratified', field: 'zone', allocation: 'proportional', count: 40 }, 3);
    expect(plan.plots).toBe(40);
    expect(plan.strata!.map((s) => [s.value, s.plots])).toEqual([
      ['A', 10],
      ['B', 30],
    ]);
    expect(plan.strata![0].areaKm2).toBeCloseTo(123.6, 0);
    const shared = designPlots(a, { method: 'stratified', field: 'zone', allocation: 'proportional', count: 40 }, 3);
    expect(shared.filter((p) => p.stratum === 'A').every((p) => inBox(FIRST, p))).toBe(true);
    expect(shared.filter((p) => p.stratum === 'B').every((p) => inBox([1, 0, 1.3, 0.1], p))).toBe(true);
  });
});

describe('the plot file', () => {
  it('is read by the upload as Collect Earth plots: id, latitude, longitude, then elevation, slope, aspect and the stratum', () => {
    const plots = [
      { lon: 151.358785, lat: -4.998422, stratum: 'Forest, dense' },
      { lon: 150.5, lat: -5.5, stratum: 'B' },
    ];
    const csv = plotFileCsv(plots, { count: 1, roundIndex: null, roundCode: '1' });
    expect(csv).toBe('id,YCoordinate,XCoordinate,elevation,slope,aspect,stratum\n1,-4.998422,151.358785,0,0,0,"Forest, dense"\n2,-5.500000,150.500000,0,0,0,B\n');
    const file = parsePlotFile(Buffer.from(csv));
    expect(file.plotIds).toEqual(['1', '2']);
    expect([...placesOfPlotFile({ data: Buffer.from(csv), checksum: 'x' } as never, 1).places.values()]).toEqual([
      [-4.998422, 151.358785],
      [-5.5, 150.5],
    ]);
    // A survey with its own round key (the demo's id, round): the first round's code in that column.
    expect(plotFileCsv([plots[1]], { count: 2, roundIndex: 1, roundCode: '1' })).toBe('id,round,YCoordinate,XCoordinate,elevation,slope,aspect,stratum\n1,1,-5.500000,150.500000,0,0,0,B\n');
  });
});

describe('POST /plot-design', () => {
  let ctx: TestContext;
  let pid: string;
  let admin: string;

  beforeEach(async () => {
    ctx = await makeContext();
    const project = await createProject(ctx.app, 'Design');
    pid = project.projectId;
    admin = project.adminToken;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const post = (payload: unknown, token = admin) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/plot-design`, headers: bearer(token), payload: payload as never });
  const geojson = JSON.stringify(strata);

  it('reads the area, says how many plots a design makes, then makes the plot file the upload takes', async () => {
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(admin), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    const read = await post({ geojson });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ features: 2, fields: ['zone'], max: 50000 });
    const design = { method: 'stratified', field: 'zone', allocation: 'proportional', count: 20 };
    const plan = await post({ geojson, design, seed: 9 });
    expect(plan.json()).toMatchObject({ plots: 20, tooMany: false, seed: 9, strata: [{ value: 'A', plots: 5 }, { value: 'B', plots: 15 }] });
    const made = await post({ geojson, design, seed: 9, generate: true });
    expect(made.statusCode).toBe(200);
    expect(made.headers['content-type']).toContain('text/csv');
    expect(made.headers['x-plot-count']).toBe('20');
    expect((await post({ geojson, design, seed: 9, generate: true })).body).toBe(made.body);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/design.csv`, headers: { ...bearer(admin), 'content-type': 'text/csv' }, payload: made.body });
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json().plotCount).toBe(20);
    expect(up.json().warnings).toBeUndefined();
  });

  it("a survey with its own round key gets the first round's code in its column", async () => {
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(admin), 'content-type': 'application/zip' }, payload: demoCep() });
    const made = await post({ geojson, design: { method: 'random', count: 3 }, seed: 1, generate: true });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.body.split('\n')[0]).toBe('id,round,YCoordinate,XCoordinate,elevation,slope,aspect');
    expect(made.body.split('\n')[1]).toMatch(/^1,1,/);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/design.csv`, headers: { ...bearer(admin), 'content-type': 'text/csv' }, payload: made.body });
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json().plotCount).toBe(3);
  });

  it('refuses a bad area or design with the reason, and anyone but a coordinator', async () => {
    expect((await post({ geojson: '{' })).json()).toMatchObject({ error: 'bad_request', code: 'bad_area' });
    expect((await post({ geojson, design: { method: 'random', count: 50001 } })).json()).toMatchObject({ code: 'bad_design' });
    expect((await post({ geojson, design: { method: 'stratified', field: 'nope', allocation: 'equal', count: 1 } })).json()).toMatchObject({ code: 'bad_design' });
    const tiny = await post({ geojson, design: { method: 'grid', spacingMeters: 1, randomOffset: false }, generate: true });
    expect(tiny.json()).toMatchObject({ code: 'too_many' });
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(admin), payload: { role: 'reviewer', maxUses: 1 } });
    const rita = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'rita', password: 'password12', inviteToken: invite.json().inviteToken } });
    expect((await post({ geojson }, rita.json().token)).statusCode).toBe(403);
  });
});
