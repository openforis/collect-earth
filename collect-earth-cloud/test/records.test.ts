import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { MAX_SUMMARY_KEY_CHARS, MAX_SUMMARY_KEYS, MAX_SUMMARY_VALUE_CHARS } from '../src/routes/records.js';

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

  it('keeps the answers of a summary with empty attributes: a null is kept as a blank answer, the strings stay', async () => {
    // Collect Earth's getValuesByHtmlParameters gives null for every empty attribute.
    const res = await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({
        recordKey: '1',
        summary: { collect_code_land_use_category: 'F', collect_text_comments: null, collect_code_subdivision: 'EB' } as never,
      }),
      envelope({ recordKey: '2', summary: { collect_code_land_use_category: null } as never }),
    ]);
    expect((res.json() as BatchResponse).results.map((r) => r.status)).toEqual(['stored', 'stored']);
    const stored = await ctx.store.listRecords(project.projectId);
    // Blank, not left out: a required question left empty is then told from one the survey of the record did not have.
    expect(stored.find((r) => r.recordKey === '1')!.summary).toEqual({ collect_code_land_use_category: 'F', collect_text_comments: '', collect_code_subdivision: 'EB' });
    expect(stored.find((r) => r.recordKey === '2')!.summary).toEqual({ collect_code_land_use_category: '' });
  });

  it('a summary value that is not a string is left out, the rest of the summary is kept', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ summary: { a: 'x', b: 3, c: true, d: { e: 'f' }, g: ['h'] } as never }),
    ]);
    expect((await ctx.store.listRecords(project.projectId))[0].summary).toEqual({ a: 'x' });
  });

  it('a summary that is not an object is stored empty, and the record is kept', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope({ summary: ['a'] as never }), envelope({ recordKey: '2', summary: 'a' as never })]);
    const stored = await ctx.store.listRecords(project.projectId);
    expect(stored.map((r) => r.summary)).toEqual([{}, {}]);
  });

  it('caps the summary: too long a key or value is left out, and keys past the limit too', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_SUMMARY_KEYS + 5; i++) many[`k${String(i).padStart(5, '0')}`] = 'v';
    const fits = 'x'.repeat(MAX_SUMMARY_VALUE_CHARS);
    const keyFits = 'k'.repeat(MAX_SUMMARY_KEY_CHARS);
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ summary: many }),
      envelope({
        recordKey: '2',
        summary: { fits, too_long: `${fits}x`, [keyFits]: 'v', [`${keyFits}k`]: 'v', '': 'v' },
      }),
    ]);
    const stored = await ctx.store.listRecords(project.projectId);
    const first = stored.find((r) => r.recordKey === '1')!.summary;
    expect(Object.keys(first)).toHaveLength(MAX_SUMMARY_KEYS);
    expect(first.k00000).toBe('v');
    expect(first[`k${String(MAX_SUMMARY_KEYS).padStart(5, '0')}`]).toBeUndefined();
    expect(stored.find((r) => r.recordKey === '2')!.summary).toEqual({ fits, [keyFits]: 'v' });
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

  describe('a record stored under the operator name before records went by the username', () => {
    async function member(username: string): Promise<string> {
      const invite = await ctx.app.inject({
        method: 'POST',
        url: `/v1/projects/${project.projectId}/invites`,
        headers: bearer(project.adminToken),
        payload: { role: 'operator', maxUses: 1 },
      });
      const reg = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
      return reg.json().token as string;
    }
    async function legacy(recordKey: string, operator: string, modifiedOn: number, xml: string) {
      await ctx.store.putRecord({
        projectId: project.projectId,
        recordKey,
        operator,
        modifiedOn,
        receivedAt: modifiedOn,
        activelySaved: true,
        step: 1,
        xml,
        summary: { a: xml },
        deleted: false,
        deletedOn: null,
      });
    }
    const rows = async () =>
      (await ctx.store.listRecords(project.projectId, true))
        .map((r) => [r.recordKey, r.operator, r.xml, r.deleted])
        .sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));

    it('moves to the username on its next save', async () => {
      const juan = await member('juan');
      await legacy('7', 'Juan Perez', 1000, '<old/>');
      const res = await batchRequest(ctx.app, project.projectId, juan, [envelope({ recordKey: '7', operator: 'Juan Perez', modifiedOn: 2000, xml: '<new/>' })]);
      expect((res.json() as BatchResponse).results[0].status).toBe('stored');
      expect(await rows()).toEqual([['7', 'juan', '<new/>', false]]);
    });

    it('is deleted by a deletion sent with the old name', async () => {
      const juan = await member('juan');
      await legacy('7', 'Juan Perez', 1000, '<old/>');
      await batchRequest(ctx.app, project.projectId, juan, [envelope({ recordKey: '7', operator: 'Juan Perez', modifiedOn: 2000, xml: null, deleted: true })]);
      expect(await rows()).toEqual([['7', 'juan', '<old/>', true]]);
    });

    it('when the username has a row too, both are kept and the save goes to the username', async () => {
      const juan = await member('juan');
      await legacy('7', 'Juan Perez', 3000, '<legacy-newer/>');
      await legacy('7', 'juan', 2000, '<mine/>');
      // Merging the two deleted one of them, which a forged operator name made someone else's record
      const res = await batchRequest(ctx.app, project.projectId, juan, [envelope({ recordKey: '7', operator: 'Juan Perez', modifiedOn: 2500, xml: '<late/>' })]);
      expect((res.json() as BatchResponse).results[0].status).toBe('stored');
      expect(await rows()).toEqual([
        ['7', 'juan', '<late/>', false],
        ['7', 'Juan Perez', '<legacy-newer/>', false],
      ]);
    });

    it("never takes a former member's or a deleted account's record, nor deletes it", async () => {
      const bob = await member('bob');
      const mallory = await member('mallory');
      await legacy('5', 'bob', 1000, '<bob/>');
      // bob leaves the project: his records stay, under his username
      const bobId = (await ctx.store.getUserByUsername('bob'))!.id;
      await ctx.store.removeMember(project.projectId, bobId);
      expect(bob).toBeTruthy();
      await batchRequest(ctx.app, project.projectId, mallory, [envelope({ recordKey: '5', operator: 'bob', modifiedOn: 2000, xml: '<mallory/>' })]);
      expect(await rows()).toEqual([
        ['5', 'bob', '<bob/>', false],
        ['5', 'mallory', '<mallory/>', false],
      ]);
      // her own copy far in the future first, then the name again: nothing of his is deleted
      await batchRequest(ctx.app, project.projectId, mallory, [envelope({ recordKey: '5', operator: 'bob', modifiedOn: 9_000_000, xml: '<again/>' })]);
      expect((await rows()).find((r) => r[1] === 'bob')).toEqual(['5', 'bob', '<bob/>', false]);
      // nor once his account is gone (its username retired)
      await member('carla');
      await legacy('6', 'carla', 1000, '<carla/>');
      await ctx.store.deleteUser((await ctx.store.getUserByUsername('carla'))!.id);
      await batchRequest(ctx.app, project.projectId, mallory, [envelope({ recordKey: '6', operator: 'carla', modifiedOn: 2000, xml: '<m/>' })]);
      expect((await rows()).filter((r) => r[0] === '6').map((r) => r[1])).toEqual(['carla', 'mallory']);
    });

    it("never takes another member's own record", async () => {
      await member('maria');
      const bob = await member('bob');
      await legacy('9', 'maria', 1000, '<maria/>');
      await batchRequest(ctx.app, project.projectId, bob, [envelope({ recordKey: '9', operator: 'maria', modifiedOn: 2000, xml: '<bob/>' })]);
      expect(await rows()).toEqual([
        ['9', 'bob', '<bob/>', false],
        ['9', 'maria', '<maria/>', false],
      ]);
    });
  });
});

describe('renameRecordOperator (memory store)', () => {
  it('is false without a row under the old name, and bumps the quality version when it moves one', async () => {
    const ctx = await makeContext();
    try {
      const p = await createProject(ctx.app);
      expect(await ctx.store.renameRecordOperator(p.projectId, '1', 'a', 'b')).toBe(false);
      await ctx.store.putRecord({ projectId: p.projectId, recordKey: '1', operator: 'a', modifiedOn: 1, receivedAt: 1, activelySaved: true, step: 1, xml: '<a/>', summary: {}, deleted: false, deletedOn: null });
      const before = await ctx.store.qualityVersion(p.projectId);
      expect(await ctx.store.renameRecordOperator(p.projectId, '1', 'a', 'a')).toBe(false);
      expect(await ctx.store.renameRecordOperator(p.projectId, '1', 'a', 'b')).toBe(true);
      expect(await ctx.store.qualityVersion(p.projectId)).not.toBe(before);
      expect((await ctx.store.listRecords(p.projectId)).map((r) => r.operator)).toEqual(['b']);
    } finally {
      await ctx.app.close();
    }
  });
});
