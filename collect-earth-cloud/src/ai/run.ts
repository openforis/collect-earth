// The AI assistant's runs (Task 14): a quality report, a follow-up on one of its findings,
// and a short free question that passes a topic check first. Pure logic over a context the
// caller (Task 15) loads for one project: nothing here reads or writes the database.
//
// Each run: a tool loop (our read-only tools only, at most maxToolCalls calls), then one
// call with no tools and a response schema, whose JSON is checked by our own validator
// (lengths are cut here: Gemini's responseJsonSchema has no maxLength). Invalid JSON is
// asked for once more; a blocked answer fails the run. A failed run gives no result.
import { AiError, modelTurn, type AiClient, type AiRequest, type AiResponse, type AiResult, type AiTurn } from './client.js';
import {
  followUpFinalPrompt,
  followUpStart,
  OFF_TOPIC_MESSAGE,
  questionStart,
  REPORT_START,
  reportFinalPrompt,
  systemInstruction,
  TOPIC_CHECK_SYSTEM,
  topicCheckTurn,
  type AiLanguage,
  type FollowUpAction,
} from './prompts.js';
import { Pseudonyms, ToolBox, TOOL_NAMES, TOOLS, usernamesOf, type ToolData } from './tools.js';

export interface AiRunLimits {
  /** Tool calls in all, per run. */
  maxToolCalls: number;
  /** Per turn of the tool loop. */
  maxOutputTokens: number;
  /** For the final, structured answer (a report of 12 findings needs more than a turn). */
  maxFinalOutputTokens: number;
  /** Input tokens of the whole run; past it the run stops as failed. */
  maxInputTokens: number;
}

export const DEFAULT_AI_LIMITS: AiRunLimits = {
  maxToolCalls: 20,
  maxOutputTokens: 4096,
  maxFinalOutputTokens: 8192,
  maxInputTokens: 200_000,
};

/** Output tokens of the topic check (the model may think before its one boolean). */
export const TOPIC_CHECK_OUTPUT_TOKENS = 2048;
export const MAX_QUESTION_CHARS = 300;

/** One tool call of a run, as it may be stored (`ai_runs.tool_calls`): the name and the validated arguments. */
export interface ToolCallRecord {
  /** Ours, or "unknown" for a name the model made up. */
  name: string;
  /** As validated (pseudonyms, plot ids, question keys); null when refused. */
  args: Record<string, unknown> | null;
  ok: boolean;
}

/** What a run has used so far, given to onProgress after every model call and tool call. */
export interface RunProgress {
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  /** Calls to the model. */
  modelCalls: number;
}

/** The project data of one run, loaded by the caller (one project, under its RLS). */
export interface AiRunContext extends ToolData {
  client: AiClient;
  /** The dashboard's language: the answer is written in it. */
  language: AiLanguage;
  /** The project's members' usernames. Together with the report's, they get pseudonyms. */
  members: readonly string[];
  limits?: Partial<AiRunLimits>;
  /** Called with a copy of the progress after each model call and each tool call (e.g. to store it). */
  onProgress?: (progress: RunProgress) => void | Promise<void>;
}

export type FindingCause = 'unclear_question' | 'overlapping_options' | 'person_habit' | 'number_typing' | 'other';
export const FINDING_CAUSES: readonly FindingCause[] = ['unclear_question', 'overlapping_options', 'person_habit', 'number_typing', 'other'];

export interface AiFinding {
  title: string;
  explanation: string;
  cause: FindingCause;
  questions: string[];
  /** Pseudonyms in a stored result; usernames after withRealNames. */
  persons: string[];
  plots: string[];
  suggestedNote: string | null;
}

export interface AiReport {
  summary: string;
  findings: AiFinding[];
  recheckPlots: string[];
  surveyChanges: { question: string; suggestion: string }[];
}

export interface AiAnswer {
  text: string;
  plots: string[];
  note: string | null;
}

