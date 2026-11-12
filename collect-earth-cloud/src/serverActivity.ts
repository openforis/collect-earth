// The server activity log (migration 041): what server administrators did, kept for the server page's System section,
// and written to the server log as before. The action is done when this is called: a failure to keep it is logged, never
// turned into a failed request.
import type { FastifyRequest } from 'fastify';
import type { Store } from './store/store.js';
import type { ServerActivityInput } from './types.js';

export async function logServerAction(store: Store, request: FastifyRequest, entry: Omit<ServerActivityInput, 'actorUserId'>): Promise<void> {
  const actorUserId = request.userId ?? null;
  request.log.info(
    { action: entry.action, actorUserId, userId: entry.targetUserId ?? undefined, projectId: entry.projectId ?? undefined, ...(entry.details ?? {}) },
    `server administrator: ${entry.action}`,
  );
  try {
    await store.appendServerActivity({ actorUserId, ...entry });
  } catch (err) {
    request.log.error({ err, action: entry.action }, 'server activity: could not be kept');
  }
}
