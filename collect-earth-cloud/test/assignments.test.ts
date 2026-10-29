import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { demoCep, idOnlyCep } from './fixtures/cep.js';

async function createInvite(app: FastifyInstance, pid: string, adminToken: string, role: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/projects/${pid}/invites`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { role, maxUses: 5 },
  });
  return res.json().inviteToken as string;
}

async function registerUser(
  app: FastifyInstance,
  pid: string,
  adminToken: string,
  role: string,
  username: string,
): Promise<{ userId: string; token: string }> {
  const invite = await createInvite(app, pid, adminToken, role);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { username, password: 'password12', inviteToken: invite },
  });
  return { userId: res.json().userId as string, token: res.json().token as string };
}

function uploadCsv(app: FastifyInstance, pid: string, adminToken: string, filename: string, content: string) {
  return app.inject({
    method: 'PUT',
    url: `/v1/projects/${pid}/csv-files/${filename}`,
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'text/csv' },
    payload: content,
  });
}

describe('CSV files and assignments', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Assignment project');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('uploads a CSV and reports checksum + plot count', async () => {
    const res = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'plots_a.csv',
      'id,lat,lon\n1,0,0\n2,1,1\n3,2,2\n');
    expect(res.statusCode).toBe(201);
    expect(res.json().filename).toBe('plots_a.csv');
    expect(res.json().plotCount).toBe(3);
    expect(res.json().checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assigns a CSV to an operator who then sees it in my-assignment and can download it', async () => {
    const maria = await registerUser(ctx.app, project.projectId, project.adminToken, 'operator', 'maria');
    const csv = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'north.csv', 'id,lat,lon\n1,0,0\n');
    const csvFileId = csv.json().id as string;

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/assignments`,
      headers: { authorization: `Bearer ${project.adminToken}` },
      payload: { assignments: [{ userId: maria.userId, csvFileId }] },
    });
    expect(put.json()).toEqual({ ok: true, count: 1 });

    const mine = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/my-assignment`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(mine.json().assignments).toHaveLength(1);
    expect(mine.json().assignments[0]).toMatchObject({ csvFileId, filename: 'north.csv' });

    const download = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files/${csvFileId}/content`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['x-checksum-sha256']).toBe(csv.json().checksum);
    expect(download.body).toContain('id,lat,lon');
  });

  it('rejects a CSV upload with a path-traversal filename', async () => {
    // Some malicious names are rejected by the handler (400), others are collapsed by
    // URL normalisation before routing (404). Either way the security property holds:
    // the upload never succeeds, so no traversal filename is ever stored.
    for (const bad of ['..', '%2e%2e', 'a..b', 'x%2Fy', 'evil%00.csv']) {
      const res = await ctx.app.inject({
        method: 'PUT',
        url: `/v1/projects/${project.projectId}/csv-files/${bad}`,
        headers: { authorization: `Bearer ${project.adminToken}`, 'content-type': 'text/csv' },
        payload: 'id\n1\n',
      });
      expect([400, 404], bad).toContain(res.statusCode);
    }
    // handler-reachable case is specifically a 400
    const direct = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/csv-files/a..b`,
      headers: { authorization: `Bearer ${project.adminToken}`, 'content-type': 'text/csv' },
      payload: 'id\n1\n',
    });
    expect(direct.statusCode).toBe(400);
    // and nothing traversal-named got stored
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files`,
      headers: { authorization: `Bearer ${project.adminToken}` },
    });
    expect(list.json().csvFiles).toHaveLength(0);
  });

  it('an operator cannot download a CSV that is not assigned to them (404)', async () => {
    const maria = await registerUser(ctx.app, project.projectId, project.adminToken, 'operator', 'maria');
    const csv = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'secret.csv', 'id,lat,lon\n1,0,0\n');
    const csvFileId = csv.json().id as string;
    // no assignment made
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files/${csvFileId}/content`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('re-uploading a CSV by the same filename keeps one entry and updates the checksum', async () => {
    await uploadCsv(ctx.app, project.projectId, project.adminToken, 'plots.csv', 'id\n1\n');
    const second = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'plots.csv', 'id\n1\n2\n');
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files`,
      headers: { authorization: `Bearer ${project.adminToken}` },
    });
    expect(list.json().csvFiles).toHaveLength(1);
    expect(list.json().csvFiles[0].checksum).toBe(second.json().checksum);
    expect(list.json().csvFiles[0].plotCount).toBe(2);
  });

  it('replacing the assignment set removes prior assignments', async () => {
    const maria = await registerUser(ctx.app, project.projectId, project.adminToken, 'operator', 'maria');
    const a = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'a.csv', 'id\n1\n');
    const b = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'b.csv', 'id\n1\n');

    const assign = (csvFileId: string) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/v1/projects/${project.projectId}/assignments`,
        headers: { authorization: `Bearer ${project.adminToken}` },
        payload: { assignments: [{ userId: maria.userId, csvFileId }] },
      });

    await assign(a.json().id);
    await assign(b.json().id); // replaces a with b
    const mine = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/my-assignment`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(mine.json().assignments).toHaveLength(1);
    expect(mine.json().assignments[0].filename).toBe('b.csv');
  });
});

