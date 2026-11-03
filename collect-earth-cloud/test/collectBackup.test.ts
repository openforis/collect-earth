import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCep, zipCep } from '../src/cep.js';
import { readBackupLink, writeBackupLink } from '../src/backupLink.js';
import { backupEntries, planBackup, type PlanInput } from '../src/collectBackup.js';
import type { RecordRound } from '../src/rounds.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { RecordState } from '../src/types.js';
import { localHeader, zipStream, type ZipEntry } from '../src/zipStream.js';
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

  it('a local header needs version 45 for an entry starting past 4 GB, 20 before', () => {
    const header = (offset: number) => localHeader({ name: Buffer.from('a'), flags: 0, method: 8, crc: 1, compressed: 2, size: 3, offset }, 0, 0);
    expect(header(0).readUInt16LE(4)).toBe(20);
    expect(header(0xffffffff).readUInt16LE(4)).toBe(45);
    expect(header(2 ** 33).readUInt16LE(4)).toBe(45);
  });

  it('takes a name of 65,535 bytes, refuses one longer', async () => {
    const zip = await collect(zipStream([{ name: 'n'.repeat(0xffff), data: Buffer.from('x') }], FIXTURE_DATE));
    expect(centralNames(zip)[0].length).toBe(0xffff);
    await expect(collect(zipStream([{ name: 'n'.repeat(0x10000), data: Buffer.from('x') }], FIXTURE_DATE))).rejects.toThrow(/too long/);
  });

  it('lets other work run while it writes (yields to the event loop every few milliseconds)', async () => {
    const data = Buffer.from('<plot>'.repeat(3000) + Math.random().toString(36));
    function* entries(): Generator<ZipEntry> {
      for (let i = 0; i < 3000; i++) yield { name: `1/${i}.xml`, data };
    }
    let ran = 0;
    const tick = () => {
      ran += 1;
      if (!done) setImmediate(tick);
    };
    let done = false;
    setImmediate(tick);
    const started = performance.now();
    await collect(zipStream(entries(), FIXTURE_DATE));
    done = true;
    const ms = performance.now() - started;
    // Without the yields the loop runs once at most until the zip is written.
    expect(ran).toBeGreaterThan(Math.min(5, ms / 20));
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
  const input = (records: RecordState[], over: Partial<PlanInput> = {}): PlanInput => ({
    records,
    roundOf,
    isReference: () => false,
    isMainHolder: () => false,
    hasXml: () => true,
    ...over,
  });

  it('round 1: the first assessments only; all: every round, in key order', () => {
    const records = [state('2,1', 'ana'), state('1,2', 'ben'), state('1,1', 'ana'), state('3,7', 'ana'), state('4,1', 'ana', { activelySaved: false })];
    const first = planBackup(input(records), '1');
    expect(first.records).toEqual([
      { recordKey: '1,1', operator: 'ana' },
      { recordKey: '2,1', operator: 'ana' },
      { recordKey: '4,1', operator: 'ana' },
    ]);
    expect(first).toMatchObject({ rounds: '1', drafts: 1, otherRounds: 2, sameKey: 0, measurements: 0, noXml: 0 });
    const all = planBackup(input(records), 'all');
    expect(all.records.map((r) => r.recordKey)).toEqual(['1,1', '1,2', '2,1', '3,7', '4,1']);
    expect(all).toMatchObject({ otherRounds: 0, drafts: 1 });
  });

  it('one record per key: the main holder first, then submitted before a draft, then the latest, then the first name; deleted ones never', () => {
    const records = [
      state('1,1', 'ben', { modifiedOn: 300, activelySaved: false }),
      state('1,1', 'ana', { modifiedOn: 200 }),
      state('2,1', 'ana', { modifiedOn: 200 }),
      state('2,1', 'ben', { modifiedOn: 250 }),
      state('3,1', 'ben'),
      state('3,1', 'ana'),
      state('4,1', 'ana', { deleted: true, modifiedOn: 999 }),
      state('4,1', 'ben'),
      // eva holds 5 now: her draft wins over ana's later submitted record.
      state('5,1', 'ana', { modifiedOn: 900 }),
      state('5,1', 'eva', { modifiedOn: 100, activelySaved: false }),
    ];
    const plan = planBackup(input(records, { isMainHolder: (r) => r.recordKey === '5,1' && r.operator === 'eva' }), '1');
    expect(plan.records).toEqual([
      { recordKey: '1,1', operator: 'ana' },
      { recordKey: '2,1', operator: 'ben' },
      { recordKey: '3,1', operator: 'ana' },
      { recordKey: '4,1', operator: 'ben' },
      { recordKey: '5,1', operator: 'eva' },
    ]);
    expect(plan).toMatchObject({ sameKey: 4, sameKeyExamples: ['1,1', '2,1', '3,1', '5,1'], drafts: 1 });
  });

  it('a record without XML never wins its key, and is counted', () => {
    const records = [state('1,1', 'ana', { modifiedOn: 900 }), state('1,1', 'ben', { modifiedOn: 100 }), state('2,1', 'ana')];
    const plan = planBackup(input(records, { hasXml: (r) => !(r.operator === 'ana') }), '1');
    expect(plan.records).toEqual([{ recordKey: '1,1', operator: 'ben' }]);
    expect(plan).toMatchObject({ noXml: 2, sameKey: 0 });
  });

  it("reference plots: the reference (round 1) is kept; the collectors' measurements (round 2) are left out in every mode and counted", () => {
    const records = [state('5,1', 'owner'), state('5,2', 'ana', { modifiedOn: 300 }), state('5,2', 'ben', { modifiedOn: 200 }), state('5,2', 'eva'), state('6,2', 'ana')];
    const isReference = (r: { recordKey: string }) => r.recordKey.startsWith('5,');
    const all = planBackup(input(records, { isReference }), 'all');
    expect(all.records).toEqual([
      { recordKey: '5,1', operator: 'owner' },
      { recordKey: '6,2', operator: 'ana' },
    ]);
    expect(all).toMatchObject({ measurements: 3, sameKey: 0, otherRounds: 0 });
    expect(planBackup(input(records, { isReference }), '1')).toMatchObject({ records: [{ recordKey: '5,1', operator: 'owner' }], measurements: 3, otherRounds: 1 });
  });
});

