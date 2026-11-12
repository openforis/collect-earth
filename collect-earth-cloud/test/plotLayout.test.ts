import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPlotLayout, minimumReferenceDistance, rewriteProperties } from '../src/plotLayout.js';
import { demoCep, idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

const propertiesOf = (zip: Buffer) => strFromU8(unzipSync(zip)['project_definition.properties']);

describe('rewriteProperties', () => {
  it('changes only the values of the keys given, keeping every other byte and the line endings', () => {
    const text = '#comment\r\nsample_shape = SQUARE\r\nextra_map_url=http\\://x\\#PLOT_ID\r\nnumber_of_sampling_points_in_plot:25\r\nname=Ça va\r\n';
    const out = rewriteProperties(Buffer.from(text, 'utf8'), { sample_shape: 'CIRCLE', number_of_sampling_points_in_plot: '9' });
    expect(out.toString('utf8')).toBe('#comment\r\nsample_shape = CIRCLE\r\nextra_map_url=http\\://x\\#PLOT_ID\r\nnumber_of_sampling_points_in_plot:9\r\nname=Ça va\r\n');
  });

  it('adds a key the file lacks at the end, leaves comments alone and replaces a continued value whole', () => {
    const out = rewriteProperties(Buffer.from('#sample_shape=SQUARE\ndistance_to_buffers=100,\\\n  200\na=b', 'utf8'), { sample_shape: 'HEXAGON', distance_to_buffers: '150' });
    expect(out.toString('utf8')).toBe('#sample_shape=SQUARE\ndistance_to_buffers=150\na=b\nsample_shape=HEXAGON\n');
  });
});

describe('checkPlotLayout', () => {
  it('takes choices and whole numbers within their range, blank too', () => {
    expect(checkPlotLayout({ sample_shape: 'CIRCLE', distance_between_sample_points: '30', large_central_plot_side: '' }, {})).toEqual({
      changes: { sample_shape: 'CIRCLE', distance_between_sample_points: '30', large_central_plot_side: '' },
    });
  });

  it.each([
    [[]],
    [{ csv: 'x' }],
    [{ sample_shape: 'TRIANGLE' }],
    [{ number_of_sampling_points_in_plot: '5' }],
    [{ distance_between_sample_points: '1' }],
    [{ distance_to_plot_boundaries: '2.5' }],
    [{ buffer_shape: 7 }],
  ])('refuses %j', (body) => {
    expect(checkPlotLayout(body, {})).toHaveProperty('reason');
  });

  it('refuses a reference area that does not hold the plot, as Collect Earth does', () => {
    // A 7x7 square, 10 m apart, 5 m margin: 70 m wide, so a square reference area needs 36 m
    const plot = { sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '49', distance_between_sample_points: '10', distance_to_plot_boundaries: '5' };
    expect(minimumReferenceDistance({ ...plot, buffer_shape: 'SQUARE' })).toBe(36);
    expect(checkPlotLayout({ buffer_shape: 'SQUARE', distance_to_buffers: '35' }, plot)).toHaveProperty('reason');
    expect(checkPlotLayout({ buffer_shape: 'SQUARE', distance_to_buffers: '36' }, plot)).toHaveProperty('changes');
    expect(checkPlotLayout({ buffer_shape: 'NONE', distance_to_buffers: '1' }, plot)).toHaveProperty('changes');
  });
});

describe('plot layout routes', () => {
  let ctx: TestContext;
  let p: Awaited<ReturnType<typeof createProject>>;
  const url = () => `/v1/projects/${p.projectId}/plot-layout`;
  const upload = (cep: Buffer) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: cep });

  beforeEach(async () => {
    ctx = await makeContext();
    p = await createProject(ctx.app);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('is 404 before a project file is uploaded', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.adminToken), payload: { sample_shape: 'CIRCLE' } })).statusCode).toBe(404);
  });

  it('gives any member the layout and lets only the coordinator change it, in the served and the uploaded file', async () => {
    expect((await upload(idOnlyCep())).statusCode).toBe(200);
    const read = await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) });
    expect(read.json()).toEqual({
      layout: { sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '49', distance_between_sample_points: '10', distance_to_plot_boundaries: '5', inner_point_side: '2' },
      recordsExist: false,
    });
    expect((await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.projectToken), payload: { sample_shape: 'CIRCLE' } })).statusCode).toBe(403);
    const bad = await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.adminToken), payload: { distance_between_sample_points: '5000' } });
    expect(bad.statusCode).toBe(400);

    const servedBefore = (await ctx.store.getCep(p.projectId))!;
    const res = await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.adminToken), payload: { sample_shape: 'CIRCLE', distance_between_sample_points: '15' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().layout).toMatchObject({ sample_shape: 'CIRCLE', distance_between_sample_points: '15', number_of_sampling_points_in_plot: '49' });

    const served = (await ctx.store.getCep(p.projectId))!;
    const expected = propertiesOf(servedBefore).replace('sample_shape=SQUARE', 'sample_shape=CIRCLE').replace('distance_between_sample_points=10', 'distance_between_sample_points=15');
    expect(propertiesOf(served)).toBe(expected);
    // The other files of the project file stay as they were
    const [before, after] = [unzipSync(servedBefore), unzipSync(served)];
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) {
      if (name !== 'project_definition.properties') expect(Buffer.from(after[name]).equals(Buffer.from(before[name])), name).toBe(true);
    }
    // The server added round: the file as uploaded gets the layout too
    expect(propertiesOf((await ctx.store.getOriginalCep(p.projectId))!)).toContain('sample_shape=CIRCLE');
    expect((await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) })).json().layout.sample_shape).toBe('CIRCLE');

    const log = await ctx.store.listAudit(p.projectId, { limit: 10 });
    expect(JSON.stringify(log)).toContain('"setting":"plotLayout"');
  });

  it('says when records exist', async () => {
    await upload(demoCep());
    await batchRequest(ctx.app, p.projectId, p.projectToken, [envelope()]);
    expect((await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) })).json().recordsExist).toBe(true);
  });
});
