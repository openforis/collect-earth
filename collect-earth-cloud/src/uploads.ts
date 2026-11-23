// A large file sent in parts: the dashboard cuts a backup into parts of PART_BYTES, each a request of its own, and an
// import names the upload instead of carrying the file. One request holds 32 MB at most (the server's body limit, and
// Cloud Run's for HTTP/1), which left 23 MB for a backup in base64: a country's data does not fit.
import type { Store } from './store/store.js';

const MB = 1024 * 1024;
/** The largest file sent in parts (a backup of a country's data: Zambia's was refused at 23 MB). */
export const MAX_UPLOAD_BYTES = 70 * MB;
/** A part: small enough for any proxy, and for the database driver to hold twice (it reads a part as text). */
export const PART_BYTES = 4 * MB;
/** An upload nobody imported is deleted after this long. */
export const UPLOAD_TTL_MS = 3 * 60 * 60 * 1000;

export interface UploadInfo {
  id: string;
  bytes: number;
  partBytes: number;
  name: string;
  /** the parts stored so far, by number, with their sizes */
  parts: { n: number; bytes: number }[];
}

/** How many parts a file of `bytes` has. */
export const partCount = (bytes: number, partBytes: number): number => Math.ceil(bytes / partBytes);

/** The size part `n` must have: PART_BYTES, the rest for the last one. */
export function partSize(upload: Pick<UploadInfo, 'bytes' | 'partBytes'>, n: number): number {
  const count = partCount(upload.bytes, upload.partBytes);
  return n === count - 1 ? upload.bytes - upload.partBytes * (count - 1) : upload.partBytes;
}

export type Assembled = { file: Buffer; name: string } | { error: 'upload_not_found' | 'upload_incomplete'; reason: string };

/**
 * The file of an upload of this account, its parts put together one at a time (never all of them twice in memory), or
 * why it cannot be: not theirs or gone (as one answer: an id says nothing of someone else's upload), or parts missing.
 */
export async function assembleUpload(store: Store, uploadId: string, userId: string): Promise<Assembled> {
  const upload = /^[0-9a-f-]{36}$/i.test(uploadId) ? await store.getUpload(uploadId, userId) : null;
  if (!upload) return { error: 'upload_not_found', reason: 'That upload is not there any more (it is kept a few hours): send the file again.' };
  const count = partCount(upload.bytes, upload.partBytes);
  const have = new Map(upload.parts.map((p) => [p.n, p.bytes]));
  for (let n = 0; n < count; n++) {
    if (have.get(n) !== partSize(upload, n)) return { error: 'upload_incomplete', reason: `Part ${n + 1} of ${count} of the file did not arrive: send the file again.` };
  }
  const file = Buffer.allocUnsafe(upload.bytes);
  for (let n = 0; n < count; n++) {
    const part = await store.readUploadPart(uploadId, n);
    if (!part || part.length !== partSize(upload, n)) return { error: 'upload_incomplete', reason: `Part ${n + 1} of ${count} of the file did not arrive: send the file again.` };
    part.copy(file, n * upload.partBytes);
  }
  return { file, name: upload.name };
}
