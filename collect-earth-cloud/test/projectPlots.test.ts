import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createProject, legacyPlotFile, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// The project's plots are one set (docs/plans/2026-11-16-plots-from-the-server.md, stage 3): a plot in one plot file
// only, and every plot file with the same columns.

describe('the project’s plots are one set', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };

  const upload = (filename: string, text: string) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/${filename}`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: text });
  const listed = async () => (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files`, headers: bearer(owner.token) })).json().csvFiles;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'One set')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
  });
  afterEach(async () => ctx.app.close());

  it('refuses a plot file with a plot another file has, and says which; a file replaced keeps its own plots', async () => {
    expect((await upload('north.csv', 'id,lat,lon,province\n1,-10,20,A\n2,-10,21,A\n')).statusCode).toBe(201);
    const clash = await upload('south.csv', 'id,lat,lon,province\n2,-11,20,B\n3,-11,21,B\n');
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ error: 'plots_in_other_file', plots: ['2'], count: 1, files: ['north.csv'] });
    expect((await upload('south.csv', 'id,lat,lon,province\n3,-11,20,B\n')).statusCode).toBe(201);
    // north.csv again, with its own plots and one more
    expect((await upload('north.csv', 'id,lat,lon,province\n1,-10,20,A\n2,-10,21,A\n4,-10,22,A\n')).statusCode).toBe(201);
  });

  it('takes the same columns in another order, whatever the coordinates are named; refuses other columns', async () => {
    expect((await upload('north.csv', 'id,lat,lon,province,slope\n1,-10,20,A,3\n2,-10,21,A,4\n')).statusCode).toBe(201);
    expect((await upload('design.csv', 'id,YCoordinate,XCoordinate,SLOPE,Province\n5,-12,20,1,C\n')).statusCode).toBe(201);
    const other = await upload('other.csv', 'id,lat,lon,district\n6,-12,20,X\n');
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ error: 'columns_differ', file: 'north.csv', expected: ['id', 'lat', 'lon', 'province', 'slope'], found: ['id', 'lat', 'lon', 'district'] });
    expect((await upload('fewer.csv', 'id,lat,lon,province\n7,-12,20,X\n')).json().error).toBe('columns_differ');
  });

  it('flags the files of a project from before the rules: other columns, plots of another file', async () => {
    await upload('north.csv', 'id,lat,lon,province\n1,-10,20,A\n2,-10,21,A\n3,-10,22,A\n');
    await legacyPlotFile(ctx, pid, 'odd.csv', 'id,lat,lon\n9,-10,20\n');
    await legacyPlotFile(ctx, pid, 'again.csv', 'id,lat,lon,province\n2,-10,21,A\n3,-10,22,A\n');
    const files = Object.fromEntries((await listed()).map((f: { filename: string; columnsDiffer: boolean; sharedPlots: number }) => [f.filename, [f.columnsDiffer, f.sharedPlots]]));
    expect(files).toEqual({ 'north.csv': [false, 2], 'odd.csv': [true, 0], 'again.csv': [false, 2] });
  });
});
