import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkImagery } from '../src/imagery.js';
import { rewriteProperties } from '../src/plotLayout.js';
import { demoCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const propertiesOf = (zip: Buffer) => strFromU8(unzipSync(zip)['project_definition.properties']);
const today = new Date(Date.UTC(2026, 10, 12));

describe('checkImagery', () => {
  it("takes the switches, dates, Planet mosaics and web addresses of Collect Earth's settings, blank too", () => {
    const body = {
      open_gee_app: 'true', geeapp_date_from: '2015-01-01', geeapp_date_to: '2026-11-12', open_earth_map: 'false', open_esri_wayback: 'true',
      planet_maps_use_tfo: 'true', planet_tfo_date_from: '2019-12_2020-05', planet_tfo_date_to: '', extra_map_url: 'https://example.com/?lat=LATITUDE&lon=LONGITUDE',
    };
    expect(checkImagery(body, {}, today)).toEqual({ changes: body });
  });

  it.each([
    [[]],
    [{ planet_maps_key: 'PLAK123' }],
    [{ open_gee_app: 'yes' }],
    [{ open_earth_map: true }],
    [{ geeapp_date_from: '1999-12-31' }],
    [{ geeapp_date_to: '2026-11-13' }],
    [{ geeapp_date_from: '2021-02-30' }],
    [{ geeapp_date_from: '2021-13-01' }],
    [{ planet_tfo_date_from: 'Oldest' }],
    [{ extra_map_url: 'file:///etc/passwd' }],
    [{ extra_map_url: 'https://x/\nopen_gee_app=false' }],
  ])('refuses %j', (body) => {
    expect(checkImagery(body, {}, today)).toHaveProperty('reason');
  });

  it('refuses a start date after the end date, with the dates kept', () => {
    expect(checkImagery({ geeapp_date_from: '2020-01-01' }, { geeapp_date_to: '2019-01-01' }, today)).toHaveProperty('reason');
    expect(checkImagery({ geeapp_date_from: '2020-01-01' }, { geeapp_date_to: '' }, today)).toHaveProperty('changes');
  });
});

describe('rewriteProperties', () => {
  it('writes a value as a properties line holds it: no line can get in, and non-ASCII escaped', () => {
    const out = rewriteProperties(Buffer.from('extra_map_url=x\n', 'latin1'), { extra_map_url: 'https://x/\u00e7?a=\\b\nopen_gee_app=false' });
    expect(out.toString('latin1')).toBe('extra_map_url=https://x/\\u00e7?a=\\\\b\\u000aopen_gee_app=false\n');
  });
});

describe('imagery routes', () => {
  let ctx: TestContext;
  let p: Awaited<ReturnType<typeof createProject>>;
  const url = () => `/v1/projects/${p.projectId}/imagery`;

  beforeEach(async () => {
    ctx = await makeContext();
    p = await createProject(ctx.app);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('is 404 before a project file is uploaded', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.adminToken), payload: { open_earth_map: 'true' } })).statusCode).toBe(404);
  });

  it('gives any member the imagery windows and lets only the coordinator change them, in the project file', async () => {
    const upload = await ctx.app.inject({
      method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: demoCep(),
    });
    expect(upload.statusCode).toBe(200);
    const extra = 'http://openforis.org/fileadmin/docs/collectEarth/presentation/Collect_Earth_-_Training_Plots.html#PLOT_ID';
    const read = await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) });
    expect(read.json()).toEqual({ imagery: { open_earth_map: 'true', open_gee_app: 'true', extra_map_url: extra } });
    expect((await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.projectToken), payload: { open_earth_map: 'false' } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.adminToken), payload: { open_earth_map: 'no' } })).statusCode).toBe(400);

    const before = propertiesOf((await ctx.store.getCep(p.projectId))!);
    const res = await ctx.app.inject({ method: 'PUT', url: url(), headers: bearer(p.adminToken), payload: { open_earth_map: 'false', open_esri_wayback: 'true' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().imagery).toEqual({ open_earth_map: 'false', open_gee_app: 'true', extra_map_url: extra, open_esri_wayback: 'true' });
    const after = propertiesOf((await ctx.store.getCep(p.projectId))!);
    // The line changed in place, the key the file lacked added at its end, every other byte kept
    expect(after.startsWith(before.replace('open_earth_map=true', 'open_earth_map=false'))).toBe(true);
    expect(after.trimEnd().endsWith('open_esri_wayback=true')).toBe(true);
    expect((await ctx.app.inject({ method: 'GET', url: url(), headers: bearer(p.projectToken) })).json().imagery.open_esri_wayback).toBe('true');
    expect(JSON.stringify(await ctx.store.listAudit(p.projectId, { limit: 10 }))).toContain('"setting":"imagery"');
  });
});