/** A result as stored: pseudonymous, with the mapping (pseudonym -> username) to show real names. */
export interface StoredResult<T> {
  result: T;
  pseudonyms: Record<string, string>;
}

export type RunOutcome<T> = RunProgress &
  (
    | ({ status: 'done' } & StoredResult<T>)
    /** `error` is a plain message for the run's record; `cause` is for the server log only. */
    | { status: 'failed'; error: string; cause?: unknown }
    /** An off-topic question: `message` is the refusal to show. */
    | { status: 'refused'; message: string }
  );

// ---------------------------------------------------------------------------
// Limits of the final answers (the schema says the counts; lengths are only ours)

export const REPORT_LIMITS = {
  summary: 1500,
  findings: 12,
  title: 150,
  explanation: 1200,
  questions: 5,
  persons: 5,
  plots: 20,
  suggestedNote: 800,
  recheckPlots: 100,
  surveyChanges: 10,
  suggestion: 500,
} as const;

export const ANSWER_LIMITS = { text: 2000, plots: 20, note: 800 } as const;

const STRING = { type: 'string' };
const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const strings = (maxItems: number) => ({ type: 'array', items: STRING, maxItems });

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: STRING,
    findings: {
      type: 'array',
      maxItems: REPORT_LIMITS.findings,
      items: {
        type: 'object',
        properties: {
          title: STRING,
          explanation: STRING,
          cause: { type: 'string', enum: [...FINDING_CAUSES] },
          questions: strings(REPORT_LIMITS.questions),
          persons: strings(REPORT_LIMITS.persons),
          plots: strings(REPORT_LIMITS.plots),
          suggestedNote: NULLABLE_STRING,
        },
        required: ['title', 'explanation', 'cause', 'questions', 'persons', 'plots', 'suggestedNote'],
      },
    },
    recheckPlots: strings(REPORT_LIMITS.recheckPlots),
    surveyChanges: {
      type: 'array',
      maxItems: REPORT_LIMITS.surveyChanges,
      items: { type: 'object', properties: { question: STRING, suggestion: STRING }, required: ['question', 'suggestion'] },
    },
  },
  required: ['summary', 'findings', 'recheckPlots', 'surveyChanges'],
};

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: { text: STRING, plots: strings(ANSWER_LIMITS.plots), note: NULLABLE_STRING },
  required: ['text', 'plots', 'note'],
};

export const TOPIC_SCHEMA = {
  type: 'object',
  properties: { on_topic: { type: 'boolean' } },
  required: ['on_topic'],
};

// ---------------------------------------------------------------------------
// The validator

/** What a final answer may name: questions the tools know, the run's pseudonyms, plots a tool returned. */
export interface KnownNames {
  questions: { has(key: string): boolean };
  persons: { has(pseudonym: string): boolean };
  plots: { has(plot: string): boolean };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string without control characters, trimmed and cut to `max`; null when not a string. */
function textOf(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(CONTROL, '').trim();
  return t.length <= max ? t : Array.from(t).slice(0, max).join('').trimEnd();
}

/** A list of strings (missing = empty), deduplicated; null when not a list of strings. */
function stringsOf(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) return null;
  return [...new Set(v as string[])];
}

/** The strings of a list, deduplicated (anything else in it, or no list, is left out). */
function someStrings(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string'))] : [];
}

function noteOf(v: unknown, max: number): string | null {
  const t = textOf(v, max);
  return t === null || t === '' ? null : t;
}

