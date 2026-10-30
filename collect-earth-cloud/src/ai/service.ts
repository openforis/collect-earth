// The AI assistant's runs on the server (Task 15): a run is started by a request, checked
// against the limits and stored as running under a lock, then runs in the background in
// this process. It loads the project's data (one project, through the store's RLS), runs
// src/ai/run.ts, writes its progress (tool calls, tokens) as it goes and its end: the
// pseudonymous result with its mappings, a failure code, or a refusal.
import { loadPlotContext, WorkerBusyError, WorkerRestartedError, type Log, type QualityService } from '../qualityService.js';
import { recordsOfPlot } from '../quality.js';
import type { Store } from '../store/store.js';
import { AI_INTERRUPTED, type AiRunWindow, type RecordRow, type ServerSettings } from '../types.js';
import { AiError, type AiClient, type AiResponse } from './client.js';
import type { AiLanguage, FollowUpAction } from './prompts.js';
import {
  FAILURE_MESSAGES,
  runFollowUp,
  runQuestion,
  runReport,
  type AiAnswer,
  type AiReport,
  type AiRunContext,
  type AiRunLimits,
  type RunOutcome,
  type RunProgress,
  type StoredResult,
} from './run.js';

/** A run still running this long after it started is taken for dead (crashed, or cut off) and failed as `interrupted`. */
export const RUN_STALE_MS = 10 * 60_000;
/**
 * A run's own time limit: no call to the model starts after it, and none may last past
 * it, so a live run is always younger than RUN_STALE_MS (the tools and the store take
 * the rest).
 */
export const RUN_DEADLINE_MS = 9 * 60_000;
/** While the quality figures' worker is busy with other projects, the run waits and tries again. */
export const CONTEXT_RETRY_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** The UTC day and month of a time, and when the next ones begin (the limits' windows). */
export function limitWindows(now: number): { dayStart: number; nextDay: number; monthStart: number; nextMonth: number } {
  const d = new Date(now);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    dayStart,
    nextDay: dayStart + DAY_MS,
    monthStart: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
    nextMonth: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  };
}

/** What a run is asked to do, once the route has checked it (the parent is a done report of the project). */
export type RunRequest =
  | { kind: 'report'; language: AiLanguage }
  | { kind: 'follow_up'; language: AiLanguage; parentRun: string; parent: StoredResult<AiReport>; findingIndex: number; action: FollowUpAction }
  | { kind: 'question'; language: AiLanguage; parentRun: string; parent: StoredResult<AiReport>; question: string };

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; limit: 'busy' }
  | { ok: false; limit: 'daily' | 'monthly'; resetsAt: number };

export interface AiRunServiceOptions {
  /** Null when the assistant is not set up (no run can start). */
  client: AiClient | null;
  /** Stored with each run. */
  model: string;
  /** The clock of the limits and of the stored times; Date.now by default. */
  now?: () => number;
  limits?: Partial<AiRunLimits>;
  /** For tests: a shorter RUN_DEADLINE_MS. */
  deadlineMs?: number;
  /** For tests: a shorter CONTEXT_RETRY_MS. */
  contextRetryMs?: number;
}