describe('backupEntries', () => {
  it('the survey first, then each record as <step>/<n>.xml with its stored XML, read a page at a time; a record gone or deleted since is left out and counted', async () => {
    const store = new InMemoryStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const row = (recordKey: string, operator: string, step: number, xml: string | null, deleted = false) =>
      store.putRecord({ projectId, recordKey, operator, modifiedOn: 1, receivedAt: 1, activelySaved: true, step, xml, summary: {}, deleted, deletedOn: deleted ? 2 : null });
    for (let i = 1; i <= 1203; i++) await row(`${i},1`, 'ana', i === 7 ? 2 : i === 8 ? 9 : 1, `<plot><id><value>${i}</value></id></plot>`);
    await row('9999,1', 'ana', 1, null);
    await row('9998,1', 'ana', 1, '<plot/>', true);
    const records = [
      ...Array.from({ length: 1203 }, (_, i) => ({ recordKey: `${i + 1},1`, operator: 'ana' })),
      { recordKey: '9998,1', operator: 'ana' },
      { recordKey: '9999,1', operator: 'ana' },
      { recordKey: 'gone', operator: 'ana' },
    ];
    const reads: number[] = [];
    const counting = Object.assign(Object.create(store), {
      getRecordXml: (pid: string, keys: { recordKey: string; operator: string }[]) => {
        reads.push(keys.length);
        return store.getRecordXml(pid, keys);
      },
    });
    const outcome = { written: 0, missing: 0, deleted: 0 };
    const names: string[] = [];
    const texts = new Map<string, string>();
    const plan = { rounds: '1' as const, records, drafts: 0, otherRounds: 0, measurements: 0, sameKey: 0, sameKeyExamples: [], noXml: 0 };
    for await (const e of backupEntries(counting, projectId, Buffer.from('<survey/>'), plan, outcome)) {
      names.push(e.name);
      texts.set(e.name, Buffer.from(e.data).toString('utf8'));
    }
    expect(reads).toEqual([500, 500, 206]);
    expect(names[0]).toBe('idml.xml');
    expect(names.slice(1, 9)).toEqual(['1/1.xml', '1/2.xml', '1/3.xml', '1/4.xml', '1/5.xml', '1/6.xml', '2/7.xml', '1/8.xml']);
    expect(names.length).toBe(1 + 1203);
    expect(texts.get('1/1203.xml')).toBe('<plot><id><value>1203</value></id></plot>');
    expect(outcome).toEqual({ written: 1203, missing: 2, deleted: 1 });
  });
});