function findingOf(v: unknown, known: KnownNames): AiFinding | null {
  if (!isObject(v)) return null;
  const title = textOf(v.title, REPORT_LIMITS.title);
  const explanation = textOf(v.explanation, REPORT_LIMITS.explanation);
  const questions = stringsOf(v.questions);
  const persons = stringsOf(v.persons);
  const plots = stringsOf(v.plots);
  if (!title || explanation === null || !questions || !persons || !plots) return null;
  if (!questions.every((q) => known.questions.has(q)) || !persons.every((p) => known.persons.has(p)) || !plots.every((p) => known.plots.has(p))) {
    return null;
  }
  return {
    title,
    explanation,
    cause: FINDING_CAUSES.includes(v.cause as FindingCause) ? (v.cause as FindingCause) : 'other',
    questions: questions.slice(0, REPORT_LIMITS.questions),
    persons: persons.slice(0, REPORT_LIMITS.persons),
    plots: plots.slice(0, REPORT_LIMITS.plots),
    suggestedNote: noteOf(v.suggestedNote, REPORT_LIMITS.suggestedNote),
  };
}

/**
 * The model's report, checked: null when it is not one (no summary or no findings list).
 * Texts are cut to their limits; a finding naming a question, person or plot it may not
 * is dropped, and so are unknown recheck plots and survey changes to unknown questions.
 */
export function validateReport(v: unknown, known: KnownNames): AiReport | null {
  if (!isObject(v) || typeof v.summary !== 'string' || !Array.isArray(v.findings)) return null;
  const findings = v.findings.map((f) => findingOf(f, known)).filter((f): f is AiFinding => f !== null);
  const recheck = someStrings(v.recheckPlots).filter((p) => known.plots.has(p));
  const changes = Array.isArray(v.surveyChanges) ? v.surveyChanges : [];
  const surveyChanges = [];
  for (const c of changes) {
    if (!isObject(c) || typeof c.question !== 'string' || !known.questions.has(c.question)) continue;
    const suggestion = textOf(c.suggestion, REPORT_LIMITS.suggestion);
    if (suggestion) surveyChanges.push({ question: c.question, suggestion });
  }
  return {
    summary: textOf(v.summary, REPORT_LIMITS.summary)!,
    findings: findings.slice(0, REPORT_LIMITS.findings),
    recheckPlots: recheck.slice(0, REPORT_LIMITS.recheckPlots),
    surveyChanges: surveyChanges.slice(0, REPORT_LIMITS.surveyChanges),
  };
}

/** The model's answer to a follow-up or a question, checked: null when it has no text. Unknown plots are dropped. */
export function validateAnswer(v: unknown, known: KnownNames): AiAnswer | null {
  if (!isObject(v)) return null;
  const text = textOf(v.text, ANSWER_LIMITS.text);
  if (!text) return null;
  return {
    text,
    plots: someStrings(v.plots).filter((p) => known.plots.has(p)).slice(0, ANSWER_LIMITS.plots),
    note: noteOf(v.note, ANSWER_LIMITS.note),
  };
}

// ---------------------------------------------------------------------------
// Real names, only for the dashboard

const PSEUDONYM = /\bPerson [A-Z]{1,4}\b/g;
/** Fields that hold plot ids or question keys, never people. */
const NOT_PEOPLE = new Set(['plots', 'recheckPlots', 'questions', 'question']);

/**
 * The stored result with the pseudonyms replaced by the usernames, wherever they are
 * (persons lists and texts). For the dashboard's response only (Task 15): never sent to
 * the model.
 */
export function withRealNames<T>(stored: StoredResult<T>): T {
  const names = stored.pseudonyms;
  const map = (v: unknown, key?: string): unknown => {
    if (key !== undefined && NOT_PEOPLE.has(key)) return v;
    if (typeof v === 'string') return v.replace(PSEUDONYM, (p) => (Object.hasOwn(names, p) ? names[p] : p));
    if (Array.isArray(v)) return v.map((x) => map(x));
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x, k)]));
    return v;
  };
  return map(stored.result) as T;
}

// ---------------------------------------------------------------------------
// The runs

class RunStop extends Error {}

/** An off-topic question, with the refusal to show. */
class Refusal {
  constructor(readonly message: string) {}
}

const FAILED_BLOCKED = (reason: string | undefined) => `The AI model's answer was blocked or cut off (${reason ?? 'no reason given'}).`;
const FAILED_INVALID = 'The AI model did not give a valid answer, twice.';
const FAILED_SERVER = 'The assistant stopped because of an error on the server.';

