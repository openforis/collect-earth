import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { cepWith, idOnlyCep } from './fixtures/cep.js';
import { MAX_PLACES } from '../src/routes/plotPlaces.js';

/** The demo survey's plot outline. */
const SQUARE = { kind: 'square', sideMeters: 70 };

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
        { plot: '3', lat: 10.5, lon: -70.125, name: '3' },
        { plot: '1', lat: -12.5, lon: 30.25, name: '1' },
        { plot: '2', lat: 40, lon: -3.7, name: '2' },
      ],
      // The demo survey's plots: 49 points 10 m apart, 5 m from the border (SquareKmlGenerator).
      outline: SQUARE,
    });
  });

  it('leaves out a plot whose coordinates are not numbers or out of range', async () => {
    await upload('a.csv', 'id,lat,lon\n1,north,3\n2,95,3\n3,1,200\n4,1,2\n');
    expect((await places(['1', '2', '3', '4'])).json()).toEqual({ places: [{ plot: '4', lat: 1, lon: 2, name: '4' }], outline: SQUARE });
  });

  it('answers an empty list with no places, and with no plot file too', async () => {
    expect((await places([])).json()).toEqual({ places: [], outline: SQUARE });
    expect((await places(['1'])).json()).toEqual({ places: [], outline: SQUARE });
  });

  it('refuses a list that is not one of up to MAX_PLACES plot ids', async () => {
    for (const plots of [undefined, 'one', [1], [''], ['x'.repeat(1001)], Array.from({ length: MAX_PLACES + 1 }, (_, i) => String(i))]) {
      expect((await places(plots)).statusCode, JSON.stringify(plots)?.slice(0, 40)).toBe(400);
    }
  });

  it("gives no places when the survey's coordinates are not latitude and longitude (its first spatial reference system)", async () => {
    // The demo survey with its spatial reference system changed to UTM 33N, as Collect Earth would transform.
    const files = unzipSync(idOnlyCep());
    const survey = strFromU8(files['placemark.idm.xml']);
    expect(survey).toContain('<spatialReferenceSystem srid="EPSG:4326">');
    files['placemark.idm.xml'] = strToU8(survey.replace('<spatialReferenceSystem srid="EPSG:4326">', '<spatialReferenceSystem srid="EPSG:32633">'));
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' },
      payload: cepWith(Object.entries(files).map(([path, data]): [string, Buffer] => [path, Buffer.from(data)])),
    });
    expect(put.statusCode, put.body).toBe(200);
    await upload('a.csv', 'id,x,y\n1,500000,4649776\n');
    expect((await places(['1'])).json()).toEqual({ places: [], outline: { kind: 'place' }, unsupportedSrs: 'EPSG:32633' });
  });

  it('reads each plot file once while it does not change, plots not found included', async () => {
    await upload('a.csv', 'id,lat,lon\n1,1,2\n2,3,4\n');
    let reads = 0;
    const getCsvFile = ctx.store.getCsvFile.bind(ctx.store);
    ctx.store.getCsvFile = async (...args) => {
      reads += 1;
      return getCsvFile(...args);
    };
    expect((await places(['1'])).json()).toEqual({ places: [{ plot: '1', lat: 1, lon: 2, name: '1' }], outline: SQUARE });
    expect((await places(['2', 'nope'])).json()).toEqual({ places: [{ plot: '2', lat: 3, lon: 4, name: '2' }], outline: SQUARE });
    expect(reads).toBe(1);
    // A changed file is read again.
    await upload('a.csv', 'id,lat,lon\n1,5,6\n');
    expect((await places(['1'])).json()).toEqual({ places: [{ plot: '1', lat: 5, lon: 6, name: '1' }], outline: SQUARE });
    expect(reads).toBe(2);
  });

  it('is for coordinators and reviewers of the project only', async () => {
    await upload('a.csv', 'id,lat,lon\n1,1,2\n');
    expect((await places(['1'], bearer(project.projectToken))).statusCode).toBe(403);
    const other = await createProject(ctx.app, 'Other');
    expect((await places(['1'], bearer(other.adminToken))).statusCode).toBe(404);
    // The other project's coordinator asking about their own project sees nothing of this one.
    expect((await places(['1'], bearer(other.adminToken), other.projectId)).json()).toEqual({ places: [], outline: { kind: 'place' } });
  });
});

describe('POST /quality/places: the plot as Collect Earth draws it', () => {
  it('a plot file with polygons gives only the place; the name leaves out the keys hidden from the record list', async () => {
    const ctx = await makeContext();
    try {
      const project = await createProject(ctx.app, 'Shapes');
      const auth = bearer(project.adminToken);
      // The survey with the round key added (hidden from the record list), as the dashboard adds it.
      await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/cep`, headers: { ...auth, 'content-type': 'application/zip' }, payload: idOnlyCep() });
      const upload = (name: string, csv: string) =>
        ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/csv-files/${name}`, headers: { ...auth, 'content-type': 'text/csv' }, payload: csv });
      await upload('a.csv', ['id,lat,lon', '1,1,2', ''].join('\n'));
      const ask = async () => (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${project.projectId}/quality/places`, headers: auth, payload: { plots: ['1'] } })).json();
      expect(await ask()).toEqual({ places: [{ plot: '1', lat: 1, lon: 2, name: '1' }], outline: SQUARE });
      await upload('a.csv', ['id,lat,lon,shape', '1,1,2,"POLYGON((2 1, 2.001 1, 2.001 1.001, 2 1))"', ''].join('\n'));
      expect((await ask()).outline).toEqual({ kind: 'place' });
    } finally {
      await ctx.app.close();
    }
  });
});
