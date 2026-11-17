// The database busy: no connection of the pool came free in time (PostgresStore, PG_CONNECT_TIMEOUT_MS). Apart from
// postgres.ts, which the local build replaces, so the server can tell it whatever the store.

/**
 * No connection of the pool came free within its wait (connectionTimeoutMillis): the database is busy. Answered 503
 * with Retry-After (statusCode, read by Fastify), so a client tries again later instead of a request waiting for ever.
 */
export class DatabaseBusyError extends Error {
  readonly statusCode = 503;
  readonly code = 'busy';
  constructor() {
    super('The server is busy: try again in a moment.');
    this.name = 'DatabaseBusyError';
  }
}

/** Whether pg-pool gave up waiting for a free connection (its message, it has no code) */
export const isPoolWaitTimeout = (err: unknown): boolean =>
  err instanceof Error && /timeout exceeded when trying to connect/i.test(err.message);
