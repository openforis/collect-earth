import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCep, zipCep } from '../src/cep.js';
import { backupEntries, planBackup, type PlanInput } from '../src/collectBackup.js';
import type { RecordRound } from '../src/rounds.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { RecordState } from '../src/types.js';
import { zipStream, type ZipEntry } from '../src/zipStream.js';
import { FIXTURE_DATE, idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

/** The XML export Collect Earth itself made (DataImportExportService.exportSurveyAsZipWithXml, 2026-10-30). */
const DESKTOP_EXPORT = readFileSync(fileURLToPath(new URL('./fixtures/desktop-xml-export.zip', import.meta.url)));

const collect = async (gen: AsyncIterable<Buffer>) => {
  const parts: Buffer[] = [];
  for await (const b of gen) parts.push(b);
  return Buffer.concat(parts);
};

/** The entry names of a zip, in the central directory's order (read by hand: no library in between). */
function centralNames(zip: Buffer): string[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) {
    const locator = end - 20;
    expect(zip.readUInt32LE(locator)).toBe(0x07064b50);
    const record = Number(zip.readBigUInt64LE(locator + 8));
    expect(zip.readUInt32LE(record)).toBe(0x06064b50);
    count = Number(zip.readBigUInt64LE(record + 32));
    at = Number(zip.readBigUInt64LE(record + 48));
  }
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const n = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    names.push(zip.subarray(at + 46, at + 46 + n).toString('utf8'));
    at += 46 + n + extra + comment;
  }
  return names;
}

describe('zipStream', () => {
  it('writes the same bytes as zipCep for a small zip, deflated or stored, the date in UTC', async () => {
    const entries = new Map<string, Uint8Array>([
      ['idml.xml', Buffer.from('<survey>'.repeat(200))],
      ['1/1.xml', Buffer.from('<plot/>')],
      ['empty.txt', new Uint8Array(0)],
      ['ñandú/2.xml', Buffer.from('<plot>Ñ &amp; ü</plot>'.repeat(30))],
    ]);
    const named = await collect(zipStream([...entries].map(([name, data]) => ({ name, data })), FIXTURE_DATE));
    expect(named.equals(zipCep(entries, FIXTURE_DATE))).toBe(true);
    const back = unzipSync(named);
    expect(Object.keys(back)).toEqual([...entries.keys()]);
    expect(strFromU8(back['ñandú/2.xml'])).toBe('<plot>Ñ &amp; ü</plot>'.repeat(30));
  });

  it('uses ZIP64 end records past 65,535 entries, and fflate and a reader by hand read every entry', async () => {
    const count = 70_000;
    function* entries(): Generator<ZipEntry> {
      for (let i = 1; i <= count; i++) yield { name: `1/${i}.xml`, data: Buffer.from(String(i)) };
    }
    const zip = await collect(zipStream(entries(), FIXTURE_DATE));
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 8)).toBe(0xffff);
    expect(zip.readUInt16LE(end + 10)).toBe(0xffff);
    // The ZIP64 record and its locator just before.
    expect(zip.readUInt32LE(end - 20)).toBe(0x07064b50);
    expect(zip.readUInt32LE(end - 20 - 56)).toBe(0x06064b50);
    expect(Number(zip.readBigUInt64LE(end - 20 - 56 + 24))).toBe(count);
    const names = centralNames(zip);
    expect(names.length).toBe(count);
    expect(names[count - 1]).toBe(`1/${count}.xml`);
    const back = unzipSync(zip);
    expect(Object.keys(back).length).toBe(count);
    expect(strFromU8(back['1/69999.xml'])).toBe('69999');
  }, 60_000);

  it('a small zip has no ZIP64 record', async () => {
    const zip = await collect(zipStream([{ name: 'a', data: Buffer.from('a') }], FIXTURE_DATE));
    expect(zip.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(false);
  });
});

