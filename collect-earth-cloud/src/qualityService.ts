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
  /** unit -> usernames holding it as a main plot, for every plot of a divided file (empty when no one does). */
  mainHolders: Map<string, Set<string>>;
  /** csv file id -> its units (files that could not be read are left out). */
  fileUnits: Map<string, readonly string[]>;
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
  const mainHolders = new Map<string, Set<string>>();
  const fileUnits = new Map<string, readonly string[]>();
  for (const meta of files) {
    try {
      const file = await store.getCsvFile(projectId, meta.id);
      if (!file) {
        continue;
      }
      const divided = meta.distribution != null;
      const ids = plotIdsOf(file, keyCount);
      fileUnits.set(meta.id, ids);
      for (const id of ids) {
        units.add(id);
        if (divided && !mainHolders.has(id)) {
          mainHolders.set(id, new Set());
        }
      }
    } catch (err) {
      log.error({ err, csvFileId: meta.id }, 'could not read the plot file');
    }
  }
  // Main holdings too: someone holding a plot as main in one file and as a copy in
  // another is not taken for its checker.
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  for (const a of holdings) {
    const username = usernames.get(a.userId);
    if (!a.overlap && username !== undefined) {
      let set = mainHolders.get(a.plotKey);
      if (!set) {
        set = new Set();
        mainHolders.set(a.plotKey, set);
      }
      set.add(username);
    }
  }
  return { info, units, copyHolders: copyHoldersOf(holdings, usernames), mainHolders, fileUnits };
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

/** How long one job may take before it fails and its worker is replaced. */
export const WORKER_JOB_TIMEOUT_MS = 120_000;
/** Jobs the worker takes at once; one more is refused with WorkerBusyError. */
export const MAX_WORKER_JOBS = 2;
/** The worker's heap, in MB, unless QUALITY_WORKER_MAX_MB says otherwise. */
export const DEFAULT_WORKER_MAX_MB = 256;

/** Thrown by QualityWorker.run when it already has MAX_WORKER_JOBS jobs (the job never ran). */
export class WorkerBusyError extends Error {
  constructor() {
    super('the quality worker is busy with other projects');
    this.name = 'WorkerBusyError';
  }
}

/**
 * Thrown by QualityWorker.run for a job that failed through no fault of its own: the
 * worker it ran on was restarted because another job took too long or ran out of
 * memory. Trying again shortly is fine (the routes answer 503 busy).
 */
export class WorkerRestartedError extends Error {
  constructor(why: string) {
    super(`the quality worker was restarted: ${why}`);
    this.name = 'WorkerRestartedError';
  }
}

export interface QualityWorkerOptions {
  /** The worker's module (tests use a stand-in). */
  url?: URL;
  /** Per job; WORKER_JOB_TIMEOUT_MS by default. */
  timeoutMs?: number;
  /** The worker's heap limit (resourceLimits.maxOldGenerationSizeMb); DEFAULT_WORKER_MAX_MB by default. */
  maxOldGenerationSizeMb?: number;
}

interface PendingJob {
  resolve: (r: QualityReport) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
  /** Its records are read and the figures (which hold the worker's thread) are being computed. */
  computing: boolean;
}

/**
 * One worker thread for the quality figures, started on first use and kept (unref'd
 * while idle, so it never holds the process open). It takes MAX_WORKER_JOBS jobs at a
 * time. A job that takes longer than the time limit fails, and its worker is stopped
 * (with any other job on it) so the next job starts a new one: a computation stuck in
 * a loop or a query cannot hold the thread for ever. A worker that stops (out of
 * memory, a crash) takes its jobs with it (they fail) and the next job starts a new
 * one. A worker that cannot even load makes every later run fail with
 * WorkerUnavailableError.
 */
export class QualityWorker {
  private worker: Worker | null = null;
  private unavailable: unknown = null;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();
  private readonly url: URL;
  private readonly timeoutMs: number;
  private readonly maxMb: number;

  constructor(options: QualityWorkerOptions = {}) {
    this.url = options.url ?? WORKER_URL;
    this.timeoutMs = options.timeoutMs ?? WORKER_JOB_TIMEOUT_MS;
    this.maxMb = options.maxOldGenerationSizeMb ?? DEFAULT_WORKER_MAX_MB;
  }

  /** Whether a job would not be refused as busy now (a worker that cannot start or is closed fails it otherwise). */
  hasRoom(): boolean {
    return this.unavailable !== null || this.closed || this.pending.size < MAX_WORKER_JOBS;
  }

