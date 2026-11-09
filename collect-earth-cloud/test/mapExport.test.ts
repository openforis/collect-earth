import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { geojsonOf, kmlOf, plotGeometry, rowGeometries, shapefileOf } from '../src/mapExport.js';
import { dbfFieldNames, signedArea2, writeShp, type Geometry } from '../src/shapefile.js';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

const table = {
  columns: ['record_key', 'plot', 'collect_code_land_use', 'collect_text_note'],
  rows: [
    ['1', '1', 'F', 'São <ok> & "x"'],
    ['2', '2', 'C', ''],
    ['3', '3', 'G', 'no place'],
  ],
};
const square = { kind: 'square', sideMeters: 70 } as const;
const places = new Map<string, [number, number]>([
  ['1', [-5, 151]],
  ['2', [-5.1, 151.2]],
]);

describe('map export geometry', () => {
  it('a plot is the square Collect Earth draws, counterclockwise; a point when the shape is unknown; null without a place', () => {
    const g = plotGeometry([0, 0], square);
    expect(g?.type).toBe('Polygon');
    const ring = (g as { coordinates: [number, number][][] }).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(signedArea2(ring)).toBeGreaterThan(0);
    // 70 m wide: about 0.000629 degrees at the equator.
    const xs = ring.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(70 / 111319.49, 6);
    expect(plotGeometry([1, 2], { kind: 'place' })).toEqual({ type: 'Point', coordinates: [2, 1] });
    expect(plotGeometry(undefined, square)).toBeNull();
  });
});

describe('dbfFieldNames', () => {
  it('cuts names to 10 characters, drops the collect_ prefix, and makes them unique the same way each time', () => {
    const names = dbfFieldNames(['record_key', 'collect_code_land_use_category', 'collect_code_land_use_category_2', 'LAND_USE_C', 'modified on', '1st', 'record_key']);
    expect(names).toEqual(['record_key', 'land_use_c', 'land_use_1', 'LAND_USE_2', 'modified_o', 'F1st', 'record_k_1']);
    expect(names.every((n) => n.length <= 10)).toBe(true);
  });
});

describe('shapefile writer', () => {
  const geometries = rowGeometries(table, places, square);
  const files = shapefileOf(table, geometries, 'plots', new Date(Date.UTC(2026, 10, 9)));
  const shp = Buffer.from(files.get('plots.shp')!);
  const shx = Buffer.from(files.get('plots.shx')!);
  const dbf = Buffer.from(files.get('plots.dbf')!);

  it('writes every file of a shapefile and the field mapping', () => {
    expect([...files.keys()]).toEqual(['plots.shp', 'plots.shx', 'plots.dbf', 'plots.prj', 'plots.cpg', 'fields.csv']);
    expect(strFromU8(files.get('plots.prj')!)).toContain('GCS_WGS_1984');
    expect(strFromU8(files.get('fields.csv')!)).toBe('field,column\r\nrecord_key,record_key\r\nplot,plot\r\nland_use,collect_code_land_use\r\nnote,collect_text_note\r\n');
  });

  it('the .shp header: file code, length in words, version, polygon type, box', () => {
    expect(shp.readInt32BE(0)).toBe(9994);
    expect(shp.readInt32BE(24) * 2).toBe(shp.length);
    expect(shp.readInt32LE(28)).toBe(1000);
    expect(shp.readInt32LE(32)).toBe(5);
    const [xmin, ymin, xmax, ymax] = [36, 44, 52, 60].map((o) => shp.readDoubleLE(o));
    expect(xmin).toBeLessThan(151);
    expect(xmax).toBeGreaterThan(151.2);
    expect(ymin).toBeLessThan(-5.1);
    expect(ymax).toBeGreaterThan(-5);
    // Record 1: number 1, a polygon of 1 part and 5 points, its ring clockwise; record 3 a null shape.
    expect(shp.readInt32BE(100)).toBe(1);
    expect(shp.readInt32BE(104) * 2).toBe(44 + 4 + 16 * 5);
    expect(shp.readInt32LE(108)).toBe(5);
    expect(shp.readInt32LE(108 + 36)).toBe(1);
    expect(shp.readInt32LE(108 + 40)).toBe(5);
    const ring: [number, number][] = Array.from({ length: 5 }, (_, i) => [shp.readDoubleLE(108 + 48 + 16 * i), shp.readDoubleLE(108 + 56 + 16 * i)]);
    expect(signedArea2(ring)).toBeLessThan(0);
    const third = shx.readInt32BE(100 + 16) * 2;
    expect(shp.readInt32BE(third)).toBe(3);
    expect(shp.readInt32BE(third + 4)).toBe(2);
    expect(shp.readInt32LE(third + 8)).toBe(0);
  });

  it('the .shx: one entry per record pointing at it', () => {
    expect(shx.readInt32BE(0)).toBe(9994);
    expect(shx.readInt32BE(24) * 2).toBe(shx.length);
    expect((shx.length - 100) / 8).toBe(3);
    for (let i = 0; i < 3; i++) {
      const offset = shx.readInt32BE(100 + 8 * i) * 2;
      expect(shp.readInt32BE(offset)).toBe(i + 1);
      expect(shp.readInt32BE(offset + 4)).toBe(shx.readInt32BE(104 + 8 * i));
    }
  });

  it('the .dbf: dBASE III header, a character field per column, UTF-8 values padded with spaces', () => {
    expect(dbf[0]).toBe(0x03);
    expect([dbf[1], dbf[2], dbf[3]]).toEqual([126, 11, 9]);
    expect(dbf.readUInt32LE(4)).toBe(3);
    const headerLength = dbf.readUInt16LE(8);
    expect(headerLength).toBe(32 + 32 * 4 + 1);
    expect(dbf[headerLength - 1]).toBe(0x0d);
    const recordLength = dbf.readUInt16LE(10);
    const fields = Array.from({ length: 4 }, (_, i) => ({
      name: dbf.subarray(32 + 32 * i, 43 + 32 * i).toString('latin1').replace(/\0+$/, ''),
      type: String.fromCharCode(dbf[43 + 32 * i]),
      length: dbf[48 + 32 * i],
    }));
    expect(fields.map((f) => f.name)).toEqual(['record_key', 'plot', 'land_use', 'note']);
    expect(fields.every((f) => f.type === 'C')).toBe(true);
    expect(recordLength).toBe(1 + fields.reduce((s, f) => s + f.length, 0));
    expect(dbf.length).toBe(headerLength + 3 * recordLength + 1);
    expect(dbf[dbf.length - 1]).toBe(0x1a);
    const first = dbf.subarray(headerLength, headerLength + recordLength);
    // Each field as wide as its longest value, in bytes ("São" is 4).
    expect(fields.map((f) => f.length)).toEqual([1, 1, 1, 15]);
    expect(first.toString('utf8')).toBe(' 11FSão <ok> & "x"');
    const third = dbf.subarray(headerLength + 2 * recordLength, headerLength + 3 * recordLength);
    expect(third.toString('utf8')).toBe(` 33G${'no place'.padEnd(15)}`);
  });

  it('refuses points and polygons together', () => {
    const mixed: Geometry[] = [{ type: 'Point', coordinates: [0, 0] }, plotGeometry([0, 0], square)];
    expect(() => writeShp(mixed)).toThrow(/points and polygons/);
  });
});

