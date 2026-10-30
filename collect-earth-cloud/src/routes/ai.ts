import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { aiAvailable } from '../ai/available.js';
import { AI_LANGUAGES, FOLLOW_UP_ACTIONS, type AiLanguage, type FollowUpAction } from '../ai/prompts.js';
import { MAX_QUESTION_CHARS, questionWithRealNames, withRealNames, type AiReport, type StoredResult } from '../ai/run.js';
import type { AiRunService, RunRequest } from '../ai/service.js';
import type { Config } from '../config.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { AiRunRow, AiRunSummary } from '../types.js';

/** Runs listed by default, and at most. */
export const DEFAULT_LISTED_RUNS = 50;
export const MAX_LISTED_RUNS = 200;
/** Invisible and control characters taken out of a free question (as run.ts does). */
const INVISIBLE = /[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/gu;

const SESSION_REQUIRED = {
  error: 'user_session_required',
  reason: 'Sign in to the dashboard with your account to use the AI assistant.',
} as const;
const UNAVAILABLE = {
  error: 'ai_unavailable',
  reason: 'The AI assistant is not available on this server. The server owner can set it up and switch it on.',
} as const;
const NOT_ENABLED = {
  error: 'ai_not_enabled',
  reason: 'The AI assistant is switched off for this project. A coordinator can switch it on in the project settings.',
} as const;

const bad = (reason: string) => ({ error: 'bad_request', reason });

/** A run as listed: who, when, what, and its tokens; never a result, a question or tool arguments. */
function summaryOf(r: AiRunSummary) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    startedBy: r.startedBy,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    tokens: r.inputTokens + r.outputTokens,
    parentRunId: r.parentRun,
    findingIndex: r.findingIndex,
    action: r.action,
    errorCode: r.errorCode,
  };
}

/** One run for the dashboard: its progress (the tools used so far), and its result with real names and plot ids. */
function runOf(r: AiRunRow) {
  return {
    ...summaryOf(r),
    // Stored with pseudonyms for the usernames in it: shown with the real names.
    question: r.question !== null && r.questionNames ? questionWithRealNames(r.question, r.questionNames) : r.question,
    progress: { tools: r.toolCalls.map((c) => c.name) },
    result: r.status === 'done' && r.result !== null ? withRealNames(r.result as StoredResult<unknown>) : null,
    error: r.status === 'failed' ? { code: r.errorCode ?? 'server_error', message: r.error ?? '' } : null,
    refusal: r.status === 'refused' ? r.error : null,
  };
}

export interface AiRouteOptions {
  runs: AiRunService;
}

/**
 * The AI assistant's project routes (admin): its switch, and its runs. The switch is
 * off by default, and can only be switched on while the assistant is available on the
 * server (Vertex configured and switched on by the server owner); switching it off is
 * always allowed. Runs start with POST and run in the background; GET reads them.
 */
