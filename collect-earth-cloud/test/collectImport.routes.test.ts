import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipCep } from '../src/cep.js';
import { FIXTURE_DATE, idOnlyCep } from './fixtures/cep.js';
import { applyLww } from '../src/lww.js';
import { bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

/** A record as Collect Earth's XML export writes it, of the demo survey (id only: the server adds round). */
const recordXml = (id: string, operator: string, submitted: boolean, modified: string) =>
  `<?xml version='1.0' standalone='yes' ?>
<plot step="1" created="2026-10-01T10:00:00.000+02:00" modified="${modified}">
  <id>
    <value>${id}</value>
  </id>
  <operator>
    <value>${operator}</value>
  </operator>
  <actively_saved>
    <value>${submitted}</value>
  </actively_saved>
</plot>
`;

/** The backup zip: the survey the desktop had (the uploaded one, without round), then the records. */
function backup(records: [string, string][], survey = strFromU8(unzipSync(idOnlyCep())['placemark.idm.xml'])): Buffer {
  return zipCep(new Map([['idml.xml', Buffer.from(survey)], ...records.map(([name, xml]): [string, Uint8Array] => [name, Buffer.from(xml)])]), FIXTURE_DATE);
}

describe('importing a Collect Earth backup', () => {
  let ctx: TestContext;
  let pid: string;
  let token: string;
  let other: string;

  beforeEach(async () => {
    ctx = await makeContext();
    const owner = await setupPlatformAdmin(ctx.app);
    token = owner.token;
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(token), payload: { name: 'Moved' } });
    pid = res.json().projectId;
    other = (await createProject(ctx.app)).adminToken;
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(token), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    expect(up.statusCode).toBe(200);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const post = (path: string, zip: Buffer, auth = token) =>
    ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/records/import${path}`, headers: { ...bearer(auth), 'content-type': 'application/zip' }, payload: zip });

  /** A record already in the project, as a sync stored it. */
  const seed = (recordKey: string, operator: string, modifiedOn: number) =>
    ctx.store.putRecordWithEvent(pid, recordKey, operator, () => ({ row: { ...applyLww(envelope({ recordKey, operator, modifiedOn }), null, modifiedOn).row, projectId: pid }, event: null }));
  /** An account, registered with an invite of another project. */
  const account = async (username: string, projectToken = other, projectId?: string) => {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId ?? (await ctx.store.resolveToken(projectToken))!.projectId}/invites`, headers: bearer(projectToken), payload: { role: 'operator' } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return res.json().token as string;
  };

  const zip = () =>
    backup([
      ['1/1.xml', recordXml('101', 'anna', true, '2026-10-02T10:00:00.000+02:00')],
      ['1/2.xml', recordXml('102', 'anna', false, '2026-10-02T11:00:00.000+02:00')],
      ['2/3.xml', recordXml('103', 'Bob Smith', true, '2026-10-02T12:00:00.000+02:00')],
      ['1/4.xml', recordXml('104', 'anna', true, '2026-10-02T13:00:00.000+02:00')],
      ['1/5.xml', '<plot><id>'],
    ]);

  it('previews without storing, then stores as a sync does: round added, operator, step, submitted; a newer cloud record is kept', async () => {
    // Already in the project: 101 newer there, 104 older there
    await seed('101,1', 'anna', Date.parse('2026-10-05T00:00:00Z'));
    await seed('104,1', 'anna', Date.parse('2026-09-01T00:00:00Z'));
    const preview = await post('/preview', zip());
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      records: 4, submitted: 3, drafts: 1, newRecords: 2, newerThere: 1, olderThere: 1, problemCount: 1, problems: ['1/5.xml: not valid XML'],
      operators: [{ name: 'anna', username: 'anna', records: 3, member: false }, { name: 'Bob Smith', username: 'Bob Smith', records: 1, member: false }],
    });
    expect((await ctx.store.listRecordStates(pid)).length).toBe(2);

    const res = await post('', zip());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stored: 3, kept: 1 });
    const kept = await ctx.store.getRecord(pid, '101,1', 'anna');
    expect(kept?.modifiedOn).toBe(Date.parse('2026-10-05T00:00:00Z'));
    const bob = await ctx.store.getRecord(pid, '103,1', 'Bob Smith');
    expect(bob).toMatchObject({ step: 2, activelySaved: true, modifiedOn: Date.parse('2026-10-02T12:00:00.000+02:00') });
    expect(bob?.summary).toMatchObject({ collect_text_id: '103', collect_code_round: '1', collect_text_operator: 'Bob Smith', collect_boolean_actively_saved: 'true' });
    expect(bob?.xml).toContain('<round>\n    <code>1</code>\n  </round>');
    expect((await ctx.store.getRecord(pid, '102,1', 'anna'))?.activelySaved).toBe(false);
    expect((await ctx.store.getRecord(pid, '104,1', 'anna'))?.modifiedOn).toBe(Date.parse('2026-10-02T13:00:00.000+02:00'));
    const audit = (await ctx.store.listAudit(pid, { limit: 50 })).find((e) => e.action === 'project.imported');
    expect(audit?.details).toMatchObject({ source: 'collect-earth', records: 3, kept: 1, problems: 1 });
  });

  it('keeps an operator under the account the coordinator names, who becomes a member', async () => {
    await account('bob');
    const named = encodeURIComponent(JSON.stringify({ 'Bob Smith': 'bob' }));
    const res = await post(`?operators=${named}`, zip());
    expect(res.statusCode).toBe(200);
    expect(res.json().operators).toContainEqual({ name: 'Bob Smith', username: 'bob', records: 1, member: false });
    expect(await ctx.store.getRecord(pid, '103,1', 'bob')).not.toBeNull();
    expect((await ctx.store.listMembers(pid)).map((m) => m.username)).toContain('bob');
    const unknown = await post(`?operators=${encodeURIComponent(JSON.stringify({ anna: 'nobody' }))}`, zip());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toBe('unknown_account');
  });

  it("refuses another survey's backup, a file that is no backup, and a collector", async () => {
    const other = await post('/preview', backup([['1/1.xml', recordXml('1', 'a', true, '2026-10-02T10:00:00Z')]], '<survey><uri>http://example.org/other</uri><schema><entity name="plot"/></schema></survey>'));
    expect(other.statusCode).toBe(400);
    expect(other.json()).toMatchObject({ error: 'survey_mismatch', reason: expect.stringContaining('http://example.org/other') });
    const notZip = await post('/preview', Buffer.from('not a zip'));
    expect(notZip.json()).toMatchObject({ error: 'backup_unreadable' });
    const noSurvey = await post('/preview', zipCep(new Map([['1/1.xml', Buffer.from('<plot/>')]]), FIXTURE_DATE));
    expect(noSurvey.json().reason).toContain('idml.xml');
    const collector = await post('', zip(), await account('col', token, pid));
    expect(collector.statusCode).toBe(403);
    expect((await ctx.store.listRecordStates(pid)).length).toBe(0);
  });
});
