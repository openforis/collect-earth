import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiAvailable } from '../ai/available.js';
import type { Config } from '../config.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';

/**
 * The AI assistant's project routes (admin). For now its switch: off by default, and
 * it can only be switched on while the assistant is available on the server (Vertex
 * configured and switched on by the server owner). Switching it off is always allowed.
 */
export async function registerAiRoutes(app: FastifyInstance, store: Store, config: Config): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/ai', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [enabled, settings] = await Promise.all([store.isAiEnabled(projectId), store.getSettings()]);
    return reply.send({ enabled, available: aiAvailable(config, settings) });
  });

  app.put('/v1/projects/:pid/ai', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const enabled = ((request.body ?? {}) as { enabled?: unknown }).enabled;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'bad_request', reason: 'enabled must be true or false' });
    }
    const available = aiAvailable(config, await store.getSettings());
    if (enabled && !available) {
      return reply.code(409).send({
        error: 'ai_unavailable',
        reason: 'The AI assistant is not available on this server. The server owner can set it up and switch it on.',
      });
    }
    await store.setAiEnabled(projectId, enabled);
    return reply.send({ enabled, available });
  });
}
