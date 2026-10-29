// The quality figures, computed on a worker thread (see src/qualityService.ts). A job
// either names the database to read the project's records from (the worker opens its
// own small pool: the records are parsed here, not on the server's event loop) or
// carries the records itself.
import { parentPort } from 'node:worker_threads';
import { qualityReport, type QualityInput, type QualityRecord } from './quality.js';
import { PostgresStore } from './store/postgres.js';

export type WorkerJob = { input: Omit<QualityInput, 'records'> } & (
  | { source: { databaseUrl: string; projectId: string } }
  | { records: QualityRecord[] }
);

export type WorkerRequest = { id: number; job: WorkerJob };
/**
 * `ready` once, when the module has loaded (so a worker that cannot load is told apart
 * from a failing job); `computing` when a job's records are read and the figures (which
 * hold the thread) start, so that running out of memory then is put down to that job;
 * then its report, or a short error (the stack is logged here, never sent on).
 */
export type WorkerReply =
  | { ready: true }
  | { id: number; computing: true }
  | { id: number; report: ReturnType<typeof qualityReport> }
  | { id: number; error: string };

/** The longest error message sent back: it is for the server's log, not for clients. */
export const MAX_ERROR_LENGTH = 300;

/** The longest a read of the records may take (the job itself fails after 120 s, see QualityWorker). */
export const WORKER_STATEMENT_TIMEOUT_MS = 90_000;

/** One pool per database, kept between jobs; two connections are plenty for the two jobs the worker takes. */
const stores = new Map<string, PostgresStore>();

async function recordsOf(job: WorkerJob): Promise<QualityRecord[]> {
  if ('records' in job) {
    return job.records;
  }
  const { databaseUrl, projectId } = job.source;
  let store = stores.get(databaseUrl);
  if (!store) {
    store = new PostgresStore(databaseUrl, {
      max: 2,
      connectionTimeoutMillis: 10_000,
      statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS,
      onPoolError: (err) => {
        // eslint-disable-next-line no-console
        console.error('quality worker: an idle connection of the pool failed:', err.message);
      },
    });
    stores.set(databaseUrl, store);
  }
  return store.listRecordSummaries(projectId);
}

const port = parentPort;
if (port) {
  port.on('message', (message: WorkerRequest) => {
    void (async () => {
      let reply: WorkerReply;
      try {
        const records = await recordsOf(message.job);
        port.postMessage({ id: message.id, computing: true } satisfies WorkerReply);
        reply = { id: message.id, report: qualityReport({ ...message.job.input, records }) };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('quality worker: a job failed:', err);
        const text = err instanceof Error ? err.message : String(err);
        reply = { id: message.id, error: text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text };
      }
      port.postMessage(reply);
    })();
  });
  port.postMessage({ ready: true } satisfies WorkerReply);
}