export async function registerAiRoutes(app: FastifyInstance, store: Store, config: Config, options: AiRouteOptions): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const { runs } = options;

  // Runs a crashed process left running are failed once they are past the time limit,
  // on every start, list or read of that project's runs (newer ones may belong to
  // another instance still running them). Nothing goes over every project at boot: a
  // stale row changes nothing until its project is used, and then it is failed first.
  app.addHook('onClose', async () => {
    await runs.close();
  });

  app.get('/v1/projects/:pid/ai', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [enabled, settings] = await Promise.all([store.isAiEnabled(projectId), store.getSettings()]);
    return reply.send({ enabled, available: aiAvailable(config, settings) });
  });

  app.put('/v1/projects/:pid/ai', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    // A person decides, not a project token: the runs it allows are kept under who started them.
    if (!request.membership!.userId) {
      return reply.code(403).send({
        error: 'user_session_required',
        reason: 'Sign in to the dashboard with your account to switch the AI assistant on or off.',
      });
    }
    const enabled = ((request.body ?? {}) as { enabled?: unknown }).enabled;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'bad_request', reason: 'enabled must be true or false' });
    }
    const available = aiAvailable(config, await store.getSettings());
    if (enabled && !available) {
      return reply.code(409).send(UNAVAILABLE);
    }
    await store.setAiEnabled(projectId, enabled);
    return reply.send({ enabled, available });
  });

  app.post('/v1/projects/:pid/ai/runs', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, userId } = request.membership!;
    if (!userId) {
      return reply.code(403).send(SESSION_REQUIRED);
    }
    const [settings, enabled] = await Promise.all([store.getSettings(), store.isAiEnabled(projectId)]);
    if (!aiAvailable(config, settings) || !runs.hasClient) {
      return reply.code(409).send(UNAVAILABLE);
    }
    if (!enabled) {
      return reply.code(409).send(NOT_ENABLED);
    }
    const parsed = await runRequest(store, projectId, request.body);
    if ('status' in parsed) {
      return reply.code(parsed.status).send(parsed.body);
    }
    const started = await runs.start(projectId, userId, parsed, settings);
    if (started.ok) {
      return reply.code(202).send({ runId: started.runId });
    }
    if (started.limit === 'busy') {
      return reply.code(409).send({ error: 'busy', reason: 'The assistant is already working for this project. Wait until it has finished.' });
    }
    // A limit of 0 allows none at all: it never resets, so no resetsAt.
    if (started.limit === 'daily') {
      const which = parsed.kind === 'report' ? 'reports' : 'follow_ups';
      const none = (which === 'reports' ? settings.aiReportsPerDay : settings.aiFollowUpsPerDay) === 0;
      return reply.code(429).send({
        error: 'ai_daily_limit',
        limit: which,
        resetsAt: none ? null : started.resetsAt,
        reason: none
          ? which === 'reports'
            ? 'AI reports are not allowed on this server: the daily limit is 0.'
            : 'Follow-ups and questions to the AI assistant are not allowed on this server: the daily limit is 0.'
          : which === 'reports'
            ? 'This project has used all its AI reports for today.'
            : 'This project has used all its follow-ups and questions to the AI assistant for today.',
      });
    }
    const none = settings.aiMonthlyTokens === 0;
    return reply.code(429).send({
      error: 'ai_monthly_limit',
      resetsAt: none ? null : started.resetsAt,
      reason: none
        ? 'The AI assistant is not allowed on this server: its monthly limit is 0.'
        : 'This project has used all the AI assistant time it may use this month.',
    });
  });

  app.get('/v1/projects/:pid/ai/runs', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const raw = (request.query as { limit?: string }).limit;
    const limit = raw === undefined ? DEFAULT_LISTED_RUNS : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LISTED_RUNS) {
      return reply.code(400).send(bad(`limit must be a whole number from 1 to ${MAX_LISTED_RUNS}`));
    }
    await runs.failStale(projectId);
    return reply.send({ runs: (await store.listAiRuns(projectId, limit)).map(summaryOf) });
  });

  app.get('/v1/projects/:pid/ai/runs/:id', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const id = (request.params as { id: string }).id;
    if (!isUuid(id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    await runs.failStale(projectId);
    const run = await store.getAiRun(projectId, id);
    if (!run) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send(runOf(run));
  });
}

type Refused = { status: 400 | 404; body: { error: string; reason: string } };

/** The body of POST /ai/runs as a RunRequest, its parent report loaded; or why it is refused. */
async function runRequest(store: Store, projectId: string, body: unknown): Promise<RunRequest | Refused> {
  const b = (body ?? {}) as Record<string, unknown>;
  const language = b.language === undefined ? 'en' : b.language;
  if (!AI_LANGUAGES.includes(language as AiLanguage)) {
    return { status: 400, body: bad(`language must be one of ${AI_LANGUAGES.join(', ')}`) };
  }
  const lang = language as AiLanguage;
  if (b.kind === 'report') {
    return { kind: 'report', language: lang };
  }
  if (b.kind !== 'follow_up' && b.kind !== 'question') {
    return { status: 400, body: bad('kind must be report, follow_up or question') };
  }
  const parentRun = b.parentRunId;
  if (typeof parentRun !== 'string') {
    return { status: 400, body: bad('parentRunId must be the id of a report') };
  }
  const row = isUuid(parentRun) ? await store.getAiRun(projectId, parentRun) : null;
  if (!row || row.kind !== 'report' || row.status !== 'done' || row.result === null) {
    return { status: 404, body: { error: 'not_found', reason: 'This project has no finished AI report with that id.' } };
  }
  const parent = row.result as StoredResult<AiReport>;
  if (b.kind === 'follow_up') {
    const findingIndex = b.findingIndex;
    if (typeof findingIndex !== 'number' || !Number.isInteger(findingIndex) || findingIndex < 0 || findingIndex >= parent.result.findings.length) {
      return { status: 400, body: bad('findingIndex must be the number of a finding of the report (from 0)') };
    }
    if (!FOLLOW_UP_ACTIONS.includes(b.action as FollowUpAction)) {
      return { status: 400, body: bad(`action must be one of ${FOLLOW_UP_ACTIONS.join(', ')}`) };
    }
    return { kind: 'follow_up', language: lang, parentRun, parent, findingIndex, action: b.action as FollowUpAction };
  }
  const question = typeof b.question === 'string' ? b.question.replace(INVISIBLE, '').trim() : '';
  if (question === '' || question.length > MAX_QUESTION_CHARS) {
    return { status: 400, body: bad(`question must have 1 to ${MAX_QUESTION_CHARS} characters`) };
  }
  return { kind: 'question', language: lang, parentRun, parent, question };
}
