import { createGunzip } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './store/store.js';
import { registerAssignmentRoutes } from './routes/assignments.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerRecordRoutes } from './routes/records.js';

export interface BuildServerOptions {
  store: Store;
  config: Config;
  logger?: boolean;
}

/**
 * Builds the Fastify app around a Store. Kept free of process/network side effects
 * so tests can drive it with fastify.inject() and an in-memory store.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { store, config } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    // Record XML batches are small KBs each but a project sync can carry 50; allow headroom.
    bodyLimit: 32 * 1024 * 1024,
  });

  // The Java client gzips the records:batch body (Content-Encoding: gzip). Fastify
  // does not decompress request bodies by default, so swap in a gunzip stream
  // before the JSON parser runs. Other requests pass through untouched.
  app.addHook('preParsing', async (request, _reply, payload) => {
    const encoding = request.headers['content-encoding'];
    if (encoding && encoding.toLowerCase() === 'gzip') {
      // Decompressed length differs from Content-Length; drop both headers so the
      // body parser reads the inflated stream to EOF instead of rejecting a size
      // mismatch (Fastify returns 400 before the route's preHandler otherwise).
      delete request.headers['content-encoding'];
      delete request.headers['content-length'];
      return payload.pipe(createGunzip());
    }
    return payload;
  });

  // CEP uploads are raw zip bodies; buffer them so route handlers receive
  // request.body as a Buffer.
  const bufferBody = (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void): void =>
    done(null, body);
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, bufferBody);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, bufferBody);
  app.addContentTypeParser('text/csv', { parseAs: 'buffer' }, bufferBody);

  app.get('/health', async () => ({ status: 'ok' }));

  await registerAuthRoutes(app, store);
  await registerProjectRoutes(app, store, config);
  await registerPlatformRoutes(app, store, config);
  await registerAssignmentRoutes(app, store, config);
  await registerRecordRoutes(app, store);

  return app;
}
