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
/** `ready` once, when the module has loaded (so a worker that cannot load is told apart from a failing job). */
export type WorkerReply = { ready: true } | { id: number; report: ReturnType<typeof qualityReport> } | { id: number; error: string };

/** One pool per database, kept between jobs; two connections are plenty for one job at a time. */
const stores = new Map<string, PostgresStore>();

async function recordsOf(job: WorkerJob): Promise<QualityRecord[]> {
  if ('records' in job) {
    return job.records;
  }
  const { databaseUrl, projectId } = job.source;
  let store = stores.get(databaseUrl);
  if (!store) {
    store = new PostgresStore(databaseUrl, { max: 2 });
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
        reply = { id: message.id, report: qualityReport({ ...message.job.input, records }) };
      } catch (err) {
        reply = { id: message.id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
      }
      port.postMessage(reply);
    })();
  });
  port.postMessage({ ready: true } satisfies WorkerReply);
}
