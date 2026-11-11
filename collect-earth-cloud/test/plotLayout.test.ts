// The plot layout kept in the project file (src/plotLayout.ts, src/routes/plotLayout.ts): read as Collect Earth reads it,
// checked as the desktop's settings page checks it, and written into project_definition.properties.
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cepProperties, readCep } from '../src/cep.js';
import { layoutChanges, layoutOf, parseLayout, setProperties, withLayout, type LayoutValues } from '../src/plotLayout.js';
import { idOnlyCep } from './fixtures/cep.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const CIRCLE: LayoutValues = {
  sample_shape: 'CIRCLE',
  number_of_sampling_points_in_plot: '9',
  distance_between_sample_points: '20',
  distance_to_plot_boundaries: '0',
  inner_point_side: '3',
  large_central_plot_side: '20',
  distance_between_plots: '100',
  distance_to_buffers: '150',
  buffer_shape: 'CIRCLE',
};

describe('the plot layout in the properties', () => {
  it('is read as Collect Earth reads it: defaults, ranges, and the reference area of older projects', () => {
    expect(layoutOf(new Map())).toEqual({
      sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '25', distance_between_sample_points: '10', distance_to_plot_boundaries: '0',
      inner_point_side: '2', large_central_plot_side: '20', distance_between_plots: '100', distance_to_buffers: '100', buffer_shape: 'NONE',
    });
    const read = layoutOf(new Map([['sample_shape', 'circle'], ['distance_between_sample_points', '5000'], ['distance_to_buffers', '40,80'], ['inner_point_side', 'x']]));
    expect(read).toMatchObject({ sample_shape: 'CIRCLE', distance_between_sample_points: '1000', distance_to_buffers: '40', inner_point_side: '2', buffer_shape: 'SQUARE' });
    expect(layoutOf(new Map([['sample_shape', 'TRIANGLE']])).sample_shape).toBe('SQUARE');
  });

  it("checks a coordinator's layout: every option and range", () => {
    expect(parseLayout(CIRCLE)).toEqual(CIRCLE);
    expect(parseLayout({ ...CIRCLE, sample_shape: 'hexagon', distance_to_buffers: 300 })).toMatchObject({ sample_shape: 'HEXAGON', distance_to_buffers: '300' });
    expect(parseLayout({ ...CIRCLE, sample_shape: 'TRIANGLE' })).toMatch(/^sample_shape/);
    expect(parseLayout({ ...CIRCLE, number_of_sampling_points_in_plot: '10' })).toMatch(/^number_of_sampling_points_in_plot/);
    expect(parseLayout({ ...CIRCLE, distance_between_sample_points: '1' })).toMatch(/2 to 1000/);
    expect(parseLayout({ ...CIRCLE, distance_to_buffers: '12.5' })).toMatch(/^distance_to_buffers/);
    expect(parseLayout({ ...CIRCLE, buffer_shape: 'OVAL' })).toMatch(/^buffer_shape/);
    expect(parseLayout(null)).toMatch(/object/);
  });

  it('sets the values where their lines are, drops a later line of the same key, adds the missing ones, keeps the rest', () => {
    const text = '# Collect Earth\r\nsurvey_name=demo\r\nsample_shape = SQUARE\r\ncsv=${project_path}/grid/a.csv\r\n! note\r\nballoon=b\\\r\n  alloon.html\r\nsample_shape=HEXAGON\r\n';
    expect(setProperties(text, { sample_shape: 'CIRCLE', buffer_shape: 'NONE' })).toBe(
      '# Collect Earth\r\nsurvey_name=demo\r\nsample_shape=CIRCLE\r\ncsv=${project_path}/grid/a.csv\r\n! note\r\nballoon=b\\\r\n  alloon.html\r\nbuffer_shape=NONE\r\n',
    );
    // a value continued on the next line is replaced whole
    expect(setProperties('a=1\nsample_shape=SQ\\\n  UARE\nb=2', { sample_shape: 'CIRCLE' })).toBe('a=1\nsample_shape=CIRCLE\nb=2\n');
    expect(setProperties('', { sample_shape: 'CIRCLE' })).toBe('sample_shape=CIRCLE\n');
  });

  it('writes what the desktop would: the settings shown that changed, two of the hidden ones blank, the others left', () => {
    const square = new Map([['sample_shape', 'SQUARE'], ['number_of_sampling_points_in_plot', '25'], ['distance_to_plot_boundaries', '5'], ['large_central_plot_side', '30'], ['distance_between_plots', '250']]);
    // a circle: its radius and points; the margin and the distance between plots of a cluster are hidden and stay;
    // the central plot's side is blanked, or Collect Earth would draw one in a square plot later
    expect(layoutChanges(square, CIRCLE)).toEqual({
      sample_shape: 'CIRCLE', number_of_sampling_points_in_plot: '9', distance_between_sample_points: '20', inner_point_side: '3',
      large_central_plot_side: '', buffer_shape: 'CIRCLE', distance_to_buffers: '150',
    });
    // a square of one point: sized by its margin, the distance between points blank
    const one = { ...layoutOf(square), number_of_sampling_points_in_plot: '1', distance_to_plot_boundaries: '15' };
    expect(layoutChanges(new Map([...square, ['distance_between_sample_points', '10']]), one)).toEqual({
      number_of_sampling_points_in_plot: '1', distance_to_plot_boundaries: '15', distance_between_sample_points: '', large_central_plot_side: '',
    });
    // the same layout, read with its defaults: nothing to write
    const plain = new Map([['sample_shape', 'SQUARE']]);
    expect(layoutChanges(plain, layoutOf(plain))).toEqual({});
    // the other distances of a file edited by hand are kept after the one set
    expect(layoutChanges(new Map([['sample_shape', 'CIRCLE'], ['buffer_shape', 'CIRCLE'], ['distance_to_buffers', '50,90']]), CIRCLE).distance_to_buffers).toBe('150,90');
  });

  it('writes the layout into the project file, every other file and line as it was', () => {
    const cep = idOnlyCep();
    const before = unzipSync(cep);
    const changes = layoutChanges(cepProperties(readCep(cep)), CIRCLE);
    const written = withLayout(cep, changes, new Date(Date.UTC(2026, 10, 11)));
    const after = unzipSync(written);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) if (name !== 'project_definition.properties') expect(Buffer.from(after[name]).equals(Buffer.from(before[name])), name).toBe(true);
    const properties = cepProperties(readCep(written));
    expect(layoutOf(properties)).toMatchObject({ sample_shape: 'CIRCLE', number_of_sampling_points_in_plot: '9', distance_between_sample_points: '20', buffer_shape: 'CIRCLE', distance_to_buffers: '150' });
    const oldText = strFromU8(before['project_definition.properties']);
    const newText = strFromU8(after['project_definition.properties']);
    for (const line of oldText.split(/\r?\n/).filter((l) => l && !Object.keys(changes).some((k) => l.startsWith(`${k}=`)))) expect(newText).toContain(line);
  });
});