describe('planBackup: which records, one per key', () => {
  const state = (recordKey: string, operator: string, over: Partial<RecordState> = {}): RecordState => ({
    recordKey,
    operator,
    activelySaved: true,
    deleted: false,
    modifiedOn: 100,
    firstSubmittedOn: 100,
    ...over,
  });
  const roundOf = (r: { recordKey: string }): RecordRound => {
    const [plot, round] = r.recordKey.split(',');
    return { plot, round, assessment: round === '1' ? 'main' : round === '2' ? 'check' : 'other' };
  };
  const input = (records: RecordState[], reference: string[] = []): PlanInput => ({
    records,
    roundOf,
    isReference: (r) => reference.includes(r.recordKey.split(',')[0]),
  });

  it('round 1: the first assessments only; all: every round, in key order', () => {
    const records = [state('2,1', 'ana'), state('1,2', 'ben'), state('1,1', 'ana'), state('3,7', 'ana'), state('4,1', 'ana', { activelySaved: false })];
    const first = planBackup(input(records), '1');
    expect(first.records).toEqual([
      { recordKey: '1,1', operator: 'ana' },
      { recordKey: '2,1', operator: 'ana' },
      { recordKey: '4,1', operator: 'ana' },
    ]);
    expect(first).toMatchObject({ rounds: '1', drafts: 1, otherRounds: 2, sameKey: 0, reference: 0 });
    const all = planBackup(input(records), 'all');
    expect(all.records.map((r) => r.recordKey)).toEqual(['1,1', '1,2', '2,1', '3,7', '4,1']);
    expect(all).toMatchObject({ otherRounds: 0, drafts: 1 });
  });

  it('one record per key: submitted before a draft, then the latest, then the first name; deleted ones never', () => {
    const records = [
      state('1,1', 'ben', { modifiedOn: 300, activelySaved: false }),
      state('1,1', 'ana', { modifiedOn: 200 }),
      state('2,1', 'ana', { modifiedOn: 200 }),
      state('2,1', 'ben', { modifiedOn: 250 }),
      state('3,1', 'ben'),
      state('3,1', 'ana'),
      state('4,1', 'ana', { deleted: true, modifiedOn: 999 }),
      state('4,1', 'ben'),
    ];
    const plan = planBackup(input(records), '1');
    expect(plan.records).toEqual([
      { recordKey: '1,1', operator: 'ana' },
      { recordKey: '2,1', operator: 'ben' },
      { recordKey: '3,1', operator: 'ana' },
      { recordKey: '4,1', operator: 'ben' },
    ]);
    expect(plan).toMatchObject({ sameKey: 3, sameKeyExamples: ['1,1', '2,1', '3,1'], drafts: 0 });
  });

  it("reference plots: every collector's round 2 shares one key, one is kept and the rest counted apart", () => {
    const records = [state('5,1', 'owner'), state('5,2', 'ana', { modifiedOn: 300 }), state('5,2', 'ben', { modifiedOn: 200 }), state('5,2', 'eva', { modifiedOn: 100 }), state('6,2', 'ana')];
    const plan = planBackup(input(records, ['5']), 'all');
    expect(plan.records).toEqual([
      { recordKey: '5,1', operator: 'owner' },
      { recordKey: '5,2', operator: 'ana' },
      { recordKey: '6,2', operator: 'ana' },
    ]);
    expect(plan).toMatchObject({ reference: 2, sameKey: 2, sameKeyReference: 2 });
    expect(planBackup(input(records, ['5']), '1')).toMatchObject({ reference: 1, sameKey: 0, otherRounds: 4 });
  });
});