  run(job: WorkerJob): Promise<QualityReport> {
    if (this.unavailable !== null) {
      return Promise.reject(new WorkerUnavailableError(this.unavailable));
    }
    if (this.closed) {
      return Promise.reject(new Error('the quality worker is closed'));
    }
    if (this.pending.size >= MAX_WORKER_JOBS) {
      return Promise.reject(new WorkerBusyError());
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
      const timer = setTimeout(() => this.timedOut(worker, id), this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer, computing: false });
      worker.ref();
      worker.postMessage({ id, job });
    });
  }

  /** Fails the jobs still running and stops the worker; later runs fail. */
  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.failAll(new Error('the quality worker is closed'));
    if (worker) {
      await worker.terminate();
    }
  }

  private start(): Worker {
    const worker = new Worker(this.url, { execArgv: workerExecArgv(), resourceLimits: { maxOldGenerationSizeMb: this.maxMb } });
    let ready = false;
    worker.on('message', (message: WorkerReply) => {
      if ('ready' in message) {
        ready = true;
        return;
      }
      if ('computing' in message) {
        const job = this.pending.get(message.id);
        if (job) {
          job.computing = true;
        }
        return;
      }
      const job = this.take(message.id);
      if (!job) {
        return;
      }
      if (this.pending.size === 0) {
        worker.unref();
      }
      if ('error' in message) {
        job.reject(new Error(message.error));
      } else {
        job.resolve(message.report);
      }
    });
    worker.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        this.outOfMemory(worker);
        return;
      }
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

  private take(id: number): PendingJob | undefined {
    const job = this.pending.get(id);
    if (job) {
      clearTimeout(job.timer);
      this.pending.delete(id);
    }
    return job;
  }

  private failAll(reason: unknown): void {
    for (const id of [...this.pending.keys()]) {
      this.take(id)!.reject(reason);
    }
  }

  /** A job over the time limit fails, and so does its worker, with whatever else runs on it. */
  private timedOut(worker: Worker, id: number): void {
    const job = this.take(id);
    if (!job) {
      return;
    }
    job.reject(new Error(`the quality figures took longer than ${this.timeoutMs / 1000} s`));
    if (this.worker === worker) {
      this.worker = null;
      this.failAll(new WorkerRestartedError('another job took too long'));
    }
    void worker.terminate();
  }

  /**
   * The worker ran out of memory. The figures hold its thread, so the job computing
   * them (it said so) is the one that did; the others (still reading their records)
   * fail as restarted. When that cannot be told (none or several computing), a lone
   * job is the one, and with several all fail as restarted.
   */
  private outOfMemory(worker: Worker): void {
    if (this.worker !== worker) {
      return;
    }
    this.worker = null;
    const computing = [...this.pending].filter(([, job]) => job.computing).map(([id]) => id);
    const guilty = computing.length === 1 ? computing[0] : this.pending.size === 1 ? [...this.pending.keys()][0] : null;
    if (guilty !== null) {
      this.take(guilty)!.reject(new Error(`the quality figures needed more memory than the ${this.maxMb} MB allowed (QUALITY_WORKER_MAX_MB)`));
    }
    this.failAll(new WorkerRestartedError('another job ran out of memory'));
  }

  private stopped(worker: Worker, err: unknown): void {
    if (this.worker !== worker) {
      return;
    }
    this.worker = null;
    this.failAll(this.unavailable !== null ? new WorkerUnavailableError(this.unavailable) : err);
  }
}

