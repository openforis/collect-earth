import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { divide, fileAssignment, parseDivisionRequest, percentSizes } from '../src/division.js';
import { parsePlotFile, withoutColumns } from '../src/plots.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

describe('percentSizes', () => {
  it('gives each person their percent of the plots, the remainders to the largest fractions, earlier first on ties', () => {
    expect(percentSizes([0, 0, 0], 10, [50, 30, 20])).toEqual([5, 3, 2]);
    // 7 plots: 3.5 / 3.5 -> the earlier one takes the odd plot.
    expect(percentSizes([0, 0], 7, [50, 50])).toEqual([4, 3]);
    // 10 plots: 3.33 each -> 4/3/3.
    expect(percentSizes([0, 0, 0], 10, [100 / 3, 100 / 3, 100 / 3])).toEqual([4, 3, 3]);
    expect(percentSizes([0, 0], 5, [100, 0])).toEqual([5, 0]);
  });
  it('counts the plots already someone`s, and takes from the others when one holds more than their share', () => {
    // 10 plots, a holds 2 already: a 5 in all, b 5.
    expect(percentSizes([2, 0], 8, [50, 50])).toEqual([3, 5]);
    // a holds 6 but is owed 2: b (owed 6) takes the 4 others, c (owed 2) none.
    expect(percentSizes([6, 0, 0], 4, [20, 60, 20])).toEqual([0, 4, 0]);
  });
});

describe('divide by percent', () => {
  it('deals each person their share, in chunks of the file order', () => {
    const plots = divide({ mode: 'even', people: ['a', 'b'], percents: [70, 30], order: 'file', overlapPercent: 0 }, ids(10), null, new Map());
    expect(plots.filter((p) => p.userId === 'a').map((p) => p.plotKey)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(plots.filter((p) => p.userId === 'b').map((p) => p.plotKey)).toEqual(['8', '9', '10']);
  });
});

describe('parseDivisionRequest: percents', () => {
  const parse = (body: unknown) => parseDivisionRequest(body, new Set(['a', 'b']), 5, () => 7);
  it('takes one percent per person adding up to 100', () => {
    expect(parse({ mode: 'even', people: ['a', 'b'], percents: [60, 40] })).toEqual({ mode: 'even', people: ['a', 'b'], percents: [60, 40], order: 'file', overlapPercent: 0 });
    expect(parse({ mode: 'even', people: ['a', 'b'], percents: [60, 30] })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a', 'b'], percents: [100] })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a', 'b'], percents: [120, -20] })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a', 'a'], percents: [50, 50] })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a', 'b'], percents: ['x', 50] })).toHaveProperty('reason');
    // Without percents: even, as before.
    expect(parse({ mode: 'even', people: ['a', 'b'] })).not.toHaveProperty('percents');
  });
});

describe('fileAssignment: the user and reviewers columns', () => {
  const people = [
    { userId: 'u1', username: 'maria', email: 'maria@example.org' },
    { userId: 'u2', username: 'jose', email: null },
    { userId: 'u3', username: 'ana', email: 'Ana@Example.org' },
  ];
  const csv = (text: string) => parsePlotFile(Buffer.from(text), 1);

  it('is null without a user column', () => {
    expect(fileAssignment(csv('id,lat,lon,reviewers\n1,0,0,ana\n'), people, 1)).toBeNull();
    expect(fileAssignment(csv('1,0,0,maria\n'), people, 1)).toBeNull();
  });

  it('gives each plot to its user, by username or e-mail (case ignored), with checks for the reviewers', () => {
    const file = csv('id,lat,lon,User,reviewers\n1,0,0,maria,ana;jose\n2,0,0,JOSE,\n3,0,0,ana@example.org,maria|maria\n4,0,0,,ana\n2,1,1,maria,ana\n');
    const result = fileAssignment(file, people, 1)!;
    expect(result.columns).toEqual([3, 4]);
    expect(result.plots).toEqual([
      { plotKey: '1', userId: 'u1', overlap: false },
      { plotKey: '1', userId: 'u3', overlap: true },
      { plotKey: '1', userId: 'u2', overlap: true },
      { plotKey: '2', userId: 'u2', overlap: false },
      { plotKey: '3', userId: 'u3', overlap: false },
      { plotKey: '3', userId: 'u1', overlap: true },
    ]);
    // Plot 4 has no user: not given out (not an unknown name either).
    expect(result).toMatchObject({ assigned: 3, checks: 3, notAssigned: 1, unknown: [] });
  });

  it('lists unknown names and leaves their rows out; a user is never their own reviewer', () => {
    const file = csv('id,lat,lon,user,reviewers\n1,0,0,pedro,\n2,0,0,maria,ghost\n3,0,0,maria,maria;ana\n4,0,0,pedro,\n');
    const result = fileAssignment(file, people, 1)!;
    expect(result.unknown).toEqual(['pedro', 'ghost']);
    expect(result.plots).toEqual([
      { plotKey: '3', userId: 'u1', overlap: false },
      { plotKey: '3', userId: 'u3', overlap: true },
    ]);
    expect(result).toMatchObject({ assigned: 1, checks: 1, notAssigned: 3 });
  });
});