describe('backupEntries', () => {
  it('the survey first, then each record as <step>/<n>.xml with its stored XML, read a page at a time; a record gone is left out', async () => {
    const store = new InMemoryStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const row = (recordKey: string, operator: string, step: number, xml: string | null) =>
      store.putRecord({ projectId, recordKey, operator, modifiedOn: 1, receivedAt: 1, activelySaved: true, step, xml, summary: {}, deleted: false, deletedOn: null });
    for (let i = 1; i <= 1203; i++) await row(`${i},1`, 'ana', i === 7 ? 2 : i === 8 ? 9 : 1, `<plot><id><value>${i}</value></id></plot>`);
    await row('9999,1', 'ana', 1, null);
    const records = [...Array.from({ length: 1203 }, (_, i) => ({ recordKey: `${i + 1},1`, operator: 'ana' })), { recordKey: '9999,1', operator: 'ana' }, { recordKey: 'gone', operator: 'ana' }];
    const reads: number[] = [];
    const counting = Object.assign(Object.create(store), {
      getRecordXml: (pid: string, keys: { recordKey: string; operator: string }[]) => {
        reads.push(keys.length);
        return store.getRecordXml(pid, keys);
      },
    });
    const outcome = { written: 0, missing: 0 };
    const names: string[] = [];
    const texts = new Map<string, string>();
    const plan = { rounds: '1' as const, records, drafts: 0, reference: 0, otherRounds: 0, sameKey: 0, sameKeyReference: 0, sameKeyExamples: [] };
    for await (const e of backupEntries(counting, projectId, Buffer.from('<survey/>'), plan, outcome)) {
      names.push(e.name);
      texts.set(e.name, Buffer.from(e.data).toString('utf8'));
    }
    expect(reads).toEqual([500, 500, 205]);
    expect(names[0]).toBe('idml.xml');
    expect(names.slice(1, 9)).toEqual(['1/1.xml', '1/2.xml', '1/3.xml', '1/4.xml', '1/5.xml', '1/6.xml', '2/7.xml', '1/8.xml']);
    expect(names.length).toBe(1 + 1203);
    expect(texts.get('1/1203.xml')).toBe('<plot><id><value>1203</value></id></plot>');
    expect(outcome).toEqual({ written: 1203, missing: 2 });
  });
});