/** What a QualityService needs of a worker (QualityWorker, or a stand-in in tests). */
export interface QualityRunner {
  run(job: WorkerJob): Promise<QualityReport>;
  /** Whether a job would be taken now; when false the service answers busy before loading anything. Absent: always. */
  hasRoom?(): boolean;
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

/** A report served younger than this, when its inputs have changed since, is served as it is (stale) while a new one is computed. */
export const STALE_MS = 2 * 60_000;
/**
 * At most one computation is started per project in this long: a request in between,
 * when there is a report to show, gets it as stale. With request-based billing a page
 * that polls is what gives the server CPU, so this bounds the work polling can cause.
 */
export const MIN_COMPUTE_INTERVAL_MS = 30_000;
/** A computation that failed is not tried again for the same inputs for this long (the error is given again, or a stale report). */
export const FAILURE_MEMO_MS = 2 * 60_000;

/** The figures as served: when they were computed, and whether the inputs have changed since. */
export interface ServedReport {
  report: QualityReport;
  /** ms since the epoch: when the inputs it was computed from were read. */
  computedAt: number;
  /** True when records (or other inputs) changed after computedAt; newer figures are being computed. */
  stale: boolean;
}

interface CachedReport {
  version: string;
  report: QualityReport;
  computedAt: number;
}

interface Snapshot {
  version: string;
  /** When it was read: the computedAt of a report computed from it. */
  at: number;
  known: { info: RoundInfo | null; files: CsvFile[]; members: Member[]; settings: QualitySettings };
}

/** One project's computations: the one running, and at most one waiting to follow it. */
interface ProjectRuns {
  running: { version: string | null; promise: Promise<CachedReport> } | null;
  followUp: { promise: Promise<CachedReport>; resolve: (r: CachedReport) => void; reject: (e: unknown) => void; log: Log } | null;
}

/**
 * The quality figures of each project. A report is cached (MAX_CACHED_REPORTS projects)
 * under the version of its inputs: the store's qualityVersion (records and divided
 * holdings), the round info, the served project file's size and time, the plot files'
 * checksums, the members and the settings. Reading those takes a few small queries and
 * no records, so an unchanged project is answered at once, and any change (a new
 * record, a division, a margin) gives a new version.
 *
 * During collection the version changes all the time, so computations are coalesced
 * per project: one runs at a time; requests for its version wait for it; requests for
 * any other version wait for ONE follow-up computation, which starts when the running
 * one ends and reads the inputs as they are then. And a report computed less than
 * STALE_MS ago is served at once, marked stale, while the new one is computed behind
 * it.
 *
 * Computing: with a store whose records another thread can read (Postgres), the worker
 * reads them and computes, so neither the JSON parsing of 100k summaries nor the
 * figures (1-3 s) block the event loop. The memory store's records live only in this
 * thread, and posting them to a worker costs more than computing here (structured
 * cloning 100k records of 189 answers took about 15 s of this thread), so they are
 * computed here. A worker that cannot start falls back to computing here, logged once.
 */
export class QualityService {
  private readonly reports = new Map<string, CachedReport>();
  private readonly runs = new Map<string, ProjectRuns>();
  private readonly outlines = new Map<string, ReadonlyMap<string, Question> | null>();
  /** The last failed computation of each project, by the version of its inputs. */
  private readonly failures = new Map<string, { version: string; error: unknown; at: number }>();
  /** When each project's last computation started (cleared when it was refused as busy or restarted). */
  private readonly lastStarts = new Map<string, number>();
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private warnedUnavailable = false;
  /** How many reports were computed (for tests). */
  computed = 0;