/** One run's state: its pseudonyms, tools, and what it has used. */
class Run {
  readonly limits: AiRunLimits;
  readonly box: ToolBox;
  readonly progress: RunProgress = { toolCalls: [], inputTokens: 0, outputTokens: 0, modelCalls: 0 };

  constructor(
    readonly ctx: AiRunContext,
    readonly pseudonyms: Pseudonyms,
  ) {
    this.limits = { ...DEFAULT_AI_LIMITS, ...ctx.limits };
    this.box = new ToolBox(ctx, pseudonyms);
  }

  get known(): KnownNames {
    return { questions: this.box.questions, persons: this.pseudonyms, plots: this.box.seenPlots };
  }

  private async report(): Promise<void> {
    await this.ctx.onProgress?.({ ...this.progress, toolCalls: [...this.progress.toolCalls] });
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    if (this.progress.inputTokens > this.limits.maxInputTokens) {
      throw new RunStop(`The run used more than its ${this.limits.maxInputTokens} input tokens.`);
    }
    const res = await this.ctx.client.generate(req);
    this.progress.modelCalls++;
    this.progress.inputTokens += res.inputTokens;
    this.progress.outputTokens += res.outputTokens;
    await this.report();
    if (res.blocked) {
      throw new RunStop(FAILED_BLOCKED(res.blockReason));
    }
    if (this.progress.inputTokens > this.limits.maxInputTokens) {
      throw new RunStop(`The run used more than its ${this.limits.maxInputTokens} input tokens.`);
    }
    return res;
  }

  /** The tool loop: until the model stops calling tools, or maxToolCalls calls in all. */
  async toolLoop(system: string, turns: AiTurn[]): Promise<void> {
    let used = 0;
    while (used < this.limits.maxToolCalls) {
      const res = await this.generate({ system, turns, tools: [...TOOLS], maxOutputTokens: this.limits.maxOutputTokens });
      turns.push(modelTurn(res));
      if (res.calls.length === 0) return;
      const results: AiResult[] = [];
      for (const call of res.calls) {
        const answer = (result: Record<string, unknown>) => results.push({ ...(call.id !== undefined ? { id: call.id } : {}), name: call.name, result });
        if (used >= this.limits.maxToolCalls) {
          answer({ error: 'The limit of tool calls for this run is reached.' });
          continue;
        }
        used++;
        const out = await this.box.call(call.name, call.args);
        this.progress.toolCalls.push({ name: TOOL_NAMES.has(call.name) ? call.name : 'unknown', args: out.args, ok: out.ok });
        answer(out.result);
        await this.report();
      }
      turns.push({ role: 'tool', results });
    }
  }

  /** A call with no tools and a schema; the JSON checked, asked for once more when it is not valid. */
  async structured<T>(req: Omit<AiRequest, 'tools' | 'responseSchema'>, schema: object, check: (json: unknown) => T | null): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.generate({ ...req, responseSchema: schema });
      let json: unknown;
      try {
        json = JSON.parse(res.text ?? '');
      } catch {
        continue;
      }
      const value = check(json);
      if (value !== null) return value;
    }
    throw new RunStop(FAILED_INVALID);
  }

  /** The tool loop from `start`, then the final answer with `schema`. */
  async converse<T>(start: string, finalPrompt: string, schema: object, check: (json: unknown, known: KnownNames) => T | null): Promise<T> {
    const system = systemInstruction(this.ctx.language);
    const turns: AiTurn[] = [{ role: 'user', text: start }];
    await this.toolLoop(system, turns);
    turns.push({ role: 'user', text: finalPrompt });
    return this.structured({ system, turns, maxOutputTokens: this.limits.maxFinalOutputTokens }, schema, (json) => check(json, this.known));
  }

  async outcome<T>(work: () => Promise<T | Refusal>): Promise<RunOutcome<T>> {
    try {
      const value = await work();
      if (value instanceof Refusal) return { ...this.progress, status: 'refused', message: value.message };
      return { ...this.progress, status: 'done', result: value, pseudonyms: this.pseudonyms.toJSON() };
    } catch (err) {
      if (err instanceof RunStop) return { ...this.progress, status: 'failed', error: err.message };
      if (err instanceof AiError) return { ...this.progress, status: 'failed', error: `The AI model could not be reached: ${err.message}`, cause: err };
      return { ...this.progress, status: 'failed', error: FAILED_SERVER, cause: err };
    }
  }
}

