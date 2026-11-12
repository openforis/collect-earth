import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// A coordinator (role admin) who is also given plots collects them like anyone else:
// the plots reach Collect Earth (my-assignment, then the file's content) and their
// work counts in the project's figures.

const CSV = 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const plotsOf = (body: string) => body.split('\n').slice(1).filter((l) => /^\d+,/.test(l)).map((l) => l.split(',')[0]);

describe('a coordinator who collects', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let fileId: string;

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const myAssignment = async (token: string) => (await call('GET', '/my-assignment', token)).json().assignments;
  const download = (token: string, path: string) => ctx.app.inject({ method: 'GET', url: path, headers: bearer(token) });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Coordinator collects' } })).json().projectId;
    const invite = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1 });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: 'maria', password: 'password12', inviteToken: invite.json().inviteToken },
    });
    maria = { userId: res.json().userId, token: res.json().token };
    fileId = (await call('PUT', '/csv-files/plots.csv', owner.token, CSV, { 'content-type': 'text/csv' })).json().id;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  for (const withCep of [false, true]) {
    it(`a whole file given to the coordinator is listed and served to them${withCep ? ' (with a project file)' : ''}`, async () => {
      if (withCep) await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
      expect((await call('PUT', '/assignments', owner.token, { assignments: [{ userId: owner.userId, csvFileId: fileId }] })).statusCode).toBe(200);
      const mine = await myAssignment(owner.token);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ csvFileId: fileId, filename: 'plots.csv', plotCount: 4 });
      const res = await download(owner.token, mine[0].downloadPath);
      expect(res.statusCode).toBe(200);
      expect(sha256(res.rawPayload)).toBe(mine[0].checksum);
      expect(plotsOf(res.body)).toEqual(['1', '2', '3', '4']);
    });

    it(`a coordinator holding a share of a divided file gets only their plots${withCep ? ' (with a project file)' : ''}`, async () => {
      if (withCep) await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
      const divided = await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [owner.userId, maria.userId], order: 'file' });
      expect(divided.statusCode).toBe(200);
      const mine = await myAssignment(owner.token);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ csvFileId: fileId, plotCount: 2 });
      const res = await download(owner.token, mine[0].downloadPath);
      expect(res.statusCode).toBe(200);
      expect(sha256(res.rawPayload)).toBe(mine[0].checksum);
      expect(plotsOf(res.body)).toEqual(['1', '2']);
      // The whole file is still the coordinator's to download from the dashboard.
      expect(plotsOf((await download(owner.token, `/v1/projects/${pid}/csv-files/${fileId}/content`)).body)).toEqual(['1', '2', '3', '4']);
    });
  }

  it("the coordinator's own plots count in Progress, People, their person page and My work", async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [owner.userId, maria.userId], order: 'file' });
    await batchRequest(ctx.app, pid, owner.token, [envelope({ recordKey: '1', operator: 'owner', modifiedOn: Date.now(), activelySaved: true })]);

    const progress = (await call('GET', '/progress', owner.token)).json();
    expect(progress.totals.submitted).toBe(1);
    const people = (await call('GET', '/people', owner.token)).json();
    const row = people.people.find((p: { username: string }) => p.username === 'owner');
    expect(row.plots).toMatchObject({ assigned: 2, submitted: 1, remaining: 1 });
    expect(row.status.kind).not.toBe('noPlots');
    const page = (await call('GET', `/people/${owner.userId}`, owner.token)).json();
    expect(page.person.plots).toMatchObject({ assigned: 2, submitted: 1 });
    const myWork = (await call('GET', '/my-work', owner.token)).json();
    expect(myWork.person.plots).toMatchObject({ assigned: 2, submitted: 1 });
    const shares = (await call('GET', `/csv-files/${fileId}/distribution`, owner.token)).json();
    expect(shares.people.find((p: { userId: string }) => p.userId === owner.userId)).toMatchObject({ plots: 2, submitted: 1 });
  });
});
