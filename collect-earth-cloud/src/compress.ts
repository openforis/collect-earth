import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const gzipAsync = promisify(gzip);

/** Below this an answer goes as it is: gzip's own bytes and the time are not worth it */
export const MIN_COMPRESSED_BYTES = 1024;
/** What compresses: JSON, CSV and other text. Zips (a project file, a backup) and images are compressed already. */
const COMPRESSIBLE = /^(application\/(json|xml|javascript)|text\/)/i;

/**
 * Gzips the answers that gain from it, for the clients that ask (Accept-Encoding: gzip): the dashboard's JSON, which
 * shrinks to a tenth or a fifth (a project's People, Progress, review queue), and to a third for its map; the plot files
 * Collect Earth downloads, a third. Browsers ask for it, and so does Collect Earth (Apache HttpClient's default client
 * asks and decompresses by itself). A checksum the plot files carry in a header is of the file, not of the bytes sent,
 * so it still matches once decompressed. Streams (downloads sent as streams) and answers already encoded go as they
 * are; the web app's own files are served precompressed by @fastify/static.
 */
export function registerCompression(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    if (reply.getHeader('content-encoding') || !COMPRESSIBLE.test(String(reply.getHeader('content-type') ?? ''))) return payload;
    if (Buffer.byteLength(payload) < MIN_COMPRESSED_BYTES) return payload;
    const vary = String(reply.getHeader('vary') ?? '');
    if (!/accept-encoding/i.test(vary)) reply.header('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
    if (!/\bgzip\b/i.test(String(request.headers['accept-encoding'] ?? ''))) return payload;
    reply.header('content-encoding', 'gzip');
    reply.removeHeader('content-length');
    return gzipAsync(payload);
  });
}
