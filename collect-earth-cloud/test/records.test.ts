import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

interface BatchResponse {
  results: { recordKey: string; status: string; reason?: string }[];
}

describe('records:batch — gzip, LWW and tombstones', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Sync project');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('routes the literal records:batch path and decompresses the gzipped body', async () => {
    const res = await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope()]);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BatchResponse;
    expect(body.results).toEqual([{ recordKey: '1', status: 'stored' }]);

    const stored = await ctx.store.listRecords(project.projectId);
    expect(stored).toHaveLength(1);
    expect(stored[0].xml).toBe('<record/>');
    expect(stored[0].operator).toBe('maria');
  });

  it('newer modifiedOn wins, older is reported stale and does not overwrite', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ modifiedOn: 2000, xml: '<v2/>' }),
    ]);
    const res = await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ modifiedOn: 1000, xml: '<v1/>' }),
    ]);
    const body = res.json() as BatchResponse;
    expect(body.results[0].status).toBe('stale');

    const stored = await ctx.store.listRecords(project.projectId);
    expect(stored[0].xml).toBe('<v2/>');
  });

  it('records from two operators on the same plot do not clobber each other', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ operator: 'maria', xml: '<maria/>' }),
      envelope({ operator: 'juan', xml: '<juan/>' }),
    ]);
    const stored = await ctx.store.listRecords(project.projectId);
    expect(stored).toHaveLength(2);
    expect(stored.map((r) => r.operator).sort()).toEqual(['juan', 'maria']);
  });

  it('a tombstone soft-deletes and the record drops out of the default listing', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope({ modifiedOn: 1000 })]);
    const del = await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ modifiedOn: 2000, deleted: true, xml: null }),
    ]);
    expect((del.json() as BatchResponse).results[0].status).toBe('stored');

    expect(await ctx.store.listRecords(project.projectId)).toHaveLength(0);
    expect(await ctx.store.listRecords(project.projectId, true)).toHaveLength(1);
    const [row] = await ctx.store.listRecords(project.projectId, true);
    expect(row.deleted).toBe(true);
    expect(row.deletedOn).toBe(2000);
  });

  it('a re-upload newer than the tombstone resurrects the record', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ modifiedOn: 2000, deleted: true, xml: null }),
    ]);
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ modifiedOn: 3000, deleted: false, xml: '<alive/>' }),
    ]);
    const stored = await ctx.store.listRecords(project.projectId);
    expect(stored).toHaveLength(1);
    expect(stored[0].xml).toBe('<alive/>');
  });

  it('a malformed envelope is reported as error without failing the batch', async () => {
    const res = await batchRequest(ctx.app, project.projectId, project.projectToken, [
      {} as never,
      envelope({ recordKey: '2' }),
    ]);
    const body = res.json() as BatchResponse;
    expect(body.results[0].status).toBe('error');
    expect(body.results[1].status).toBe('stored');
  });

  it('with a user session, records are stored under its username whatever operator they name', async () => {
    const invite = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${project.projectId}/invites`,
      headers: bearer(project.adminToken),
      payload: { role: 'operator', maxUses: 1 },
    });
    const reg = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'bob', password: 'password12', inviteToken: invite.json().inviteToken } });
    const bob = reg.json().token as string;
    // Bob changed his operator name in Collect Earth, or tries to write as maria.
    const res = await batchRequest(ctx.app, project.projectId, bob, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: 2000, xml: '<as-maria/>' }),
      envelope({ recordKey: '2', operator: 'Bob B.', modifiedOn: 2000 }),
      envelope({ recordKey: '3', operator: 'bob', modifiedOn: 2000 }),
    ]);
    expect((res.json() as BatchResponse).results).toEqual([
      { recordKey: '1', status: 'stored' },
      { recordKey: '2', status: 'stored' },
      { recordKey: '3', status: 'stored' },
    ]);
    let stored = await ctx.store.listRecords(project.projectId);
    expect(stored.map((r) => [r.recordKey, r.operator])).toEqual([
      ['1', 'bob'],
      ['2', 'bob'],
      ['3', 'bob'],
    ]);
    // Last-write-wins goes by the username too: an older re-send under another name is stale.
    const older = await batchRequest(ctx.app, project.projectId, bob, [envelope({ recordKey: '1', operator: 'someone', modifiedOn: 1000, xml: '<old/>' })]);
    expect((older.json() as BatchResponse).results[0].status).toBe('stale');
    stored = await ctx.store.listRecords(project.projectId);
    expect(stored.find((r) => r.recordKey === '1')!.xml).toBe('<as-maria/>');
    // A project token keeps the operator it sends.
    await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope({ recordKey: '4', operator: 'juan' })]);
    expect((await ctx.store.listRecords(project.projectId)).find((r) => r.recordKey === '4')!.operator).toBe('juan');
  });
});
