import { afterEach, describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { qualityReport, type QualityRecord } from '../src/quality.js';
import { QualityService, QualityWorker, WorkerUnavailableError, type QualityRunner } from '../src/qualityService.js';
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
    await expect(worker.run({ input, source: { databaseUrl: 'postgres://nobody:x@127.0.0.1:1/none', projectId: 'p' } })).rejects.toThrow();
    const report = await worker.run({ input, records: records(2) });
    expect(report.plotsChecked).toBe(2);
  }, 30_000);
});

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
    const service = new QualityService(store, runner);
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
    const service = new QualityService(store, runner);
    const log = { warn: (o: unknown) => warned.push(o), error() {} };
    expect((await service.report(projectId, log)).plotsChecked).toBe(0);
    await store.setQualitySettings(projectId, { margins: { x: 5 } });
    expect((await service.report(projectId, log)).plotsChecked).toBe(0);
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
    expect(a).toBe(b);
    expect(b).toBe(c);
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
    const service = new QualityService(store, null);
    const log = { warn() {}, error() {} };
    // Two main assessments: nobody holds plot 1 as a copy.
    expect((await service.report(projectId, log)).problems.map((p) => p.kind)).toEqual(['two_main', 'two_main']);
    await store.setDivision(projectId, file.id, { mode: 'manual' }, [
      { plotKey: '1', userId: maria.id, overlap: false },
      { plotKey: '1', userId: jose.id, overlap: true },
    ]);
    const report = await service.report(projectId, log);
    expect(report).toMatchObject({ plotsChecked: 1, plotsDiffering: 1, problems: [] });
    expect(service.computed).toBe(2);
  });
});
