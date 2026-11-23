import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipCep } from '../src/cep.js';
import { MAX_UPLOAD_BYTES, PART_BYTES, partCount, partSize } from '../src/uploads.js';
import { SAMPLE_RECORDS, SAMPLE_SURVEY } from './backupSampleData.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

/**
 * A backup as Collect's data export writes it (.collect-data: idml.xml and data/<step>/<n>.xml), made larger than two
 * parts by a file the import does not read (random bytes: they do not compress).
 */
function largeBackup(fillerBytes: number): Buffer {
  const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
  return zipCep(
    new Map<string, Uint8Array>([
      ['idml.xml', utf8(SAMPLE_SURVEY)],
      ...Object.entries(SAMPLE_RECORDS).map(([path, xml]) => [`data/${path}`, utf8(xml)] as [string, Uint8Array]),
      ['upload/filler.bin', new Uint8Array(randomBytes(fillerBytes))],
    ]),
    new Date('2025-10-03T00:00:00Z'),
  );
}

describe('a file sent in parts (POST /v1/uploads), for a backup larger than one request holds', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let other: string;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    // another account, of a project of the owner's
    const team = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Team' } })).json().projectId;
    const invite = (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${team}/invites`, headers: bearer(owner.token), payload: { role: 'admin' } })).json().inviteToken;
    other = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'other', password: 'password12', inviteToken: invite } })).json().token;
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const start = (bytes: number, token = owner.token, name = 'zambia.collect-data') => ctx.app.inject({ method: 'POST', url: '/v1/uploads', headers: bearer(token), payload: { bytes, name } });
  const part = (id: string, n: number, data: Buffer, token = owner.token) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/uploads/${id}/parts/${n}`, headers: { ...bearer(token), 'content-type': 'application/octet-stream' }, payload: data });
  /** Sends a file as the dashboard does; `skip`: a part left out. */
  const send = async (file: Buffer, skip = -1) => {
    const started = await start(file.length);
    expect(started.statusCode, started.body).toBe(201);
    const { uploadId, partBytes, parts } = started.json() as { uploadId: string; partBytes: number; parts: number };
    for (let n = 0; n < parts; n++) {
      if (n === skip) continue;
      const res = await part(uploadId, n, file.subarray(n * partBytes, (n + 1) * partBytes));
      expect(res.statusCode, res.body).toBe(204);
    }
    return uploadId;
  };
  const preview = (payload: object, token = owner.token) => ctx.app.inject({ method: 'POST', url: '/v1/projects/from-backup/preview', headers: bearer(token), payload });

  it('a backup of three parts reads as the same backup in one request, makes the project, and is deleted by the import', async () => {
    const file = largeBackup(2 * PART_BYTES + 1000);
    expect(partCount(file.length, PART_BYTES)).toBe(3);
    const uploadId = await send(file);
    const fromParts = await preview({ upload: uploadId });
    expect(fromParts.statusCode, fromParts.body).toBe(200);
    expect(fromParts.json().records.total).toBe(Object.keys(SAMPLE_RECORDS).length);
    expect(fromParts.json()).toEqual((await preview({ backup: file.toString('base64') })).json());
    // the preview keeps the upload: the same one makes the project
    const made = await ctx.app.inject({ method: 'POST', url: '/v1/projects/from-backup', headers: bearer(owner.token), payload: { upload: uploadId, name: 'Zambia' } });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json().records).toBe(fromParts.json().records.total);
    expect((await preview({ upload: uploadId })).statusCode).toBe(404);
  });

  it('refuses a file over the limit, a part of the wrong size or number, and an import of an upload with a part missing', async () => {
    const tooLarge = await start(MAX_UPLOAD_BYTES + 1);
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toMatchObject({ error: 'upload_too_large', maxBytes: 70 * 1024 * 1024 });
    expect((await start(MAX_UPLOAD_BYTES)).statusCode).toBe(201);
    for (const bytes of [0, -1, 1.5, '10']) expect((await start(bytes as number)).statusCode, String(bytes)).toBe(400);

    const file = largeBackup(PART_BYTES + 500);
    const uploadId = await send(file, 1);
    expect(partSize({ bytes: file.length, partBytes: PART_BYTES }, 1)).toBe(file.length - PART_BYTES);
    const incomplete = await preview({ upload: uploadId });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json().error).toBe('upload_incomplete');
    expect((await part(uploadId, 1, file.subarray(PART_BYTES, PART_BYTES + 10))).statusCode).toBe(400);
    expect((await part(uploadId, 2, Buffer.from('x'))).statusCode).toBe(400);
    expect((await part(uploadId, 1, Buffer.alloc(0))).statusCode).toBe(400);
    // the part sent at last: the import reads it
    expect((await part(uploadId, 1, file.subarray(PART_BYTES))).statusCode).toBe(204);
    expect((await preview({ upload: uploadId })).statusCode).toBe(200);
  });

  it("an upload is its account's: another account's, an unknown one and no session are refused; a new upload replaces the account's earlier one", async () => {
    const file = largeBackup(100);
    const uploadId = await send(file);
    expect((await part(uploadId, 0, file, other)).statusCode).toBe(404);
    expect((await preview({ upload: uploadId }, other)).statusCode).toBe(404);
    expect((await preview({ upload: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await preview({ upload: 'not-an-id' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/uploads', payload: { bytes: 10 } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'PUT', url: `/v1/uploads/${uploadId}/parts/0`, headers: { 'content-type': 'application/octet-stream' }, payload: file })).statusCode).toBe(401);
    // deleting another account's upload does nothing
    expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/uploads/${uploadId}`, headers: bearer(other) })).statusCode).toBe(204);
    expect((await preview({ upload: uploadId })).statusCode).toBe(200);
    // the owner sends another file: the first is gone
    const second = await send(largeBackup(200));
    expect((await preview({ upload: uploadId })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/uploads/${second}`, headers: bearer(owner.token) })).statusCode).toBe(204);
    expect((await preview({ upload: second })).statusCode).toBe(404);
  });
});