describe('GeoJSON and KML', () => {
  const geometries = rowGeometries(table, places, { kind: 'place' });

  it('GeoJSON: a feature per row with its columns as properties', () => {
    const json = JSON.parse(geojsonOf(table, geometries));
    expect(json.type).toBe('FeatureCollection');
    expect(json.features).toHaveLength(3);
    expect(json.features[0]).toEqual({
      type: 'Feature',
      properties: { record_key: '1', plot: '1', collect_code_land_use: 'F', collect_text_note: 'São <ok> & "x"' },
      geometry: { type: 'Point', coordinates: [151, -5] },
    });
    expect(json.features[2].geometry).toBeNull();
  });

  it('KML: a placemark per row, text escaped', () => {
    const kml = kmlOf(table, geometries, 'A & B');
    expect(kml.match(/<Placemark>/g)).toHaveLength(3);
    expect(kml).toContain('<name>A &amp; B</name>');
    expect(kml).toContain('<Data name="collect_text_note"><value>São &lt;ok&gt; &amp; &quot;x&quot;</value></Data>');
    expect(kml).toContain('<Point><coordinates>151,-5</coordinates></Point>');
  });
});

describe('GET export.geojson / export.kml / export.shp.zip', () => {
  let ctx: TestContext;
  let pid: string;
  let admin: string;

  beforeEach(async () => {
    ctx = await makeContext();
    const project = await createProject(ctx.app, 'Map export');
    pid = project.projectId;
    admin = project.adminToken;
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(admin), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/plots.csv`,
      headers: { ...bearer(admin), 'content-type': 'text/csv' },
      payload: 'id,YCoordinate,XCoordinate\n1,-5,151\n2,-5.1,151.2\n',
    });
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(admin), payload: { role: 'operator', maxUses: 1 } });
    const maria = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'maria', password: 'password12', inviteToken: invite.json().inviteToken } });
    await batchRequest(ctx.app, pid, maria.json().token, [
      envelope({ recordKey: '1', operator: 'maria', summary: { collect_code_land_use: 'F' } }),
      envelope({ recordKey: '2', operator: 'maria', summary: { collect_code_land_use: 'C' } }),
    ]);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const get = (path: string, token = admin) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/${path}`, headers: bearer(token) });

  it('GeoJSON: each record with its plot as the survey square (70 m) and the CSV columns', async () => {
    const res = await get('export.geojson');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/geo+json');
    expect(res.headers['content-disposition']).toContain('Map_export-data.geojson');
    const json = res.json();
    expect(json.features).toHaveLength(2);
    expect(json.features[0].properties).toMatchObject({ record_key: '1', plot: '1', operator: 'maria', collect_code_land_use: 'F' });
    expect(json.features[0].geometry.type).toBe('Polygon');
    const xs = json.features[0].geometry.coordinates[0].map((p: number[]) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(70 / 110900, 4);
  });

  it('KML and the zipped shapefile', async () => {
    const kml = await get('export.kml');
    expect(kml.statusCode).toBe(200);
    expect(kml.body.match(/<Polygon>/g)).toHaveLength(2);
    const zip = await get('export.shp.zip');
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(zip.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['fields.csv', 'plots.cpg', 'plots.dbf', 'plots.prj', 'plots.shp', 'plots.shx']);
    expect(Buffer.from(files['plots.dbf']).readUInt32LE(4)).toBe(2);
    expect(Buffer.from(files['plots.shp']).readInt32LE(32)).toBe(5);
  });

  it('coordinators only, as the CSV export', async () => {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(admin), payload: { role: 'reviewer', maxUses: 1 } });
    const rita = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'rita', password: 'password12', inviteToken: invite.json().inviteToken } });
    expect((await get('export.kml', rita.json().token)).statusCode).toBe(403);
  });
});