describe('GET /exports/collect-backup', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};
  const at = Date.UTC(2026, 10, 2, 9);

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer' = 'operator') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };
  /** A record as Collect Earth's DataMarshaller writes it: answers escaped, non-ASCII as character references. */
  const xmlOf = (id: number, round: number, operator: string, remark: string) =>
    `<?xml version='1.0' standalone='yes' ?>\n<plot step="1" created="2026-11-02T10:00:00.000+01:00">\n  <id>\n    <value>${id}</value>\n  </id>\n  <round>\n    <code>${round}</code>\n  </round>\n  <operator>\n    <value>${operator}</value>\n  </operator>\n  <remarks>\n    <value>${remark}</value>\n  </remarks>\n</plot>\n`;
  const send = async (operator: string, round: number, plots: number[], over: { activelySaved?: boolean; modifiedOn?: number } = {}) => {
    const res = await batchRequest(
      ctx.app,
      pid,
      projectToken,
      plots.map((p) =>
        envelope({
          recordKey: `${p},${round}`,
          operator,
          modifiedOn: over.modifiedOn ?? at,
          activelySaved: over.activelySaved ?? true,
          xml: xmlOf(p, round, operator, 'Tree &amp; shrub &lt;5 m&gt; &quot;dense&quot; &#209;and&#250; ñ'),
          summary: { collect_code_round: String(round) },
        }),
      ),
    );
    expect(res.statusCode, res.body).toBe(200);
  };
  const backup = (query = '', token = owner.token) => call('GET', `/exports/collect-backup${query}`, token);

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Backup ñ');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const n of ['maria', 'jose', 'ana']) await join(n);
    await join('rita', 'reviewer');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('has the layout of Collect Earth\'s own XML export: the served survey, then <step>/<n>.xml with the XML as stored; audited; coordinators only', async () => {
    expect((await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' })).statusCode).toBe(200);
    await send('maria', 1, [1, 2, 3]);
    await send('jose', 2, [1]);
    await send('jose', 1, [4], { activelySaved: false });

    expect((await backup('', people.maria.token)).statusCode).toBe(403);
    expect((await backup('', people.rita.token)).statusCode).toBe(403);
    expect((await backup('?rounds=2')).statusCode).toBe(400);

    const res = await backup();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''Backup%20%C3%B1-collect-earth-backup.zip");
    const zip = res.rawPayload;

    // The same shape as the desktop's export: idml.xml first, then <step>/<id>.xml, nothing else.
    const desktop = centralNames(DESKTOP_EXPORT);
    expect(desktop[0]).toBe('idml.xml');
    expect(desktop.slice(1).every((n) => /^[123]\/\d+\.xml$/.test(n))).toBe(true);
    const ours = centralNames(zip);
    expect(ours).toEqual(['idml.xml', '1/1.xml', '1/2.xml', '1/3.xml', '1/4.xml']);
    const back = unzipSync(zip);
    // Both the desktop's records and ours begin as DataMarshaller writes them (on Windows with CRLF).
    const desktopBack = unzipSync(DESKTOP_EXPORT);
    const declaration = /^<\?xml version='1\.0' standalone='yes' \?>\r?\n<plot /;
    expect(strFromU8(desktopBack[desktop[1]])).toMatch(declaration);
    expect(strFromU8(back['1/1.xml'])).toMatch(declaration);

    // The survey is the served one (round added), byte for byte.
    const served = (await call('GET', '/cep', owner.token)).rawPayload;
    const files = readCep(served);
    expect(Buffer.from(back['idml.xml']).equals(Buffer.from(files.entries.get(files.surveyPath)!))).toBe(true);
    expect(strFromU8(back['idml.xml'])).toContain('name="round"');

    // Each record's XML exactly as stored: escapes and non-ASCII kept, UTF-8.
    const stored = await ctx.store.getRecord(pid, '1,1', 'maria');
    expect(Buffer.from(back['1/1.xml']).equals(Buffer.from(stored!.xml!, 'utf8'))).toBe(true);
    expect(strFromU8(back['1/1.xml'])).toContain('Tree &amp; shrub &lt;5 m&gt; &quot;dense&quot; &#209;and&#250; ñ');
    // Round 1 only (the default): jose's check of plot 1 is not in; his draft of 4 is.
    expect(strFromU8(back['1/4.xml'])).toContain('<value>jose</value>');
    expect(Object.entries(back).filter(([name, d]) => name !== 'idml.xml' && strFromU8(d).includes('<code>2</code>'))).toEqual([]);

    const log = await ctx.store.listAudit(pid, { limit: 5, action: 'export.downloaded' });
    expect(log[0]).toMatchObject({ actorUserId: owner.userId, details: { kind: 'collect-backup', rows: 4, rounds: '1' } });

    // All rounds: the check too, in key order.
    const all = await backup('?rounds=all');
    expect(all.statusCode).toBe(200);
    expect(all.headers['content-disposition']).toContain('-all-rounds.zip');
    const allBack = unzipSync(all.rawPayload);
    expect(centralNames(all.rawPayload)).toEqual(['idml.xml', '1/1.xml', '1/2.xml', '1/3.xml', '1/4.xml', '1/5.xml']);
    expect(strFromU8(allBack['1/2.xml'])).toContain('<code>2</code>');

    const summary = await call('GET', '/exports/collect-backup/summary', owner.token);
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual({
      projectFile: true,
      roundKey: true,
      roundState: 'added',
      note: true,
      rounds: {
        '1': { records: 4, drafts: 1, reference: 0, otherRounds: 1, sameKey: 0, sameKeyReference: 0, sameKeyExamples: [] },
        all: { records: 5, drafts: 1, reference: 0, otherRounds: 0, sameKey: 0, sameKeyReference: 0, sameKeyExamples: [] },
      },
    });
    expect((await call('GET', '/exports/collect-backup/summary', people.rita.token)).statusCode).toBe(403);
  });

  it('two records with one key: one is in the backup (the submitted, then the latest), the others counted', async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await send('maria', 1, [1], { modifiedOn: at });
    await send('jose', 1, [1], { modifiedOn: at + 1000 });
    await send('ana', 1, [1], { modifiedOn: at + 2000, activelySaved: false });
    const back = unzipSync((await backup()).rawPayload);
    expect(Object.keys(back)).toEqual(['idml.xml', '1/1.xml']);
    expect(strFromU8(back['1/1.xml'])).toContain('<value>jose</value>');
    expect((await call('GET', '/exports/collect-backup/summary', owner.token)).json().rounds['1']).toMatchObject({ records: 1, sameKey: 2, sameKeyExamples: ['1,1'] });
  });

  it("reference plots: the collectors' measurements share one key, one goes (as stored), the rest are counted", async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const fileId = (await call('PUT', '/csv-files/north.csv', owner.token, 'id;lat;lon\r\n1;-10;20\r\n2;-10;21\r\n3;-10;22\r\n4;-10;23\r\n', { 'content-type': 'text/csv' })).json().id;
    expect((await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.maria.userId, people.jose.userId], order: 'file' })).statusCode).toBe(200);
    expect((await call('POST', '/reference/plots', owner.token, { csvFileId: fileId, assessorUserId: owner.userId, plots: ['1'] })).statusCode).toBe(200);
    await send('owner', 1, [1]);
    await send('maria', 2, [1], { modifiedOn: at + 3000 });
    await send('jose', 2, [1], { modifiedOn: at + 2000 });
    await send('ana', 2, [1], { modifiedOn: at + 1000 });
    await send('maria', 1, [2]);
    const summary = (await call('GET', '/exports/collect-backup/summary', owner.token)).json();
    expect(summary.rounds['1']).toMatchObject({ records: 2, reference: 1, otherRounds: 3, sameKey: 0 });
    expect(summary.rounds.all).toMatchObject({ records: 3, reference: 2, sameKey: 2, sameKeyReference: 2, sameKeyExamples: ['1,2'] });
    const back = unzipSync((await backup('?rounds=all')).rawPayload);
    expect(Object.keys(back)).toEqual(['idml.xml', '1/1.xml', '1/2.xml', '1/3.xml']);
    expect(strFromU8(back['1/2.xml'])).toContain('<value>maria</value>');
  });

  it('without the round key: round 1 only (all rounds is 409), checks told apart by who holds the copies', async () => {
    // Records before the project file: the server cannot add round, so plots have one key part.
    const res = await batchRequest(ctx.app, pid, projectToken, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: at, xml: xmlOf(1, 1, 'maria', 'a') }),
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: at, xml: xmlOf(2, 1, 'maria', 'b') }),
    ]);
    expect(res.statusCode).toBe(200);
    const put = await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    expect(put.json().round).toMatchObject({ state: 'none' });
    expect((await backup('?rounds=all')).json()).toMatchObject({ error: 'no_round_key' });
    expect((await backup('?rounds=all')).statusCode).toBe(409);
    const back = unzipSync((await backup()).rawPayload);
    expect(Object.keys(back)).toEqual(['idml.xml', '1/1.xml', '1/2.xml']);
    const summary = (await call('GET', '/exports/collect-backup/summary', owner.token)).json();
    expect(summary).toMatchObject({ roundKey: false, roundState: 'none', rounds: { all: null, '1': { records: 2 } } });
  });

  it('no project file: 409, nothing audited', async () => {
    await send('maria', 1, [1]);
    const res = await backup();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'no_project_file' });
    expect(await ctx.store.listAudit(pid, { limit: 5, action: 'export.downloaded' })).toEqual([]);
    expect((await call('GET', '/exports/collect-backup/summary', owner.token)).json()).toMatchObject({ projectFile: false });
  });
});