/** A client whose calls never start after `deadline` (real time) nor last past it. */
function withDeadline(client: AiClient, deadline: number): AiClient {
  return {
    async generate(req): Promise<AiResponse> {
      const left = deadline - Date.now();
      if (left < 1000) {
        throw new AiError('The run reached its time limit.', { timeout: true });
      }
      const timeoutMs = Math.min(req.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, left);
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AiError('The run reached its time limit.', { timeout: true })), left);
      });
      try {
        return await Promise.race([client.generate({ ...req, timeoutMs }), late]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export class AiRunService {
  /** Runs this process is running: what close() fails as interrupted. */
  private readonly inFlight = new Map<string, { projectId: string; done: Promise<void> }>();
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly quality: QualityService,
    private readonly log: Log & { info(obj: unknown, msg?: string): void },
    private readonly options: AiRunServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get hasClient(): boolean {
    return this.options.client !== null;
  }

  /** The window a new run is checked against now, with these settings. */
  window(settings: ServerSettings): AiRunWindow & { nextDay: number; nextMonth: number } {
    const now = this.now();
    const w = limitWindows(now);
    return {
      now,
      staleBefore: now - RUN_STALE_MS,
      dayStart: w.dayStart,
      monthStart: w.monthStart,
      nextDay: w.nextDay,
      nextMonth: w.nextMonth,
      reportsPerDay: settings.aiReportsPerDay,
      followUpsPerDay: settings.aiFollowUpsPerDay,
      monthlyTokens: settings.aiMonthlyTokens,
    };
  }

  /** Checks the limits and stores the run; it then runs in the background. */
  async start(projectId: string, userId: string, req: RunRequest, settings: ServerSettings): Promise<StartResult> {
    const client = this.options.client;
    if (!client) {
      throw new Error('the AI assistant is not set up');
    }
    const w = this.window(settings);
    const started = await this.store.startAiRun(
      projectId,
      {
        kind: req.kind,
        startedBy: userId,
        model: this.options.model,
        parentRun: req.kind === 'report' ? null : req.parentRun,
        findingIndex: req.kind === 'follow_up' ? req.findingIndex : null,
        action: req.kind === 'follow_up' ? req.action : null,
        question: req.kind === 'question' ? req.question : null,
      },
      w,
    );
    if (!started.ok) {
      if (started.limit === 'busy') return { ok: false, limit: 'busy' };
      return { ok: false, limit: started.limit, resetsAt: started.limit === 'daily' ? w.nextDay : w.nextMonth };
    }
    const runId = started.run.id;
    const done = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.execute(projectId, runId, req, client)
          .catch((err: unknown) => this.log.error({ err, projectId, runId }, 'ai: the run could not be ended'))
          .finally(() => {
            this.inFlight.delete(runId);
            resolve();
          });
      });
    });
    this.inFlight.set(runId, { projectId, done });
    return { ok: true, runId };
  }

  /** Fails the runs left running too long, of one project (or of all, at boot). */
  failStale(projectId: string | null): Promise<number> {
    const now = this.now();
    return this.store.failStaleAiRuns(projectId, now - RUN_STALE_MS, AI_INTERRUPTED.code, AI_INTERRUPTED.message, now);
  }

  /** Resolves when no run of this process is running (tests). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight.values()].map((r) => r.done));
    }
  }

  /**
   * The server stops: the runs of this process cannot end, so they are failed as
   * interrupted now. Their calls may still come back; ending them then changes nothing.
   */
  async close(): Promise<void> {
    const now = this.now();
    await Promise.all(
      [...this.inFlight].map(([runId, r]) =>
        this.store
          .finishAiRun(r.projectId, runId, {
            status: 'failed',
            errorCode: AI_INTERRUPTED.code,
            error: AI_INTERRUPTED.message,
            result: null,
            finishedAt: now,
            ...this.lastProgress(runId),
          })
          .catch((err: unknown) => this.log.error({ err, runId }, 'ai: could not mark the run interrupted')),
      ),
    );
  }

  private readonly progress = new Map<string, RunProgress>();

  private lastProgress(runId: string): { inputTokens: number; outputTokens: number; toolCalls: RunProgress['toolCalls'] } {
    const p = this.progress.get(runId);
    return { inputTokens: p?.inputTokens ?? 0, outputTokens: p?.outputTokens ?? 0, toolCalls: p?.toolCalls ?? [] };
  }

  private async execute(projectId: string, runId: string, req: RunRequest, client: AiClient): Promise<void> {
    const deadline = Date.now() + (this.options.deadlineMs ?? RUN_DEADLINE_MS);
    let outcome: RunOutcome<AiReport | AiAnswer>;
    try {
      const ctx = await this.context(projectId, runId, req.language, withDeadline(client, deadline), deadline);
      outcome =
        req.kind === 'report'
          ? await runReport(ctx)
          : req.kind === 'follow_up'
            ? await runFollowUp(ctx, req.parent, req.findingIndex, req.action)
            : await runQuestion(ctx, req.parent, req.question);
    } catch (err) {
      this.log.error({ err, projectId, runId }, 'ai: the run could not load the project data');
      outcome = { ...this.lastProgress(runId), modelCalls: 0, status: 'failed', code: 'server_error', error: FAILURE_MESSAGES.server_error };
    }
    this.progress.delete(runId);
    const used = { inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, toolCalls: outcome.toolCalls };
    const finishedAt = this.now();
    let ended: boolean;
    if (outcome.status === 'done') {
      const stored: StoredResult<unknown> = { result: outcome.result, pseudonyms: outcome.pseudonyms, plots: outcome.plots };
      ended = await this.store.finishAiRun(projectId, runId, { ...used, status: 'done', result: stored, error: null, errorCode: null, finishedAt });
    } else if (outcome.status === 'refused') {
      ended = await this.store.finishAiRun(projectId, runId, { ...used, status: 'refused', result: null, error: outcome.message, errorCode: 'off_topic', finishedAt });
    } else {
      // The cause (a block reason, the service's error, an exception) is for this log only.
      this.log.warn({ projectId, runId, code: outcome.code, httpStatus: outcome.httpStatus, cause: outcome.cause }, 'ai: a run failed');
      ended = await this.store.finishAiRun(projectId, runId, { ...used, status: 'failed', result: null, error: outcome.error, errorCode: outcome.code, finishedAt });
    }
    if (!ended) {
      this.log.warn({ projectId, runId }, 'ai: the run ended after it was taken for interrupted; its end is not stored');
    }
  }

  /** The project's data for one run, read through the store (one project, under its RLS). */
  private async context(projectId: string, runId: string, language: AiLanguage, client: AiClient, deadline: number): Promise<AiRunContext> {
    const [report, outline, notes, members, plotContext] = await Promise.all([
      this.figures(projectId, deadline),
      this.quality.outline(projectId, this.log),
      this.store.listGuidanceNotes(projectId),
      this.store.listMembers(projectId),
      loadPlotContext(this.store, projectId, this.log),
    ]);
    let records: Promise<RecordRow[]> | null = null;
    return {
      client,
      language,
      members: members.map((m) => m.username),
      report,
      outline,
      notes,
      plots: plotContext.units,
      plotRecords: async (plot) => {
        records ??= this.store.listRecordSummaries(projectId);
        return recordsOfPlot({ records: await records, info: plotContext.info, units: plotContext.units, copyHolders: plotContext.copyHolders }, plot);
      },
      ...(this.options.limits ? { limits: this.options.limits } : {}),
      onProgress: async (p) => {
        this.progress.set(runId, p);
        try {
          await this.store.updateAiRun(projectId, runId, { inputTokens: p.inputTokens, outputTokens: p.outputTokens, toolCalls: p.toolCalls });
        } catch (err) {
          // The run goes on: its end stores the same figures.
          this.log.warn({ err, projectId, runId }, 'ai: could not store the progress of a run');
        }
      },
    };
  }

  /** The quality figures (cached), waiting while the worker is busy with other projects. */
  private async figures(projectId: string, deadline: number) {
    const retry = this.options.contextRetryMs ?? CONTEXT_RETRY_MS;
    for (;;) {
      try {
        return (await this.quality.report(projectId, this.log)).report;
      } catch (err) {
        const busy = err instanceof WorkerBusyError || err instanceof WorkerRestartedError;
        if (!busy || Date.now() + retry > deadline - 60_000) throw err;
        await new Promise((resolve) => setTimeout(resolve, retry));
      }
    }
  }
}


declare module 'fastify' {
  interface FastifyInstance {
    /** The AI assistant's runs (tests wait on it with idle()). */
    aiRuns: AiRunService;
  }
}
