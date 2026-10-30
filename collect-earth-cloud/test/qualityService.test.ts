import { afterEach, describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { qualityReport, type QualityRecord } from '../src/quality.js';
import {
  FAILURE_MEMO_MS,
  MIN_COMPUTE_INTERVAL_MS,
  QualityService,
  QualityWorker,
  STALE_MS,
  WorkerBusyError,
  WorkerRestartedError,
  WorkerUnavailableError,
  type QualityRunner,
} from '../src/qualityService.js';
import type { WorkerJob } from '../src/qualityWorker.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { Question } from '../src/surveyOutline.js';

const added: RoundInfo = {
  state: 'added',
  refusal: null,
  keyCount: 2,
  roundIndex: 1,
  roundCodes: [
    { code: '1', label: 'First assessment' },
    { code: '2', label: 'Re-assessment' },
  ],
  reassessmentCode: '2',
};

const outline = new Map<string, Question>([
  ['collect_code_land_use', { key: 'collect_code_land_use', label: 'Land use', kind: 'choice', options: [], help: null, excluded: false, multiple: false, calculated: false }],
]);

function records(n: number): QualityRecord[] {
  const out: QualityRecord[] = [];
  for (let i = 1; i <= n; i++) {
    const base = { modifiedOn: Date.UTC(2026, 9, 1), activelySaved: true, deleted: false };
    out.push({ ...base, recordKey: `${i},1`, operator: 'ana', summary: { collect_code_land_use: 'forest' } });
    out.push({ ...base, recordKey: `${i},2`, operator: 'ben', summary: { collect_code_land_use: i % 4 === 0 ? 'crop' : 'forest' } });
  }
  return out;
}

describe('QualityWorker', () => {
  let worker: QualityWorker | null = null;
  afterEach(async () => {
    await worker?.close();
    worker = null;
  });

  it('computes the report on a worker thread, the same as on this one', async () => {
    worker = new QualityWorker();
    const input = { info: added, units: new Set(Array.from({ length: 40 }, (_, i) => String(i + 1))), copyHolders: new Map(), outline, margins: {} };
    const recs = records(40);
    const [a, b] = await Promise.all([worker.run({ input, records: recs }), worker.run({ input, records: recs.slice(0, 40) })]);
    expect(a).toEqual(qualityReport({ ...input, records: recs }));
    expect(a.plotsChecked).toBe(40);
    expect(a.plotsDiffering).toBe(10);
    expect(b.plotsChecked).toBe(20);
  }, 30_000);

  it('a failing job fails alone, and the worker goes on', async () => {
    worker = new QualityWorker();
    const input = { info: added, units: new Set<string>(), copyHolders: new Map(), outline: null, margins: {} };
    // No database listens there: the worker's read of the records fails.
    const failed = await worker.run({ input, source: { databaseUrl: 'postgres://nobody:x@127.0.0.1:1/none', projectId: 'p' } }).catch((e: Error) => e);
    expect(failed).toBeInstanceOf(Error);
    // Only a short message comes back: the stack stays in the worker's log.
    expect((failed as Error).message).not.toMatch(/\n|\s+at\s|\.ts|node_modules/);
    expect((failed as Error).message.length).toBeLessThanOrEqual(301);
    const report = await worker.run({ input, records: records(2) });
    expect(report.plotsChecked).toBe(2);
  }, 30_000);
});

const FAKE_WORKER = new URL('./fixtures/fakeQualityWorker.mjs', import.meta.url);
/** A job for the fake worker: how it should behave. */
const fake = (mode: 'echo' | 'hang' | 'busy' | 'oom') => ({ mode }) as unknown as WorkerJob;
type Echo = { echo: string; threadId: number };

describe('QualityWorker limits', () => {
  let worker: QualityWorker | null = null;
  afterEach(async () => {
    await worker?.close();
    worker = null;
  });

  it('a job that never answers fails after the time limit, and the next job gets a fresh worker', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 1500 });
    const first = (await worker.run(fake('echo'))) as unknown as Echo;
    await expect(worker.run(fake('hang'))).rejects.toThrow(/took longer than 1.5 s/);
    const next = (await worker.run(fake('echo'))) as unknown as Echo;
    expect(next.echo).toBe('echo');
    expect(next.threadId).not.toBe(first.threadId);
  }, 30_000);

  it('a job that holds its thread in a loop fails after the time limit too', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 1500 });
    await expect(worker.run(fake('busy'))).rejects.toThrow(/took longer than/);
    expect(((await worker.run(fake('echo'))) as unknown as Echo).echo).toBe('echo');
  }, 30_000);

  it('takes at most two jobs at a time', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 60_000 });
    const a = worker.run(fake('hang'));
    const b = worker.run(fake('hang'));
    await expect(worker.run(fake('echo'))).rejects.toBeInstanceOf(WorkerBusyError);
    const failed = Promise.all([expect(a).rejects.toThrow(/closed/), expect(b).rejects.toThrow(/closed/)]);
    await worker.close();
    await failed;
  }, 30_000);

  it('close() fails the jobs still running', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 60_000 });
    const job = worker.run(fake('hang'));
    const failed = expect(job).rejects.toThrow('the quality worker is closed');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await worker.close();
    await failed;
    await expect(worker.run(fake('echo'))).rejects.toThrow(/closed/);
  }, 30_000);

  it('a job running beside one that takes too long fails as restarted', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 1500 });
    const slow = worker.run(fake('busy'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const innocent = worker.run(fake('echo'));
    await Promise.all([expect(slow).rejects.toThrow(/took longer than/), expect(innocent).rejects.toBeInstanceOf(WorkerRestartedError)]);
    expect(((await worker.run(fake('echo'))) as unknown as Echo).echo).toBe('echo');
  }, 30_000);

  it('when a job runs out of memory, the one beside it fails as restarted, not out of memory', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 60_000, maxOldGenerationSizeMb: 32 });
    const innocent = worker.run(fake('hang'));
    const hungry = worker.run(fake('oom'));
    await Promise.all([
      expect(hungry).rejects.toThrow('the quality figures needed more memory than the 32 MB allowed (QUALITY_WORKER_MAX_MB)'),
      expect(innocent).rejects.toBeInstanceOf(WorkerRestartedError),
    ]);
    expect(((await worker.run(fake('echo'))) as unknown as Echo).echo).toBe('echo');
  }, 60_000);

  it('says whether it has room for another job', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 60_000 });
    expect(worker.hasRoom()).toBe(true);
    const a = worker.run(fake('hang'));
    const b = worker.run(fake('hang'));
    expect(worker.hasRoom()).toBe(false);
    const failed = Promise.all([expect(a).rejects.toThrow(/closed/), expect(b).rejects.toThrow(/closed/)]);
    await worker.close();
    await failed;
  }, 30_000);

  it('a job that runs out of memory fails with a plain message, and the next one runs', async () => {
    worker = new QualityWorker({ url: FAKE_WORKER, timeoutMs: 60_000, maxOldGenerationSizeMb: 32 });
    await expect(worker.run(fake('oom'))).rejects.toThrow('the quality figures needed more memory than the 32 MB allowed (QUALITY_WORKER_MAX_MB)');
    expect(((await worker.run(fake('echo'))) as unknown as Echo).echo).toBe('echo');
  }, 60_000);
});