describe('plot files served with a round column', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  let pid: string;
  let admin: string;
  let maria: { userId: string; token: string };
  let jose: { userId: string; token: string };

  const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
  const putCep = async (body: Buffer) => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/cep`,
      headers: { ...bearer(admin), 'content-type': 'application/zip' },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().round as { state: string; reassessmentCode: string | null };
  };
  const upload = async (filename: string, content: string) =>
    (await uploadCsv(ctx.app, pid, admin, filename, content)).json().id as string;
  const assign = (userId: string, csvFileId: string) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/assignments`,
      headers: bearer(admin),
      payload: { assignments: [{ userId, csvFileId }] },
    });
  const divide = (csvFileId: string, people: string[], overlapPercent = 0) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/${csvFileId}/distribution`,
      headers: bearer(admin),
      payload: { mode: 'even', people, order: 'file', overlapPercent },
    });
  const myAssignment = async (token: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/my-assignment`, headers: bearer(token) })).json()
      .assignments as { csvFileId: string; checksum: string; plotCount: number; downloadPath: string }[];
  const download = (token: string, path: string) => ctx.app.inject({ method: 'GET', url: path, headers: bearer(token) });
  const contentPath = (csvFileId: string, query = '') => `/v1/projects/${pid}/csv-files/${csvFileId}/content${query}`;
  /** The file my-assignment lists for this person, downloaded and checked against its checksum. */
  const served = async (token: string, csvFileId: string) => {
    const entry = (await myAssignment(token)).find((a) => a.csvFileId === csvFileId)!;
    const res = await download(token, entry.downloadPath);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-checksum-sha256']).toBe(entry.checksum);
    expect(sha256(res.rawPayload)).toBe(entry.checksum);
    return { entry, body: res.body };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Round column project');
    pid = project.projectId;
    admin = project.adminToken;
    maria = await registerUser(ctx.app, pid, admin, 'operator', 'maria');
    jose = await registerUser(ctx.app, pid, admin, 'operator', 'jose');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('with the round the server added, a whole file gets round 1 on every plot', async () => {
    expect((await putCep(idOnlyCep())).state).toBe('added');
    const csv = 'id,lat,lon,wkt\n1,0,0,"POLYGON((0 0,\n 1 1))"\n2,1,1,x\n';
    const id = await upload('north.csv', csv);
    await assign(maria.userId, id);
    const built = 'id,round,lat,lon,wkt\n1,1,0,0,"POLYGON((0 0,\n 1 1))"\n2,1,1,1,x\n';

    const { entry, body } = await served(maria.token, id);
    expect(entry).toMatchObject({ plotCount: 2, downloadPath: contentPath(id, '?mine=1') });
    expect(body).toBe(built);
    // A collector gets the same file without ?mine=1.
    const plain = await download(maria.token, contentPath(id));
    expect(plain.body).toBe(built);
    expect(plain.headers['x-checksum-sha256']).toBe(sha256(built));
    // An admin gets the uploaded file, or with ?mine=1 the one collectors get.
    const full = await download(admin, contentPath(id));
    expect(full.body).toBe(csv);
    expect(full.headers['x-checksum-sha256']).toBe(sha256(csv));
    const adminMine = await download(admin, contentPath(id, '?mine=1'));
    expect(adminMine.body).toBe(built);
    expect(adminMine.headers['x-checksum-sha256']).toBe(sha256(built));
    // Still nothing for someone the file is not given to.
    expect((await download(jose.token, contentPath(id, '?mine=1'))).statusCode).toBe(404);
  });

  it('with the round the server added, a divided file gets round 2 on the quality-check copies', async () => {
    expect((await putCep(idOnlyCep())).state).toBe('added');
    const csv = 'id;lat;lon\r\n1;0;0\r\n2;0;0\r\n3;0;0\r\n4;0;0\r\n4;1;1';
    const id = await upload('plots.csv', csv);
    expect((await divide(id, [maria.userId, jose.userId], 50)).statusCode).toBe(200);
    const holdings = await ctx.store.listPlotAssignments(pid, id);
    for (const person of [maria, jose]) {
      const mine = holdings.filter((h) => h.userId === person.userId);
      const copies = mine.filter((h) => h.overlap).map((h) => h.plotKey);
      expect(copies.length).toBeGreaterThan(0);
      const { entry, body } = await served(person.token, id);
      expect(entry.plotCount).toBe(mine.length);
      // A row that ends the file but not the upload keeps its line break.
      const rows = body.split('\r\n').filter((r) => r.length > 0);
      expect(rows[0]).toBe('id;round;lat;lon');
      for (const row of rows.slice(1)) {
        const [plot, round] = row.split(';');
        expect(round, row).toBe(copies.includes(plot) ? '2' : '1');
      }
      expect(rows.slice(1).map((r) => r.split(';')[0])).toEqual(
        ['1', '2', '3', '4', '4'].filter((p) => mine.some((h) => h.plotKey === p)),
      );
    }
    // The admin's full file is the upload.
    expect((await download(admin, contentPath(id))).body).toBe(csv);
  });

  it('with a survey of its own round and a reassessment code, the copies get that code', async () => {
    expect(await putCep(demoCep())).toMatchObject({ state: 'own', reassessmentCode: '2' });
    const csv = 'id,round,lat,lon\n17,1,0,0\n18,1,0,0\n19,1,0,0\n20,1,0,0\n';
    const id = await upload('own.csv', csv);
    expect((await divide(id, [maria.userId, jose.userId], 50)).statusCode).toBe(200);
    const holdings = await ctx.store.listPlotAssignments(pid, id);
    const copies = holdings.filter((h) => h.userId === maria.userId && h.overlap).map((h) => h.plotKey);
    expect(copies.length).toBeGreaterThan(0);
    const { body } = await served(maria.token, id);
    const rows = body.split('\n').slice(1, -1);
    expect(rows).toHaveLength(holdings.filter((h) => h.userId === maria.userId).length);
    for (const row of rows) {
      const [plot, value] = row.split(',');
      expect(value, row).toBe(copies.includes(`${plot},1`) ? '2' : '1');
    }
    // A whole file has no copies: it is served as uploaded.
    const whole = await upload('whole.csv', csv);
    await assign(maria.userId, whole);
    expect((await served(maria.token, whole)).body).toBe(csv);
  });

  it('a project without round serves plot files exactly as uploaded (whole) or as before (divided)', async () => {
    // Records first: the server then leaves the id-only survey as it is.
    await batchRequest(ctx.app, pid, project.projectToken, [envelope()]);
    expect((await putCep(idOnlyCep())).state).toBe('none');
    const csv = 'id,lat,lon\n1,0,0\n2,1,1\n3,2,2\n';
    const whole = await upload('whole.csv', csv);
    await assign(maria.userId, whole);
    expect((await myAssignment(maria.token))[0]).toMatchObject({
      checksum: sha256(csv),
      downloadPath: contentPath(whole),
      plotCount: 3,
    });
    expect((await served(maria.token, whole)).body).toBe(csv);
    expect((await download(admin, contentPath(whole, '?mine=1'))).body).toBe(csv);

    const divided = await upload('divided.csv', csv);
    expect((await divide(divided, [maria.userId, jose.userId], 50)).statusCode).toBe(200);
    const holdings = await ctx.store.listPlotAssignments(pid, divided);
    const joseKeys = holdings.filter((h) => h.userId === jose.userId).map((h) => h.plotKey);
    const expected = 'id,lat,lon\n' + ['1,0,0\n', '2,1,1\n', '3,2,2\n'].filter((r) => joseKeys.includes(r[0])).join('');
    expect((await served(jose.token, divided)).body).toBe(expected);
  });

  it('a survey with its own round and no reassessment code serves plot files as uploaded', async () => {
    await putCep(demoCep());
    const setCode = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/round`,
      headers: bearer(admin),
      payload: { reassessmentCode: null },
    });
    expect(setCode.statusCode).toBe(200);
    const csv = 'id,round,lat,lon\n17,1,0,0\n18,1,0,0\n';
    const id = await upload('own.csv', csv);
    await assign(maria.userId, id);
    expect((await myAssignment(maria.token))[0]).toMatchObject({ checksum: sha256(csv), downloadPath: contentPath(id) });
    expect((await served(maria.token, id)).body).toBe(csv);
  });
});
