// A large file sent in parts (src/uploads.ts), for the imports that take a backup larger than one request holds:
// - POST   /v1/uploads { bytes, name? } -> 201 { uploadId, partBytes, parts }: a new upload of the account (its earlier
//   one goes); 413 above MAX_UPLOAD_BYTES.
// - PUT    /v1/uploads/:id/parts/:n (the part's bytes, application/octet-stream) -> 204: part n, of exactly the size
//   it must have; sent again, it replaces itself.
// - DELETE /v1/uploads/:id -> 204.
// An import then names the upload ("upload" of POST /v1/projects/from-backup, ?upload= of .../records/import).
// Any signed-in account may send one (as it may ask for a backup's preview); an upload is its account's only: another
// account's id answers 404, as one that is not there.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { MAX_UPLOAD_BYTES, PART_BYTES, partCount, partSize, UPLOAD_TTL_MS } from '../uploads.js';
import type { UploadStarted } from '../wire/projects.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 200;
const notFound = { error: 'not_found' } as const;

export async function registerUploadRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const session = { preHandler: requireSession(store) };

  app.post('/v1/uploads', session, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { bytes?: unknown; name?: unknown };
    const bytes = body.bytes;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) {
      return reply.code(400).send({ error: 'bad_request', reason: 'bytes must be the size of the file, a whole number above 0' });
    }
    if (bytes > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: 'upload_too_large', maxBytes: MAX_UPLOAD_BYTES, reason: `The file is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB the server takes.` });
    }
    const name = typeof body.name === 'string' ? body.name.slice(0, MAX_NAME) : '';
    const uploadId = await store.createUpload(request.userId!, { bytes, partBytes: PART_BYTES, name }, Date.now() - UPLOAD_TTL_MS);
    return reply.code(201).send({ uploadId, partBytes: PART_BYTES, parts: partCount(bytes, PART_BYTES) } satisfies UploadStarted);
  });

  // A part is a request of its own, far below the server's body limit: PART_BYTES and a little for the framing
  app.put('/v1/uploads/:id/parts/:n', { ...session, bodyLimit: PART_BYTES + 64 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, n: nText } = request.params as { id: string; n: string };
    const n = /^\d{1,6}$/.test(nText) ? Number(nText) : NaN;
    const data = request.body;
    if (!UUID.test(id) || !Number.isInteger(n)) return reply.code(404).send(notFound);
    if (!Buffer.isBuffer(data) || data.length === 0) return reply.code(400).send({ error: 'bad_request', reason: "expected the part's bytes as the body (application/octet-stream)" });
    const userId = request.userId!;
    const upload = await store.getUpload(id, userId);
    if (!upload) return reply.code(404).send(notFound);
    if (n >= partCount(upload.bytes, upload.partBytes)) return reply.code(400).send({ error: 'bad_request', reason: `the file has ${partCount(upload.bytes, upload.partBytes)} parts` });
    if (data.length !== partSize(upload, n)) return reply.code(400).send({ error: 'bad_request', reason: `part ${n} must be ${partSize(upload, n)} bytes, not ${data.length}` });
    if (!(await store.putUploadPart(id, userId, n, data))) return reply.code(404).send(notFound);
    return reply.code(204).send();
  });

  app.delete('/v1/uploads/:id', session, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (UUID.test(id)) await store.deleteUpload(id, request.userId!);
    return reply.code(204).send();
  });
}
