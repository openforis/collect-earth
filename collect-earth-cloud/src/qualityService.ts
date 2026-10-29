// The quality figures of a project, as the routes serve them: their inputs loaded the
// way the export loads them, the outline read from the SERVED project file, the
// report cached per project while its inputs do not change, and computed on a worker
// thread when the store lets one read the records itself.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readCep, type RoundInfo } from './cep.js';
import { copyHoldersOf } from './division.js';
import { plotIdsOf } from './plotFileCache.js';
import { qualityReport, type QualityInput, type QualityReport } from './quality.js';
import type { WorkerJob, WorkerReply } from './qualityWorker.js';
import { fileKeyCount } from './rounds.js';
import type { Store } from './store/store.js';
import { surveyOutline, type Question } from './surveyOutline.js';
import type { CsvFile, Member, QualitySettings } from './types.js';

/** Reports kept, one per project (least recently used out first). */
export const MAX_CACHED_REPORTS = 4;
/** Outlines kept, by the served project file's sha256. */
export const MAX_CACHED_OUTLINES = 8;

/** What gets logged: the request logger, or the app's. */
export interface Log {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** The plots of every plot file and who holds which as a copy, as the export and the division read them. */
export interface PlotContext {
  info: RoundInfo | null;
  /** The plot ids (units) of every plot file, read with fileKeyCount. */
  units: Set<string>;
  /** unit -> usernames holding it only as a quality-check copy, across the divided files. */
  copyHolders: Map<string, Set<string>>;
}

/**
 * The plot ids of every plot file (one file at a time; plotIdsOf keeps only the ids)
 * and the copy holders of the divided files. A file that cannot be read is logged and
 * left out: its records still get a plot.
 */
export async function loadPlotContext(
  store: Store,
  projectId: string,
  log: Log,
  known: { info?: RoundInfo | null; files?: CsvFile[]; members?: Member[] } = {},
): Promise<PlotContext> {
  const [info, files, members, holdings] = await Promise.all([
    known.info !== undefined ? known.info : store.getRoundInfo(projectId),
    known.files ?? store.listCsvFiles(projectId),
    known.members ?? store.listMembers(projectId),
    store.listDividedHoldings(projectId),
  ]);
  const keyCount = fileKeyCount(info);
  const units = new Set<string>();
  for (const meta of files) {
    try {
      const file = await store.getCsvFile(projectId, meta.id);
      if (!file) {
        continue;
      }
      for (const id of plotIdsOf(file, keyCount)) {
        units.add(id);
      }
    } catch (err) {
      log.error({ err, csvFileId: meta.id }, 'could not read the plot file');
    }
  }
  // Main holdings too: someone holding a plot as main in one file and as a copy in
  // another is not taken for its checker.
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  return { info, units, copyHolders: copyHoldersOf(holdings, usernames) };
}

/** Thrown by QualityWorker.run when no worker can be started (the job never ran). */
export class WorkerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`the quality worker could not start: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'WorkerUnavailableError';
  }
}

/**
 * The node flags a worker needs to load TypeScript: the server runs under tsx (`npm
 * start`, the Docker image), whose loader flags a worker inherits; elsewhere (vitest)
 * tsx's loader is added.
 */
function workerExecArgv(): string[] {
  const argv = process.execArgv;
  if (argv.some((a) => a.includes('tsx'))) {
    return argv;
  }
  const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  return [...argv, '--import', loader];
}

const WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? './qualityWorker.ts' : './qualityWorker.js', import.meta.url);

/**
 * One worker thread for the quality figures, started on first use and kept (unref'd
 * while idle, so it never holds the process open). A worker that stops takes its jobs
 * with it (they fail) and the next job starts a new one. A worker that cannot even load
 * makes every later run fail with WorkerUnavailableError.
 */
export class QualityWorker {
  private worker: Worker | null = null;
  private unavailable: unknown = null;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: QualityReport) => void; reject: (e: unknown) => void }>();

  run(job: WorkerJob): Promise<QualityReport> {
    if (this.unavailable !== null) {
      return Promise.reject(new WorkerUnavailableError(this.unavailable));
    }
    if (this.closed) {
      return Promise.reject(new Error('the quality worker is closed'));
    }
    let worker: Worker;
    try {
      worker = this.worker ?? this.start();
    } catch (err) {
      this.unavailable = err;
      return Promise.reject(new WorkerUnavailableError(err));
    }
    const id = this.nextId++;
    return new Promise<QualityReport>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.ref();
      worker.postMessage({ id, job });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      await worker.terminate();
    }
  }

  private start(): Worker {
    const worker = new Worker(WORKER_URL, { execArgv: workerExecArgv() });
    let ready = false;
    worker.on('message', (message: WorkerReply) => {
      if ('ready' in message) {
        ready = true;
        return;
      }
      const job = this.pending.get(message.id);
      if (!job) {
        return;
      }
      this.pending.delete(message.id);
      if (this.pending.size === 0) {
        worker.unref();
      }
      if ('error' in message) {
        job.reject(new Error(message.error));
      } else {
        job.resolve(message.report);
      }
    });
    worker.on('error', (err) => {
      if (!ready) {
        this.unavailable = err;
      }
      this.stopped(worker, err);
    });
    worker.on('exit', (code) => this.stopped(worker, new Error(`the quality worker stopped (exit code ${code})`)));
    worker.unref();
    this.worker = worker;
    return worker;
  }

  private stopped(worker: Worker, err: unknown): void {
    if (this.worker !== worker) {
      return;
    }
    this.worker = null;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    const reason = this.unavailable !== null ? new WorkerUnavailableError(this.unavailable) : err;
    for (const job of jobs) {
      job.reject(reason);
    }
  }
}

/** What a QualityService needs of a worker (QualityWorker, or a stand-in in tests). */
export interface QualityRunner {
  run(job: WorkerJob): Promise<QualityReport>;
  close(): Promise<void>;
}

/** Least recently used out first. */
function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    map.delete(map.keys().next().value as K);
  }
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/**
 * The quality figures of each project. A report is cached (MAX_CACHED_REPORTS projects)
 * under the version of its inputs: the store's qualityVersion (records and divided
 * holdings), the round info, the served project file's size and time, the plot files'
 * checksums, the members and the settings. Reading those takes a few small queries and
 * no records, so an unchanged project is answered at once, and any change (a new
 * record, a division, a margin) gives a new version. Requests for the same version
 * share one computation.
 *
 * Computing: with a store whose records another thread can read (Postgres), the worker
 * reads them and computes, so neither the JSON parsing of 100k summaries nor the
 * figures (1-3 s) block the event loop. The memory store's records live only in this
 * thread, and posting them to a worker costs more than computing here (structured
 * cloning 100k records of 189 answers took about 15 s of this thread), so they are
 * computed here. A worker that cannot start falls back to computing here, logged once.
 */
export class QualityService {
  private readonly reports = new Map<string, { version: string; report: QualityReport }>();
  private readonly running = new Map<string, { version: string; promise: Promise<QualityReport> }>();
  private readonly outlines = new Map<string, ReadonlyMap<string, Question> | null>();
  private warnedUnavailable = false;
  /** How many reports were computed (for tests). */
  computed = 0;

  constructor(
    private readonly store: Store,
    private readonly runner: QualityRunner | null = new QualityWorker(),
  ) {}

  async report(projectId: string, log: Log): Promise<QualityReport> {
    const [inputs, info, cep, files, members, settings] = await Promise.all([
      this.store.qualityVersion(projectId),
      this.store.getRoundInfo(projectId),
      this.store.getCepInfo(projectId),
      this.store.listCsvFiles(projectId),
      this.store.listMembers(projectId),
      this.store.getQualitySettings(projectId),
    ]);
    const version = sha256(
      JSON.stringify([
        inputs,
        info,
        cep,
        files.map((f) => [f.id, f.checksum, f.distribution ?? null]),
        members.map((m) => [m.userId, m.username]),
        settings,
      ]),
    );
    const cached = this.reports.get(projectId);
    if (cached?.version === version) {
      remember(this.reports, projectId, cached, MAX_CACHED_REPORTS);
      return cached.report;
    }
    const running = this.running.get(projectId);
    if (running?.version === version) {
      return running.promise;
    }
    const promise = this.compute(projectId, log, { info, files, members, settings }).then((report) => {
      remember(this.reports, projectId, { version, report }, MAX_CACHED_REPORTS);
      return report;
    });
    this.running.set(projectId, { version, promise });
    const forget = () => {
      if (this.running.get(projectId)?.promise === promise) {
        this.running.delete(projectId);
      }
    };
    promise.then(forget, forget);
    return promise;
  }

  /** The outline of the served project file's survey (cached by its sha256), or null without a readable one. */
  async outline(projectId: string, log: Log): Promise<ReadonlyMap<string, Question> | null> {
    const cep = await this.store.getCep(projectId);
    if (!cep) {
      return null;
    }
    const checksum = sha256(cep);
    if (this.outlines.has(checksum)) {
      const hit = this.outlines.get(checksum)!;
      remember(this.outlines, checksum, hit, MAX_CACHED_OUTLINES);
      return hit;
    }
    let outline: ReadonlyMap<string, Question> | null = null;
    try {
      const files = readCep(cep);
      outline = surveyOutline(new TextDecoder().decode(files.entries.get(files.surveyPath)!));
    } catch (err) {
      log.warn({ err }, 'quality: could not read the survey of the project file');
    }
    remember(this.outlines, checksum, outline, MAX_CACHED_OUTLINES);
    return outline;
  }

  async close(): Promise<void> {
    await this.runner?.close();
  }

  private async compute(
    projectId: string,
    log: Log,
    known: { info: RoundInfo | null; files: CsvFile[]; members: Member[]; settings: QualitySettings },
  ): Promise<QualityReport> {
    const [context, outline] = await Promise.all([loadPlotContext(this.store, projectId, log, known), this.outline(projectId, log)]);
    const input: Omit<QualityInput, 'records'> = { ...context, outline, margins: known.settings.margins };
    this.computed += 1;
    const source = this.store.recordsSource();
    if (source && this.runner) {
      try {
        return await this.runner.run({ input, source: { ...source, projectId } });
      } catch (err) {
        if (!(err instanceof WorkerUnavailableError)) {
          throw err;
        }
        if (!this.warnedUnavailable) {
          this.warnedUnavailable = true;
          log.warn({ err }, 'quality: no worker thread, the figures are computed on the event loop');
        }
      }
    }
    const records = await this.store.listRecordSummaries(projectId);
    // Let what is waiting run first: the figures then hold the loop for a while.
    await new Promise((resolve) => setImmediate(resolve));
    return qualityReport({ ...input, records });
  }
}