  constructor(
    private readonly store: Store,
    private readonly runner: QualityRunner | null = new QualityWorker(),
    options: { now?: () => number; minIntervalMs?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? MIN_COMPUTE_INTERVAL_MS;
  }

  async report(projectId: string, log: Log): Promise<ServedReport> {
    const snapshot = await this.snapshot(projectId);
    const cached = this.reports.get(projectId);
    if (cached?.version === snapshot.version) {
      remember(this.reports, projectId, cached, MAX_CACHED_REPORTS);
      return { report: cached.report, computedAt: cached.computedAt, stale: false };
    }
    // The same inputs failed a moment ago: not tried again yet.
    const failure = this.failures.get(projectId);
    if (failure && failure.version === snapshot.version && this.now() - failure.at < FAILURE_MEMO_MS) {
      if (cached) {
        return { report: cached.report, computedAt: cached.computedAt, stale: true };
      }
      throw failure.error;
    }
    const pending = this.schedule(projectId, log, snapshot, cached !== undefined);
    if (pending === null) {
      return { report: cached!.report, computedAt: cached!.computedAt, stale: true };
    }
    if (cached && this.now() - cached.computedAt < STALE_MS) {
      pending.catch((err: unknown) => log.warn({ err }, 'quality: the figures could not be brought up to date'));
      return { report: cached.report, computedAt: cached.computedAt, stale: true };
    }
    const fresh = await pending;
    return { report: fresh.report, computedAt: fresh.computedAt, stale: false };
  }

  /**
   * The cached figures, without ever waiting for a computation: null when this instance
   * holds none for the project (none is started then). A cached report whose inputs
   * changed is served stale, and brought up to date behind it as report() would (one
   * computation at a time per project, at most one start per minIntervalMs, not again
   * soon after a failure). For pages that only glance at the figures (the Progress tab).
   */
  async peek(projectId: string, log: Log): Promise<ServedReport | null> {
    if (!this.reports.has(projectId)) {
      return null;
    }
    const snapshot = await this.snapshot(projectId);
    const cached = this.reports.get(projectId);
    if (!cached) {
      return null;
    }
    if (cached.version === snapshot.version) {
      return { report: cached.report, computedAt: cached.computedAt, stale: false };
    }
    const failure = this.failures.get(projectId);
    const failedLately = failure !== undefined && failure.version === snapshot.version && this.now() - failure.at < FAILURE_MEMO_MS;
    if (!failedLately) {
      this.schedule(projectId, log, snapshot, true)?.catch((err: unknown) => log.warn({ err }, 'quality: the figures could not be brought up to date'));
    }
    return { report: cached.report, computedAt: cached.computedAt, stale: true };
  }

  /**
   * The computation that will answer this snapshot: the running one for its version, or
   * the one follow-up. Null when there is a report to show and a computation of this
   * project started under minIntervalMs ago: none is started (nor queued) now.
   */
  private schedule(projectId: string, log: Log, snapshot: Snapshot, hasReport: boolean): Promise<CachedReport> | null {
    let runs = this.runs.get(projectId);
    if (runs?.running && runs.running.version === snapshot.version) {
      return runs.running.promise;
    }
    const lastStart = this.lastStarts.get(projectId);
    if (hasReport && lastStart !== undefined && this.now() - lastStart < this.minIntervalMs) {
      return null;
    }
    if (!runs) {
      runs = { running: null, followUp: null };
      this.runs.set(projectId, runs);
    }
    if (!runs.running) {
      return this.start(projectId, runs, log, snapshot);
    }
    if (runs.followUp) {
      runs.followUp.log = log;
      return runs.followUp.promise;
    }
    let resolve!: (r: CachedReport) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<CachedReport>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Waiters are attached by the caller; a stale request may have none.
    promise.catch(() => {});
    runs.followUp = { promise, resolve, reject, log };
    return promise;
  }

  /** Runs one computation (reading the inputs first when no snapshot is given), then the follow-up if one waits. */
  private start(projectId: string, runs: ProjectRuns, log: Log, snapshot: Snapshot | null): Promise<CachedReport> {
    const running: NonNullable<ProjectRuns['running']> = { version: snapshot?.version ?? null, promise: null as unknown as Promise<CachedReport> };
    const startedAt = this.now();
    remember(this.lastStarts, projectId, startedAt, MAX_CACHED_REPORTS * 4);
    running.promise = (async () => {
      const s = snapshot ?? (await this.snapshot(projectId));
      running.version = s.version;
      const cached = this.reports.get(projectId);
      if (cached?.version === s.version) {
        return cached;
      }
      let report: QualityReport;
      try {
        report = await this.compute(projectId, log, s.known);
      } catch (err) {
        // Busy or restarted is no fault of these inputs, and nothing was computed: tried
        // again on the next request, interval or not.
        if (!(err instanceof WorkerBusyError || err instanceof WorkerRestartedError)) {
          remember(this.failures, projectId, { version: s.version, error: err, at: this.now() }, MAX_CACHED_REPORTS * 4);
        } else if (this.lastStarts.get(projectId) === startedAt) {
          this.lastStarts.delete(projectId);
        }
        throw err;
      }
      this.failures.delete(projectId);
      const entry = { version: s.version, report, computedAt: s.at };
      remember(this.reports, projectId, entry, MAX_CACHED_REPORTS);
      return entry;
    })();
    runs.running = running;
    const done = () => {
      if (runs.running !== running) {
        return;
      }
      runs.running = null;
      const next = runs.followUp;
      runs.followUp = null;
      if (next) {
        this.start(projectId, runs, next.log, null).then(next.resolve, next.reject);
      } else if (this.runs.get(projectId) === runs) {
        this.runs.delete(projectId);
      }
    };
    running.promise.then(done, done);
    return running.promise;
  }

  /** The inputs' version, from a few small queries (no records), and what was read for it. */
  private async snapshot(projectId: string): Promise<Snapshot> {
    const at = this.now();
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
    return { version, at, known: { info, files, members, settings } };
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
    const source = this.store.recordsSource();
    // No room on the worker: say so before reading the plot files.
    if (source && this.runner?.hasRoom && !this.runner.hasRoom()) {
      throw new WorkerBusyError();
    }
    const [context, outline] = await Promise.all([loadPlotContext(this.store, projectId, log, known), this.outline(projectId, log)]);
    const input: Omit<QualityInput, 'records'> = { ...context, outline, margins: known.settings.margins };
    this.computed += 1;
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