describe('the plot layout in the dashboard', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Land' } })).json().projectId;
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('reads the layout of the project file, and writes a new one into the file served and the one uploaded', async () => {
    expect((await call('GET', '/plot-layout', owner.token)).statusCode).toBe(404);
    expect((await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' })).statusCode).toBe(200);
    const read = await call('GET', '/plot-layout', owner.token);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({ polygons: false, canEdit: true });
    const before = read.json().layout as LayoutValues;
    expect(before).toEqual(layoutOf(cepProperties(readCep((await ctx.store.getCep(pid))!))));

    const info = await ctx.store.getCepInfo(pid);
    // the same layout: nothing written, nobody asked to get a new project file
    const again = (await call('PUT', '/plot-layout', owner.token, { layout: before })).json();
    expect(again.changed).toBe(false);
    expect((await ctx.store.getCepInfo(pid))!.updatedAt).toBe(info!.updatedAt);

    await new Promise((r) => setTimeout(r, 5));
    const saved = await call('PUT', '/plot-layout', owner.token, { layout: CIRCLE });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ layout: { sample_shape: 'CIRCLE', distance_between_sample_points: '20', buffer_shape: 'CIRCLE' }, changed: true });
    expect((await call('GET', '/plot-layout', owner.token)).json().layout).toEqual(saved.json().layout);
    // the served file (with the round the server added) and the one uploaded both carry it
    const served = readCep((await ctx.store.getCep(pid))!);
    expect(layoutOf(cepProperties(served))).toEqual(saved.json().layout);
    expect(strFromU8(served.entries.get(served.surveyPath)!)).toContain('name="round"');
    const original = await ctx.store.getOriginalCep(pid);
    if (original) expect(layoutOf(cepProperties(readCep(original)))).toEqual(saved.json().layout);
    // a new project file: the people who have the older one are told to get it
    expect((await ctx.store.getCepInfo(pid))!.updatedAt).toBeGreaterThan(info!.updatedAt);

    expect((await call('PUT', '/plot-layout', owner.token, { layout: { ...CIRCLE, sample_shape: 'OVAL' } })).statusCode).toBe(400);
    const invite = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1 });
    const maria = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'maria', password: 'password12', inviteToken: invite.json().inviteToken } })).json();
    expect((await call('GET', '/plot-layout', maria.token)).statusCode).toBe(403);
    expect((await call('PUT', '/plot-layout', maria.token, { layout: CIRCLE })).statusCode).toBe(403);
  });
});
