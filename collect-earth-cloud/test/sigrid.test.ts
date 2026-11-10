import { randomBytes } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipCep } from '../src/cep.js';
import { csvCells, readPackageEntry, sigridPlots } from '../src/sigrid.js';
import { idOnlyCep, integerIdCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const box = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

/** A small country: province A (districts a1, a2) and B (district "Nord, haut"), grids at 1 and 2 km. */
const GRID_1 = [
  'CE_ID,yCoordinate,xCoordinate,ADM1NM,ADM2NM',
  '1_1,10.0,2.0,A,a1',
  '1_2,10.0,2.1,A,a2',
  '1_3,11.0,3.0,B,"Nord, haut"',
  '1_4,11.0,3.1,B,"Nord, haut"',
].join('\r\n');
const GRID_2 = ['CE_ID,yCoordinate,xCoordinate,ADM1NM,ADM2NM', '1_1,10.0,2.0,A,a1', '1_3,11.0,3.0,B,"Nord, haut"'].join('\r\n');
const COUNTS = ['ADM1NM,ADM2NM,plots_1x1km,plots_2x2km', 'A,a1,1,1', 'A,a2,1,0', 'B,"Nord, haut",2,1'].join('\r\n');
/** An incompressible entry after the grids, to see the download stop before it. */
const PADDING = randomBytes(2_000_000);

const packageZip = (counts = COUNTS) =>
  zipSync(
    {
      'X_1x1km.csv': strToU8(GRID_1),
      'X_2x2km.csv': strToU8(GRID_2),
      'X_padding.bin': [PADDING, { level: 0 }],
      'X_plot_counts_by_district.csv': strToU8(counts),
    },
    { level: 6 },
  );

/** openforis.org: serves `zip` (honouring ranges unless `ranges` is false) in 64 KB pieces, counting the bytes sent. */
function serve(zip: Uint8Array, ranges = true) {
  const sent = { bytes: 0, urls: [] as string[], ranges: [] as (string | null)[] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    sent.urls.push(url);
    const range = new Headers(init?.headers).get('range');
    sent.ranges.push(range);
    let body = zip;
    let status = 200;
    const headers = new Headers();
    const m = ranges && range ? /^bytes=(-?\d+)-?(\d*)$/.exec(range) : null;
    if (m) {
      const start = m[1].startsWith('-') ? Math.max(0, zip.length + Number(m[1])) : Number(m[1]);
      body = zip.subarray(start);
      status = 206;
      headers.set('content-range', `bytes ${start}-${zip.length - 1}/${zip.length}`);
    }
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= body.length) return controller.close();
        const piece = body.subarray(at, at + 65_536);
        at += piece.length;
        sent.bytes += piece.length;
        controller.enqueue(piece);
      },
    });
    return new Response(stream, { status, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('reading a SIGRID package', () => {
  it('reads CSV cells, quoted or not', () => {
    expect(csvCells('a,b,,c')).toEqual(['a', 'b', '', 'c']);
    expect(csvCells('1,"Nord, haut","say ""hi"""')).toEqual(['1', 'Nord, haut', 'say "hi"']);
  });

  it('streams only the entry asked for, from its place in the zip, and stops the download there', async () => {
    const zip = packageZip();
    const sent = serve(zip);
    const lines: string[] = [];
    expect(await readPackageEntry('Benin_grids.zip', (n) => n.endsWith('_2x2km.csv'), (l) => lines.push(l))).toBe(true);
    expect(lines).toEqual(GRID_2.split('\r\n'));
    expect(sent.urls.every((u) => u === 'https://www.openforis.org/fileadmin/SIGRID_1000m_grids/per_country/Benin_grids.zip')).toBe(true);
    expect(sent.ranges[0]).toBe('bytes=-65536');
    expect(sent.ranges[1]).toMatch(/^bytes=[1-9]\d*-$/);
    // The tail, the grid's piece and one the stream read ahead: not the 2 MB after it.
    expect(sent.bytes).toBeLessThan(65_536 * 4);
  });

  it('a host that ignores ranges: the zip from its start, still stopped once the entry is read', async () => {
    const sent = serve(packageZip(), false);
    const lines: string[] = [];
    expect(await readPackageEntry('Albania_grids.zip', (n) => n.endsWith('_1x1km.csv'), (l) => lines.push(l))).toBe(true);
    expect(lines).toHaveLength(5);
    expect(sent.bytes).toBeLessThan(PADDING.length);
    expect(await readPackageEntry('Albania_grids.zip', (n) => n.endsWith('_7x7km.csv'), () => undefined)).toBe(false);
  });

  it('fetches only allowlisted packages', async () => {
    const sent = serve(packageZip());
    await expect(readPackageEntry('../../evil.zip', () => true, () => undefined)).rejects.toMatchObject({ code: 'bad_package' });
    await expect(readPackageEntry('https://evil.example/x.zip', () => true, () => undefined)).rejects.toMatchObject({ code: 'bad_package' });
    expect(sent.urls).toEqual([]);
  });

  it('the plots of the selection and clip, every one counted, the first kept', async () => {
    serve(packageZip());
    const all = await sigridPlots('Benin_grids.zip', 1, { provinces: [], districts: [] }, null, 2);
    expect(all.count).toBe(4);
    expect(all.plots).toEqual([
      { id: '1_1', lat: 10, lon: 2, province: 'A', district: 'a1' },
      { id: '1_2', lat: 10, lon: 2.1, province: 'A', district: 'a2' },
    ]);
    const some = await sigridPlots('Benin_grids.zip', 1, { provinces: ['B'], districts: [{ province: 'A', district: 'a2' }] }, null, 10);
    expect(some.plots.map((p) => p.id)).toEqual(['1_2', '1_3', '1_4']);
    const clipped = await sigridPlots('Benin_grids.zip', 1, { provinces: [], districts: [] }, (lon) => lon > 3.05, 10);
    expect(clipped.plots.map((p) => p.id)).toEqual(['1_4']);
  });
});

describe('POST /sigrid', () => {
  let ctx: TestContext;
  let pid: string;
  let admin: string;

  beforeEach(async () => {
    ctx = await makeContext();
    const project = await createProject(ctx.app, 'Sigrid');
    pid = project.projectId;
    admin = project.adminToken;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const post = (payload: unknown, token = admin) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/sigrid`, headers: bearer(token), payload: payload as never });
  const putCep = (cep: Buffer) => ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(admin), 'content-type': 'application/zip' }, payload: cep });

  it('lists the countries, then the provinces and districts with their plots per spacing, and counts a choice', async () => {
    serve(packageZip());
    const list = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/sigrid/countries`, headers: bearer(admin) });
    expect(list.json().countries).toContainEqual({ name: "Côte d'Ivoire", file: 'Cote_d_Ivoire' });
    expect(list.json().countries).toHaveLength(198);
    const facts = await post({ country: 'Benin' });
    expect(facts.statusCode, facts.body).toBe(200);
    expect(facts.json()).toEqual({
      country: 'Benin',
      spacings: [1, 2],
      provinces: [
        { name: 'A', plots: [2, 1], districts: [{ name: 'a1', plots: [1, 1] }, { name: 'a2', plots: [1, 0] }] },
        { name: 'B', plots: [2, 1], districts: [{ name: 'Nord, haut', plots: [2, 1] }] },
      ],
      selected: [4, 2],
      max: 50000,
    });
    expect((await post({ country: 'Benin', spacingKm: 1, provinces: ['A'] })).json()).toMatchObject({ selected: [2, 1], plots: 2, tooMany: false });
    // A clip: the grid read and its plots tested.
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [box(2.9, 10.9, 3.05, 11.1)] });
    expect((await post({ country: 'Benin', spacingKm: 1, geojson })).json()).toMatchObject({ selected: [4, 2], plots: 1 });
  });

  it('makes the plot file with SIGRID ids and the province and district in the survey’s ADM1NM and ADM2NM columns', async () => {
    serve(packageZip());
    const files = unzipSync(new Uint8Array(idOnlyCep()));
    files['placemark.idm.xml'] = strToU8(strFromU8(files['placemark.idm.xml']).replace('name="province"', 'name="ADM1NM"').replace('name="district"', 'name="adm2nm"'));
    await putCep(zipCep(new Map(Object.entries(files)), new Date()));
    const made = await post({ country: 'Benin', spacingKm: 1, districts: [{ province: 'B', district: 'Nord, haut' }], generate: true });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.headers['x-plot-count']).toBe('2');
    expect(made.body).toBe(
      'id,YCoordinate,XCoordinate,elevation,slope,aspect,climate,soil,gez,country,ADM1NM,adm2nm\n' +
        '1_3,11.000000,3.000000,0,0,0,,,,,B,"Nord, haut"\n' +
        '1_4,11.000000,3.100000,0,0,0,,,,,B,"Nord, haut"\n',
    );
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/SIGRID_Benin_1km.csv`, headers: { ...bearer(admin), 'content-type': 'text/csv' }, payload: made.body });
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json().plotCount).toBe(2);
    expect(up.json().warnings).toBeUndefined();
  });

  it('refuses a survey whose plot id is a number, too many plots, and names, spacings or countries not of SIGRID', async () => {
    serve(packageZip());
    await putCep(integerIdCep());
    expect((await post({ country: 'Benin', spacingKm: 2, generate: true })).json()).toMatchObject({ code: 'id_not_text' });
    await putCep(idOnlyCep());
    expect((await post({ country: 'Atlantis' })).json()).toMatchObject({ code: 'unknown_country' });
    expect((await post({ country: 'Benin', spacingKm: 7 })).json()).toMatchObject({ code: 'bad_spacing' });
    expect((await post({ country: 'Benin', provinces: ['Z'] })).json()).toMatchObject({ code: 'bad_name' });
    expect((await post({ country: 'Benin', districts: [{ province: 'A', district: 'Nord, haut' }] })).json()).toMatchObject({ code: 'bad_name' });
    expect((await post({ country: 'Benin', spacingKm: 2, provinces: ['A'], geojson: JSON.stringify({ type: 'Polygon', coordinates: [box(5, 5, 6, 6)] }), generate: true })).json()).toMatchObject({
      code: 'no_plots',
    });
    // The counts say over the cap: refused before the grid is read.
    const sent = serve(packageZip(['ADM1NM,ADM2NM,plots_1x1km', 'A,a1,60000'].join('\n')));
    const big = await post({ country: 'Algeria', spacingKm: 1, generate: true });
    expect(big.json()).toMatchObject({ code: 'too_many' });
    expect(big.json().reason).toMatch(/larger spacing/);
    expect(sent.ranges.filter((r) => r === 'bytes=-65536')).toHaveLength(1);
    expect((await post({ country: 'Algeria', spacingKm: 1 })).json()).toMatchObject({ plots: 60000, tooMany: true });
  });

  it('says in plain words when openforis.org cannot be reached; only coordinators may ask', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const down = await post({ country: 'Andorra' });
    expect(down.statusCode).toBe(502);
    expect(down.json()).toMatchObject({ code: 'sigrid_unreachable' });
    expect(down.json().reason).toMatch(/openforis\.org could not be read/);
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(admin), payload: { role: 'reviewer', maxUses: 1 } });
    const rita = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'rita', password: 'password12', inviteToken: invite.json().inviteToken } });
    expect((await post({ country: 'Benin' }, rita.json().token)).statusCode).toBe(403);
  });
});