function newRun(ctx: AiRunContext, base?: Readonly<Record<string, string>>): Run {
  return new Run(ctx, Pseudonyms.of([...ctx.members, ...usernamesOf(ctx.report)], base));
}

function failedEarly<T>(error: string): RunOutcome<T> {
  return { toolCalls: [], inputTokens: 0, outputTokens: 0, modelCalls: 0, status: 'failed', error };
}

/** A quality report of the project. */
export function runReport(ctx: AiRunContext): Promise<RunOutcome<AiReport>> {
  const run = newRun(ctx);
  return run.outcome(() => run.converse(REPORT_START, reportFinalPrompt(ctx.language), REPORT_SCHEMA, validateReport));
}

/** Every plot a parent report names, so an answer about it may name them too. */
function parentPlots(report: AiReport): string[] {
  return [...report.recheckPlots, ...report.findings.flatMap((f) => f.plots)];
}

/**
 * A fixed follow-up on one finding of a report (`parent` as stored: pseudonymous). The
 * run keeps the parent's pseudonyms, so the finding's people are the same.
 */
export function runFollowUp(
  ctx: AiRunContext,
  parent: StoredResult<AiReport>,
  findingIndex: number,
  action: FollowUpAction,
): Promise<RunOutcome<AiAnswer>> {
  const finding = Number.isInteger(findingIndex) ? parent.result.findings[findingIndex] : undefined;
  if (!finding) return Promise.resolve(failedEarly('The report has no such finding.'));
  if (!['explain', 'draft_note', 'recheck'].includes(action)) return Promise.resolve(failedEarly('Unknown follow-up.'));
  const run = newRun(ctx, parent.pseudonyms);
  run.box.addSeenPlots(finding.plots);
  return run.outcome(() => run.converse(followUpStart(action, finding), followUpFinalPrompt(ctx.language), ANSWER_SCHEMA, validateAnswer));
}

/**
 * A short free question about a report. A topic check comes first (no tools, only
 * `{ on_topic }`); off topic, the run is refused and nothing more is sent.
 */
export function runQuestion(ctx: AiRunContext, parent: StoredResult<AiReport>, question: string): Promise<RunOutcome<AiAnswer>> {
  const q = typeof question === 'string' ? question.replace(CONTROL, '').trim() : '';
  if (q === '' || q.length > MAX_QUESTION_CHARS) {
    return Promise.resolve(failedEarly(`The question must have 1 to ${MAX_QUESTION_CHARS} characters.`));
  }
  const run = newRun(ctx, parent.pseudonyms);
  run.box.addSeenPlots(parentPlots(parent.result));
  return run.outcome<AiAnswer>(async () => {
    const onTopic = await run.structured(
      { system: TOPIC_CHECK_SYSTEM, turns: [{ role: 'user', text: topicCheckTurn(q) }], maxOutputTokens: TOPIC_CHECK_OUTPUT_TOKENS },
      TOPIC_SCHEMA,
      (json) => (isObject(json) && typeof json.on_topic === 'boolean' ? json.on_topic : null),
    );
    if (!onTopic) return new Refusal(OFF_TOPIC_MESSAGE[ctx.language] ?? OFF_TOPIC_MESSAGE.en);
    return run.converse(questionStart(parent.result, q), followUpFinalPrompt(ctx.language), ANSWER_SCHEMA, validateAnswer);
  });
}
