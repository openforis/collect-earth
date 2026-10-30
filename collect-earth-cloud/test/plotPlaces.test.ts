import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';
import { MAX_PLACES } from '../src/routes/plotPlaces.js';

describe('POST /quality/places', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  const url = (pid = project.projectId) => `/v1/projects/${pid}/quality/places`;
  const places = (plots: unknown, headers = bearer(project.adminToken), pid?: string) =>
    ctx.app.inject({ method: 'POST', url: url(pid), headers, payload: { plots } as object });
  const upload = async (name: string, csv: string) => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/csv-files/${name}`,
      headers: { ...bearer(project.adminToken), 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(res.statusCode, res.body).toBe(201);
  };

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Places');
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' },
      payload: idOnlyCep(),
    });
    expect(put.json().round.state).toBe('added');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('gives the latitude and longitude after the key columns, in the order asked, leaving out unknown plots', async () => {
    await upload('a.csv', 'id,YCoordinate,XCoordinate,elevation\n1,-12.5,30.25,100\n2,40,-3.7,5\n');
    // A second file with decimal commas (quoted), as Collect Earth accepts; a plot in both keeps the first file's place.
    await upload('b.csv', '3,"10,5","-70,125",1\n1,0,0,0\n');
    const res = await places(['3', 'nope', '1', '2']);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      places: [
        { plot: '3', lat: 10.5, lon: -70.125 },
        { plot: '1', lat: -12.5, lon: 30.25 },
        { plot: '2', lat: 40, lon: -3.7 },
      ],
    });
  });

  it('leaves out a plot whose coordinates are not numbers or out of range', async () => {
    await upload('a.csv', 'id,lat,lon\n1,north,3\n2,95,3\n3,1,200\n4,1,2\n');
    expect((await places(['1', '2', '3', '4'])).json()).toEqual({ places: [{ plot: '4', lat: 1, lon: 2 }] });
  });

  it('answers an empty list with no places, and with no plot file too', async () => {
    expect((await places([])).json()).toEqual({ places: [] });
    expect((await places(['1'])).json()).toEqual({ places: [] });
  });

  it('refuses a list that is not one of up to MAX_PLACES plot ids', async () => {
    for (const plots of [undefined, 'one', [1], [''], ['x'.repeat(1001)], Array.from({ length: MAX_PLACES + 1 }, (_, i) => String(i))]) {
      expect((await places(plots)).statusCode, JSON.stringify(plots)?.slice(0, 40)).toBe(400);
    }
  });

  it('is for coordinators of the project only', async () => {
    await upload('a.csv', 'id,lat,lon\n1,1,2\n');
    expect((await places(['1'], bearer(project.projectToken))).statusCode).toBe(403);
    const other = await createProject(ctx.app, 'Other');
    expect((await places(['1'], bearer(other.adminToken))).statusCode).toBe(404);
    // The other project's coordinator asking about their own project sees nothing of this one.
    expect((await places(['1'], bearer(other.adminToken), other.projectId)).json()).toEqual({ places: [] });
  });
});