describe('withoutColumns', () => {
  it('drops the columns from every row, keeping every other byte', () => {
    const file = parsePlotFile(Buffer.from('﻿id;lat;lon;user;note;reviewers\r\n1;0;0;maria;"a;b";ana\r\n2;0;0;jose\r\n'), 1);
    expect(withoutColumns(file, [3, 5]).toString()).toBe('﻿id;lat;lon;note\r\n1;0;0;"a;b"\r\n2;0;0\r\n');
  });
});

async function registerUser(app: FastifyInstance, pid: string, adminToken: string, username: string, role = 'operator') {
  const invite = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(adminToken), payload: { role, maxUses: 1 } });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
  return { userId: res.json().userId as string, token: res.json().token as string };
}

describe('a plot file with a user column (routes)', () => {
  let ctx: TestContext;
  let pid: string;
  let admin: string;
  let maria: { userId: string; token: string };
  let jose: { userId: string; token: string };
  const upload = (content: string, filename = 'plots.csv') =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/${filename}`, headers: { ...bearer(admin), 'content-type': 'text/csv' }, payload: content });

  beforeEach(async () => {
    ctx = await makeContext();
    const project = await createProject(ctx.app, 'Assigned by file');
    pid = project.projectId;
    admin = project.adminToken;
    maria = await registerUser(ctx.app, pid, admin, 'maria');
    jose = await registerUser(ctx.app, pid, admin, 'jose');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('divides the file by it, gives the reviewers their checks, reports unknown names and serves the file without those columns', async () => {
    const res = await upload('id,lat,lon,user,reviewers\n1,0,0,maria,jose\n2,0,0,jose,\n3,0,0,nobody,\n');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ plotCount: 3, divided: true, assignment: { assigned: 2, checks: 1, notAssigned: 1, unknown: ['nobody'] } });
    const fileId = res.json().id;
    const dist = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/${fileId}/distribution`, headers: bearer(admin) })).json();
    expect(dist).toMatchObject({ distribution: { mode: 'manual' }, unassigned: 1 });
    const share = (name: string) => dist.people.find((p: { username: string }) => p.username === name);
    expect(share('maria')).toMatchObject({ plots: 1, overlap: 0 });
    expect(share('jose')).toMatchObject({ plots: 2, overlap: 1 });
    // The stored (and served) file has no user nor reviewers column.
    const full = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/${fileId}/content`, headers: bearer(admin) });
    expect(full.body).toBe('id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n');
    const mine = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/${fileId}/content`, headers: bearer(maria.token) });
    expect(mine.body).toBe('id,lat,lon\n1,0,0\n');
    const log = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/activity?kind=files`, headers: bearer(admin) })).json();
    expect(JSON.stringify(log)).toContain('division.applied');
  });

  it('a file without a user column is stored as it is and stays whole', async () => {
    const res = await upload('id,lat,lon,reviewers\n1,0,0,jose\n');
    expect(res.json()).not.toHaveProperty('assignment');
    expect(res.json().divided).toBeFalsy();
  });

  it('divides by percent through the distribution route', async () => {
    const fileId = (await upload('id,lat,lon\n' + ids(10).map((i) => `${i},0,0`).join('\n') + '\n')).json().id;
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/${fileId}/distribution`,
      headers: bearer(admin),
      payload: { mode: 'even', people: [maria.userId, jose.userId], percents: [80, 20] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().distribution).toMatchObject({ mode: 'even', percents: [80, 20] });
    expect(res.json().people.map((p: { plots: number }) => p.plots)).toEqual([8, 2]);
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/${fileId}/distribution`,
      headers: bearer(admin),
      payload: { mode: 'even', people: [maria.userId, jose.userId], percents: [80, 30] },
    });
    expect(bad.statusCode).toBe(400);
  });
});