/** A clock on which every report is older than STALE_MS by the next request: always computed afresh. */
function neverStale(): () => number {
  let t = 0;
  return () => (t += STALE_MS);
}

/** A memory store that claims another thread can read its records, for the worker path. */
class SourcedStore extends InMemoryStore {
  override recordsSource() {
    return { databaseUrl: 'postgres://example/db' };
  }
}

describe('QualityService', () => {
  it('hands the job to the worker when the store has a records source, and caches by version', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const jobs: WorkerJob[] = [];
    const runner: QualityRunner = {
      async run(job) {
        jobs.push(job);
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    const service = new QualityService(store, runner, { now: neverStale() });
    const log = { warn() {}, error() {} };
    await service.report(projectId, log);
    await service.report(projectId, log);
    expect(jobs).toHaveLength(1);
    expect('source' in jobs[0] && jobs[0].source).toEqual({ databaseUrl: 'postgres://example/db', projectId });
    expect(service.computed).toBe(1);
    // A new record is a new version.
    await store.putRecord({
      projectId, recordKey: '1', operator: 'ana', modifiedOn: 1, receivedAt: 1, activelySaved: true, step: 1, xml: null, summary: {}, deleted: false, deletedOn: null,
    });
    await service.report(projectId, log);
    expect(jobs).toHaveLength(2);
  });

  it('computes on this thread when no worker can start, and says so once', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const runner: QualityRunner = {
      async run() {
        throw new WorkerUnavailableError(new Error('no loader'));
      },
      async close() {},
    };
    const warned: unknown[] = [];
    const service = new QualityService(store, runner, { now: neverStale() });
    const log = { warn: (o: unknown) => warned.push(o), error() {} };
    expect((await service.report(projectId, log)).report.plotsChecked).toBe(0);
    await store.setQualitySettings(projectId, { margins: { x: 5 } });
    expect((await service.report(projectId, log)).report.plotsChecked).toBe(0);
    expect(service.computed).toBe(2);
    expect(warned).toHaveLength(1);
  });

  it('requests for the same version share one computation', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const runner: QualityRunner = {
      async run(job) {
        runs += 1;
        await gate;
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    const service = new QualityService(store, runner);
    const log = { warn() {}, error() {} };
    const all = Promise.all([service.report(projectId, log), service.report(projectId, log), service.report(projectId, log)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const [a, b, c] = await all;
    expect(runs).toBe(1);
    expect(a.report).toBe(b.report);
    expect(b.report).toBe(c.report);
  });

  /** A store with a records source, a runner whose jobs wait for release(), and a clock. */
  async function gated() {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const gates: (() => void)[] = [];
    let runs = 0;
    const runner: QualityRunner = {
      async run(job) {
        runs += 1;
        await new Promise<void>((resolve) => gates.push(resolve));
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    const clock = { now: 1_000_000 };
    const service = new QualityService(store, runner, { now: () => clock.now });
    let n = 0;
    const addRecord = () =>
      store.putRecord({
        projectId, recordKey: String(++n), operator: 'ana', modifiedOn: n, receivedAt: n, activelySaved: true, step: 1, xml: null, summary: {}, deleted: false, deletedOn: null,
      });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    return { store, projectId, service, gates, runs: () => runs, clock, addRecord, settle, log: { warn() {}, error() {} } };
  }

  it('while a computation runs, newer requests wait for it and then share one follow-up', async () => {
    const t = await gated();
    const first = t.service.report(t.projectId, t.log);
    await t.settle();
    expect(t.runs()).toBe(1);
    // Records keep coming in while it runs: each request has a new version.
    await t.addRecord();
    const a = t.service.report(t.projectId, t.log);
    await t.addRecord();
    const b = t.service.report(t.projectId, t.log);
    await t.addRecord();
    const c = t.service.report(t.projectId, t.log);
    await t.settle();
    expect(t.runs()).toBe(1);
    t.gates[0]();
    expect((await first).stale).toBe(false);
    await t.settle();
    // One follow-up, for the latest version.
    expect(t.runs()).toBe(2);
    t.gates[1]();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra.report).toBe(rb.report);
    expect(rb.report).toBe(rc.report);
    // It was computed for the latest version: asking again is cached.
    expect((await t.service.report(t.projectId, t.log)).report).toBe(rc.report);
    expect(t.runs()).toBe(2);
  });

  it('a report computed under two minutes ago is served at once as stale, and refreshed behind', async () => {
    const t = await gated();
    const first = t.service.report(t.projectId, t.log);
    await t.settle();
    t.gates[0]();
    const fresh = await first;
    expect(fresh).toMatchObject({ stale: false, computedAt: 1_000_000 });

    await t.addRecord();
    t.clock.now += STALE_MS - 1;
    const stale = await t.service.report(t.projectId, t.log);
    expect(stale).toMatchObject({ stale: true, computedAt: 1_000_000 });
    expect(stale.report).toBe(fresh.report);
    await t.settle();
    expect(t.runs()).toBe(2);
    // Asking again meanwhile does not start another computation.
    expect((await t.service.report(t.projectId, t.log)).stale).toBe(true);
    expect(t.runs()).toBe(2);
    t.gates[1]();
    await t.settle();
    const refreshed = await t.service.report(t.projectId, t.log);
    expect(refreshed).toMatchObject({ stale: false, computedAt: 1_000_000 + STALE_MS - 1 });
    expect(refreshed.report).not.toBe(fresh.report);

    // Older than two minutes: the request waits for the new figures.
    await t.addRecord();
    t.clock.now += STALE_MS;
    let done = false;
    const waiting = t.service.report(t.projectId, t.log).then((r) => {
      done = true;
      return r;
    });
    await t.settle();
    expect(done).toBe(false);
    t.gates[2]();
    expect((await waiting).stale).toBe(false);
  });

  it('starts at most one computation per project every 30 s: a request in between gets the last report as stale', async () => {
    const t = await gated();
    const first = t.service.report(t.projectId, t.log);
    await t.settle();
    t.gates[0]();
    await first;
    expect(t.runs()).toBe(1);

    // A new record 10 s later: within the interval, served stale, nothing started.
    await t.addRecord();
    t.clock.now += 10_000;
    expect(await t.service.report(t.projectId, t.log)).toMatchObject({ stale: true, computedAt: 1_000_000 });
    await t.settle();
    expect(t.runs()).toBe(1);
    t.clock.now += MIN_COMPUTE_INTERVAL_MS - 10_000 - 1;
    expect((await t.service.report(t.projectId, t.log)).stale).toBe(true);
    await t.settle();
    expect(t.runs()).toBe(1);

    // 30 s after the last start: a new computation, behind the stale report.
    t.clock.now += 1;
    expect((await t.service.report(t.projectId, t.log)).stale).toBe(true);
    await t.settle();
    expect(t.runs()).toBe(2);
    t.gates[1]();
    await t.settle();
    expect((await t.service.report(t.projectId, t.log)).stale).toBe(false);
  });

  it('the interval does not hold back a project with no report yet, nor a computation refused as busy', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    let busy = true;
    let runs = 0;
    const runner: QualityRunner = {
      async run(job) {
        runs += 1;
        if (busy) {
          throw new WorkerBusyError();
        }
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    let t = 0;
    const service = new QualityService(store, runner, { now: () => t });
    const log = { warn() {}, error() {} };
    // No report yet: each request may start one, however close together.
    await expect(service.report(projectId, log)).rejects.toBeInstanceOf(WorkerBusyError);
    busy = false;
    const first = await service.report(projectId, log);
    expect(first.stale).toBe(false);
    expect(runs).toBe(2);
    // A refresh refused as busy computed nothing: the next request may start one at once.
    await store.putRecord(record(projectId, '1'));
    t += MIN_COMPUTE_INTERVAL_MS;
    busy = true;
    expect((await service.report(projectId, log)).stale).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toBe(3);
    busy = false;
    t += 1000;
    expect((await service.report(projectId, log)).stale).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toBe(4);
    expect((await service.report(projectId, log)).stale).toBe(false);
  });

  it('a refresh behind a stale report that fails is logged, and the stale report still served', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    let fail = false;
    const runner: QualityRunner = {
      async run(job) {
        if (fail) {
          throw new WorkerBusyError();
        }
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    const warned: unknown[] = [];
    let t = 0;
    const service = new QualityService(store, runner, { now: () => t });
    const log = { warn: (o: unknown) => warned.push(o), error() {} };
    await service.report(projectId, log);
    fail = true;
    await store.setQualitySettings(projectId, { margins: { x: 5 } });
    t += MIN_COMPUTE_INTERVAL_MS;
    expect((await service.report(projectId, log)).stale).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(warned).toHaveLength(1);
  });

  it('computes on this thread with the memory store, and a new division is a new version', async () => {
    const store = new InMemoryStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const maria = await store.createUser({ username: 'maria', passwordHash: 'x', email: null });
    const jose = await store.createUser({ username: 'jose', passwordHash: 'x', email: null });
    await store.addMembership(projectId, maria.id, 'operator');
    await store.addMembership(projectId, jose.id, 'operator');
    const file = await store.putCsvFile(projectId, 'plots.csv', Buffer.from('id,lat,lon\n1,0,0\n'), ['1']);
    for (const operator of ['maria', 'jose']) {
      await store.putRecord({
        projectId, recordKey: '1', operator, modifiedOn: 1, receivedAt: 1, activelySaved: true, step: 1, xml: null,
        summary: { collect_code_land_use: operator === 'maria' ? 'F' : 'G' }, deleted: false, deletedOn: null,
      });
    }
    const service = new QualityService(store, null, { now: neverStale() });
    const log = { warn() {}, error() {} };
    // Two main assessments: nobody holds plot 1 as a copy.
    expect((await service.report(projectId, log)).report.problems.map((p) => p.kind)).toEqual(['two_main', 'two_main']);
    await store.setDivision(projectId, file.id, { mode: 'manual' }, [
      { plotKey: '1', userId: maria.id, overlap: false },
      { plotKey: '1', userId: jose.id, overlap: true },
    ]);
    const { report } = await service.report(projectId, log);
    expect(report).toMatchObject({ plotsChecked: 1, plotsDiffering: 1, problems: [] });
    expect(service.computed).toBe(2);
  });

  const record = (projectId: string, recordKey: string) => ({
    projectId, recordKey, operator: 'ana', modifiedOn: 1, receivedAt: 1, activelySaved: true, step: 1, xml: null, summary: {}, deleted: false, deletedOn: null,
  });

  it('a failed computation is not tried again for the same inputs for two minutes', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    let t = 0;
    let runs = 0;
    const runner: QualityRunner = {
      async run() {
        runs += 1;
        throw new Error('boom');
      },
      async close() {},
    };
    const service = new QualityService(store, runner, { now: () => t });
    const log = { warn() {}, error() {} };
    await expect(service.report(projectId, log)).rejects.toThrow('boom');
    t += FAILURE_MEMO_MS - 1;
    await expect(service.report(projectId, log)).rejects.toThrow('boom');
    expect(runs).toBe(1);
    // New inputs are tried at once; and the same ones after two minutes.
    await store.putRecord(record(projectId, '1'));
    await expect(service.report(projectId, log)).rejects.toThrow('boom');
    expect(runs).toBe(2);
    t += FAILURE_MEMO_MS;
    await expect(service.report(projectId, log)).rejects.toThrow('boom');
    expect(runs).toBe(3);
  });

  it('within those two minutes the last report is served as stale; busy and restarted are not remembered', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    let t = 0;
    let runs = 0;
    let failWith: Error | null = null;
    const runner: QualityRunner = {
      async run(job) {
        runs += 1;
        if (failWith) {
          throw failWith;
        }
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    const service = new QualityService(store, runner, { now: () => t });
    const log = { warn() {}, error() {} };
    const first = await service.report(projectId, log);
    t += STALE_MS + 1;
    await store.putRecord(record(projectId, '1'));
    failWith = new Error('boom');
    await expect(service.report(projectId, log)).rejects.toThrow('boom');
    expect(await service.report(projectId, log)).toEqual({ report: first.report, computedAt: first.computedAt, stale: true });
    expect(runs).toBe(2);

    for (const err of [new WorkerBusyError(), new WorkerRestartedError('another job took too long')]) {
      // Past the interval since the last computation that ran.
      t += MIN_COMPUTE_INTERVAL_MS;
      await store.putRecord(record(projectId, `${runs + 10}`));
      failWith = err;
      await expect(service.report(projectId, log)).rejects.toBe(err);
      const before = runs;
      await expect(service.report(projectId, log)).rejects.toBe(err);
      expect(runs).toBe(before + 1);
    }
  });

  it('answers busy before reading the plot files when the worker has no room', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    await store.putCsvFile(projectId, 'plots.csv', Buffer.from('id,lat,lon\n1,0,0\n'), ['1']);
    let reads = 0;
    const getCsvFile = store.getCsvFile.bind(store);
    store.getCsvFile = async (...args) => {
      reads += 1;
      return getCsvFile(...args);
    };
    const runner: QualityRunner = {
      hasRoom: () => false,
      async run() {
        throw new Error('not called');
      },
      async close() {},
    };
    const service = new QualityService(store, runner, { now: neverStale() });
    await expect(service.report(projectId, { warn() {}, error() {} })).rejects.toBeInstanceOf(WorkerBusyError);
    expect(reads).toBe(0);
  });

  it('computedAt is when the inputs were read, not when the figures were done', async () => {
    const store = new SourcedStore();
    const { projectId } = await store.createProject({ name: 'p' });
    let t = 1000;
    const runner: QualityRunner = {
      async run(job) {
        t = 9000;
        return qualityReport({ ...job.input, records: [] });
      },
      async close() {},
    };
    const service = new QualityService(store, runner, { now: () => t });
    expect((await service.report(projectId, { warn() {}, error() {} })).computedAt).toBe(1000);
  });
});
