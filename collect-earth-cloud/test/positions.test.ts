import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPositionKey } from '../src/positions.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('the answers that say where a plot is', () => {
  it('are the coordinates, and the columns named latitude, longitude, easting or northing', () => {
    for (const key of ['collect_coord_location', 'collect_real_latitude', 'collect_real_longitude', 'collect_text_plot_lat', 'collect_real_lon', 'collect_real_lng',
      'collect_real_utm_easting', 'collect_real_northing', 'collect_text_coordinates', 'collect_coord_tree[1].collect_coord_position', 'collect_entity_tree[1].collect_real_tree_latitude']) {
      expect(isPositionKey(key), key).toBe(true);
    }
  });

  it('are words, not letters: a translation, a colony, a slope or an aspect is no place', () => {
    for (const key of ['collect_text_translation', 'collect_code_colony', 'collect_real_slope', 'collect_real_aspect', 'collect_integer_elevation', 'collect_code_plot_distribution',
      'collect_code_land_use_category', 'collect_text_id', 'collect_text_operator', 'collect_text_comments', 'collect_code_long_term']) {
      expect(isPositionKey(key), key).toBe(false);
    }
  });
});

describe('downloading without the plots\' locations', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let pid: string;
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Secret plots')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const summary = { collect_text_id: '1', collect_coord_location: '-12.5,34.25', collect_real_latitude: '-12.5', collect_real_longitude: '34.25', collect_code_land_use: 'F', collect_real_slope: '7' };
    const res = await batchRequest(ctx.app, pid, owner.token, [envelope({ recordKey: '1', operator: 'owner', modifiedOn: 1000, summary })]);
    expect(res.statusCode, res.body).toBe(200);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const header = async (query: string) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/export.csv${query}`, headers: bearer(owner.token) });
    expect(res.statusCode, res.body).toBe(200);
    const text = res.rawPayload.subarray(3).toString('utf8');
    return { columns: text.split('\r\n')[0].split(','), text };
  };

  it('leaves the coordinates out of the data download, keeps the answers, and logs which download it was', async () => {
    const all = await header('');
    expect(all.columns).toEqual(expect.arrayContaining(['collect_coord_location', 'collect_real_latitude', 'collect_real_longitude', 'collect_code_land_use']));
    const without = await header('?coordinates=none');
    expect(without.columns).toEqual(expect.arrayContaining(['collect_code_land_use', 'collect_real_slope']));
    for (const c of ['collect_coord_location', 'collect_real_latitude', 'collect_real_longitude']) expect(without.columns).not.toContain(c);
    expect(without.text).not.toContain('34.25');
    const log = await ctx.store.listAudit(pid, { limit: 10 });
    expect(log.map((e) => e.details)).toEqual(expect.arrayContaining([{ records: 1 }, { records: 1, coordinates: false }]));
  });
});