describe('backup links (signed, 60 s)', () => {
  const secret = Buffer.from('k'.repeat(32));
  const claims = { projectId: 'p1', userId: 'u1', rounds: 'all' as const };

  it('reads back what it was made with until it expires; another secret, a changed byte or garbage is no link', () => {
    const { token, expiresAt } = writeBackupLink(claims, secret, 1_000_000);
    expect(expiresAt).toBe(1_060_000);
    expect(readBackupLink(token, secret, 1_000_000)).toMatchObject({ ...claims, expiresAt: 1_060_000 });
    expect(readBackupLink(token, secret, 1_059_999)).toMatchObject(claims);
    expect(readBackupLink(token, secret, 1_060_000)).toBe('expired');
    expect(readBackupLink(token, Buffer.from('j'.repeat(32)), 1_000_000)).toBeNull();
    const flipped = `${token.slice(0, 5)}${token[5] === 'A' ? 'B' : 'A'}${token.slice(6)}`;
    expect(readBackupLink(flipped, secret, 1_000_000)).toBeNull();
    expect(readBackupLink('a.b', secret, 1_000_000)).toBeNull();
    expect(readBackupLink('', secret, 1_000_000)).toBeNull();
    // Each link is its own (a nonce), so one used does not use up another.
    expect(writeBackupLink(claims, secret, 1_000_000).token).not.toBe(token);
    // A project token's link has no user.
    expect(readBackupLink(writeBackupLink({ ...claims, userId: null }, secret, 5).token, secret, 5)).toMatchObject({ userId: null });
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
      firstCodes: ['1'],
      note: true,
      rounds: {
        '1': { records: 4, drafts: 1, otherRounds: 1, measurements: 0, sameKey: 0, sameKeyExamples: [], noXml: 0, estimatedBytes: 50_000 + 4 * 1800 },
        all: { records: 5, drafts: 1, otherRounds: 0, measurements: 0, sameKey: 0, sameKeyExamples: [], noXml: 0, estimatedBytes: 50_000 + 5 * 1800 },
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

  it('the plot of a divided file: the record of the person who holds it now wins its key', async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const fileId = (await call('PUT', '/csv-files/north.csv', owner.token, 'id;lat;lon\r\n1;-10;20\r\n2;-10;21\r\n3;-10;22\r\n4;-10;23\r\n', { 'content-type': 'text/csv' })).json().id;
    // maria holds 1-2, jose 3-4.
    expect((await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.maria.userId, people.jose.userId], order: 'file' })).statusCode).toBe(200);
    await send('maria', 1, [1], { modifiedOn: at, activelySaved: false });
    await send('jose', 1, [1], { modifiedOn: at + 1000 });
    const back = unzipSync((await backup()).rawPayload);
    expect(strFromU8(back['1/1.xml'])).toContain('<value>maria</value>');
  });

  it("reference plots: the reference (round 1) goes in, the collectors' measurements never, counted", async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const fileId = (await call('PUT', '/csv-files/north.csv', owner.token, 'id;lat;lon\r\n1;-10;20\r\n2;-10;21\r\n3;-10;22\r\n4;-10;23\r\n', { 'content-type': 'text/csv' })).json().id;
    expect((await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.maria.userId, people.jose.userId], order: 'file' })).statusCode).toBe(200);
    expect((await call('POST', '/reference/plots', owner.token, { csvFileId: fileId, assessorUserId: owner.userId, plots: ['1'] })).statusCode).toBe(200);
    await send('owner', 1, [1]);
    await send('maria', 2, [1], { modifiedOn: at + 3000 });
    await send('jose', 2, [1], { modifiedOn: at + 2000 });
    await send('ana', 2, [1], { modifiedOn: at + 1000 });
    await send('maria', 1, [2]);
    await send('jose', 2, [2]);
    const summary = (await call('GET', '/exports/collect-backup/summary', owner.token)).json();
    expect(summary.rounds['1']).toMatchObject({ records: 2, measurements: 3, otherRounds: 1, sameKey: 0 });
    expect(summary.rounds.all).toMatchObject({ records: 3, measurements: 3, otherRounds: 0, sameKey: 0 });
    const back = unzipSync((await backup('?rounds=all')).rawPayload);
    expect(Object.keys(back)).toEqual(['idml.xml', '1/1.xml', '1/2.xml', '1/3.xml']);
    expect(strFromU8(back['1/1.xml'])).toContain('<value>owner</value>');
    expect(strFromU8(back['1/3.xml'])).toContain('<value>jose</value>');
  });

  it('a download link: made by a coordinator, used once within a minute, streams the same zip; refusals', async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await send('maria', 1, [1, 2]);
    await send('jose', 2, [1]);
    expect((await call('POST', '/exports/collect-backup/link', people.maria.token, { rounds: '1' })).statusCode).toBe(403);
    expect((await call('POST', '/exports/collect-backup/link', owner.token, { rounds: 'x' })).statusCode).toBe(400);
    const made = await call('POST', '/exports/collect-backup/link', owner.token, { rounds: 'all' });
    expect(made.statusCode, made.body).toBe(200);
    const { url, expiresAt } = made.json();
    expect(url).toMatch(/^\/v1\/collect-backup\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(expiresAt - Date.now()).toBeGreaterThan(50_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
    // No session needed: the link is the permission.
    const res = await ctx.app.inject({ method: 'GET', url });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toContain('-all-rounds.zip');
    expect(centralNames(res.rawPayload)).toEqual(['idml.xml', '1/1.xml', '1/2.xml', '1/3.xml']);
    const log = await ctx.store.listAudit(pid, { limit: 5, action: 'export.downloaded' });
    expect(log[0]).toMatchObject({ actorUserId: owner.userId, details: { kind: 'collect-backup', rows: 3, rounds: 'all' } });
    // Used once.
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(410);
    // Tampered: another project's id or rounds in it is no link.
    const [body, sig] = url.split('/').pop()!.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), r: '1' })).toString('base64url');
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/collect-backup/${forged}.${sig}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/collect-backup/nonsense' })).statusCode).toBe(404);
    // A coordinator who stopped being one cannot use a link made before.
    await ctx.store.addMembership(pid, people.ana.userId, 'admin');
    const anaLink = (await call('POST', '/exports/collect-backup/link', people.ana.token, { rounds: '1' })).json().url;
    await ctx.store.addMembership(pid, people.ana.userId, 'operator');
    expect((await ctx.app.inject({ method: 'GET', url: anaLink })).statusCode).toBe(403);
  });

  it('one backup at a time: another is 429 backup_busy, the link too, until the first ends', async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await send('maria', 1, [1, 2]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = ctx.store.getRecordXml.bind(ctx.store);
    const spy = vi.spyOn(ctx.store, 'getRecordXml').mockImplementation(async (p, keys) => {
      await gate;
      return real(p, keys);
    });
    const first = backup();
    // Let the first request reach the store.
    for (let i = 0; i < 50 && spy.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(spy).toHaveBeenCalled();
    const second = await backup();
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'backup_busy' });
    expect((await call('POST', '/exports/collect-backup/link', owner.token, { rounds: '1' })).statusCode).toBe(429);
    release();
    expect((await first).statusCode).toBe(200);
    expect((await backup()).statusCode).toBe(200);
  });

  it('a download that stops early is noted with completed: false, and frees the next one', async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    // Enough records that the zip is still being written when the client goes away.
    const big = 'x'.repeat(200_000);
    const res = await batchRequest(
      ctx.app,
      pid,
      projectToken,
      Array.from({ length: 60 }, (_, i) => envelope({ recordKey: `${i + 1},1`, operator: 'maria', modifiedOn: at, xml: xmlOf(i + 1, 1, 'maria', `${big}${i}`) })),
    );
    expect(res.statusCode).toBe(200);
    const url = (await call('POST', '/exports/collect-backup/link', owner.token, { rounds: '1' })).json().url as string;
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`${address}${url}`, (response) => {
        response.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', (err) => ((err as NodeJS.ErrnoException).code === 'ECONNRESET' ? resolve() : reject(err)));
    });
    let log: Awaited<ReturnType<typeof ctx.store.listAudit>> = [];
    for (let i = 0; i < 100; i++) {
      log = await ctx.store.listAudit(pid, { limit: 5, action: 'export.downloaded' });
      if (log.length >= 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(log.map((e) => e.details)).toEqual([
      { kind: 'collect-backup', rows: 60, rounds: '1', completed: false },
      { kind: 'collect-backup', rows: 60, rounds: '1' },
    ]);
    expect((await backup()).statusCode).toBe(200);
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
