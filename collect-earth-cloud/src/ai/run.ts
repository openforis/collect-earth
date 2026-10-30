// The AI assistant's runs (Task 14): a quality report, a follow-up on one of its findings,
// and a short free question that passes a topic check first. Pure logic over a context the
// caller (Task 15) loads for one project: nothing here reads or writes the database.
//
// Each run: a tool loop (our read-only tools only, at most maxToolCalls calls, within an
// input-token budget), then one structured call (the same tools declared but uncallable,
// and a response schema), whose JSON is checked by our own validator (lengths are cut
// here: Gemini's responseJsonSchema has no maxLength). An answer that cannot be used is
// shown to the model with the reason, once; a blocked answer fails the run. A failed run
// gives no result. People and plots are pseudonyms throughout; real names and plot ids
// come back only through withRealNames, for the dashboard.
import { AiError, modelTurn, type AiClient, type AiRequest, type AiResponse, type AiResult, type AiTurn } from './client.js';
import {
  ANSWER_CHECK_SYSTEM,
  answerCheckTurn,
  FOLLOW_UP_ACTIONS,
  followUpFinalPrompt,
  followUpStart,
  OFF_TOPIC_MESSAGE,
  questionStart,
  REPORT_START,
  reportFinalPrompt,
  retryPrompt,
  systemInstruction,
  TOPIC_CHECK_SYSTEM,
  topicCheckTurn,
  type AiLanguage,
  type FollowUpAction,
} from './prompts.js';
import { PlotNames, Pseudonyms, ToolBox, TOOL_NAMES, TOOLS, usernamesOf, type ToolData } from './tools.js';

export interface AiRunLimits {
  /** Tool calls in all, per run. */
  maxToolCalls: number;
  /** Per turn of the tool loop. */
  maxOutputTokens: number;
  /** For the final, structured answer (a report of 12 findings needs more than a turn). */
  maxFinalOutputTokens: number;
  /** Input tokens of the whole run. The loop ends early to stay under it; past it the run fails. */
  maxInputTokens: number;
  /** Input tokens kept for the final call when the loop decides whether to go on. */
  finalReserveTokens: number;
  /** Time limit of a loop turn and of a check. */
  turnTimeoutMs: number;
  /** Time limit of the final, structured call. */
  finalTimeoutMs: number;
  /** How the loop lets the model call the tools. */
  loopToolMode: 'auto' | 'validated';
  /**
   * The final call: `none` declares the same tools with calling switched off (the history
   * has function calls); `omit` sends no tools, should Vertex refuse the first.
   */
  finalTools: 'none' | 'omit';
}

export const DEFAULT_AI_LIMITS: AiRunLimits = {
  maxToolCalls: 20,
  maxOutputTokens: 4096,
  maxFinalOutputTokens: 8192,
  maxInputTokens: 200_000,
  finalReserveTokens: 20_000,
  turnTimeoutMs: 60_000,
  finalTimeoutMs: 170_000,
  loopToolMode: 'validated',
  finalTools: 'none',
};

/** Output tokens of a topic check (thinking is minimal, but not nothing). */
export const TOPIC_CHECK_OUTPUT_TOKENS = 1024;
export const MAX_QUESTION_CHARS = 300;

/** One tool call of a run, as it may be stored (`ai_runs.tool_calls`): the name and the validated arguments. */
export interface ToolCallRecord {
  /** Ours, or "unknown" for a name the model made up. */
  name: string;
  /** As validated (pseudonyms, plot names, question keys); null when refused. */
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
  /** Plot names ("Plot 1") in a stored result; plot ids after withRealNames. */
  plots: string[];
  /** A draft guidance note: never names a person. */
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
  /** A draft guidance note: never names a person. */
  note: string | null;
}

/**
 * A result as stored: pseudonymous, with the mappings to show real names and plot ids
 * (`pseudonyms`: "Person A" -> username; `plots`: "Plot 1" -> plot id).
 */
export interface StoredResult<T> {
  result: T;
  pseudonyms: Record<string, string>;
  plots: Record<string, string>;
}

/** Why a run failed, for the dashboard to say in its language. */
export type FailureCode =
  | 'blocked'
  | 'invalid_answer'
  | 'ai_unavailable'
  | 'ai_timeout'
  | 'token_budget'
  | 'server_error'
  | 'no_finding'
  | 'bad_action'
  | 'bad_question';

export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  blocked: 'The AI model stopped without a usable answer.',
  invalid_answer: 'The AI model did not give a valid answer, twice.',
  ai_unavailable: 'The AI model could not be reached.',
  ai_timeout: 'The AI model took too long to answer.',
  token_budget: 'The review needed more data than one run may send.',
  server_error: 'The assistant stopped because of an error on the server.',
  no_finding: 'The report has no such finding.',
  bad_action: 'Unknown follow-up.',
  bad_question: `The question must have 1 to ${MAX_QUESTION_CHARS} characters.`,
};

export type RunOutcome<T> = RunProgress &
  (
    | ({ status: 'done' } & StoredResult<T>)
    /**
     * `code` and `error` (its plain English message) are for the coordinator, with the
     * service's HTTP `status` when it gave one; `cause` (the block reason, the error) is
     * for the server log only.
     */
    | { status: 'failed'; code: FailureCode; error: string; httpStatus?: number; cause?: unknown }
    /** An off-topic question (or answer): `message` is the refusal to show. */
    | { status: 'refused'; message: string }
  );

// ---------------------------------------------------------------------------
// Limits of the final answers (the schema says the counts; lengths are only ours)

export const REPORT_LIMITS = {
  summary: 1500,
  findings: 12,
  title: 150,
  explanation: 800,
  questions: 5,
  persons: 5,
  plots: 20,
  suggestedNote: 800,
  recheckPlots: 100,
  surveyChanges: 10,
  suggestion: 500,
} as const;

export const ANSWER_LIMITS = { text: 1200, plots: 20, note: 800 } as const;
/** A text with more lines than this is not a quality report's text. */
export const MAX_TEXT_LINES = 15;

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
// Pseudonyms in texts, also as the model may translate them

const PERSON_WORDS = '(?:Personne|Persona|Pessoa|Person)';
const PLOT_WORDS = '(?:Parcelle|Parcela|Plot)';
const NOT_TOUCHING_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_TOUCHING_AFTER = '(?![\\p{L}\\p{N}_])';
const PERSON_IN_TEXT = new RegExp(`${NOT_TOUCHING_BEFORE}${PERSON_WORDS} ([A-Z]{1,4})${NOT_TOUCHING_AFTER}`, 'gu');
const PLOT_IN_TEXT = new RegExp(`${NOT_TOUCHING_BEFORE}${PLOT_WORDS} (\\d{1,7})${NOT_TOUCHING_AFTER}`, 'gu');
const PERSON_ALONE = new RegExp(`^${PERSON_WORDS} ([A-Z]{1,4})$`, 'u');
const PLOT_ALONE = new RegExp(`^${PLOT_WORDS} (\\d{1,7})$`, 'u');

/** "Persona B" (or "Person B") as the run's "Person B"; anything else as it is. */
function personKey(s: string): string {
  const m = PERSON_ALONE.exec(s.trim());
  return m ? `Person ${m[1]}` : s;
}

/** "Parcela 3" (or "Plot 3") as the run's "Plot 3"; anything else as it is. */
function plotKey(s: string): string {
  const m = PLOT_ALONE.exec(s.trim());
  return m ? `Plot ${m[1]}` : s;
}

// ---------------------------------------------------------------------------
// The validator

/** What a final answer may name: questions the tools know, the run's pseudonyms, plots a tool returned, numbers sent. */
export interface KnownNames {
  questions: { has(key: string): boolean };
  persons: { has(pseudonym: string): boolean };
  plots: { has(plot: string): boolean };
  /** The numbers of the tool results sent (ToolBox.numbers); without it numbers are not checked. */
  numbers?: readonly number[];
}

// Control characters but \n, and \p{Cf} (bidi overrides, zero-width characters...).
const INVISIBLE = /[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/gu;
/** Code, markup or links: never in a quality report's text. */
const NOT_PLAIN = /```|<\/?[A-Za-z][^>]*>|https?:\/\/|www\./i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A string without control and format characters, trimmed and cut to `max`; null when not
 * a string, or when it holds code, markup or a link, or more than MAX_TEXT_LINES lines.
 */
function textOf(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(INVISIBLE, '').trim();
  if (NOT_PLAIN.test(t) || t.split('\n').length > MAX_TEXT_LINES) return null;
  return t.length <= max ? t : Array.from(t).slice(0, max).join('').trimEnd();
}

/** A list of strings (missing = empty), normalized by `key` and deduplicated; null when not a list of strings. */
function stringsOf(v: unknown, key: (s: string) => string = (s) => s): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) return null;
  return [...new Set((v as string[]).map(key))];
}

/** The strings of a list, normalized and deduplicated (anything else in it, or no list, is left out). */
function someStrings(v: unknown, key: (s: string) => string): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string').map(key))] : [];
}

/** A draft guidance note: null when empty, not plain text, or naming a person. */
function noteOf(v: unknown, max: number): string | null {
  const t = textOf(v, max);
  if (t === null || t === '') return null;
  PERSON_IN_TEXT.lastIndex = 0;
  return PERSON_IN_TEXT.test(t) ? null : t;
}

const KEY_IN_TEXT = /collect_[\w[\].*]+/g;
const NUMBER_IN_TEXT = /\d+(?:[.,]\d+)*(\s?%)?/g;

/**
 * Whether every number a text gives (integers of 2 digits or more, decimals, percentages)
 * is in the tool results, give or take rounding: 1 on an integer, 0.5 on a percentage
 * (also as a rate × 100), the last decimal place on a decimal. Pseudonyms ("Plot 12") and
 * question keys are not numbers. Either reading of "1,234" / "0,75" will do.
 */
export function numbersKnown(text: string, numbers: readonly number[]): boolean {
  const t = text.replace(PERSON_IN_TEXT, ' ').replace(PLOT_IN_TEXT, ' ').replace(KEY_IN_TEXT, ' ');
  for (const m of t.matchAll(NUMBER_IN_TEXT)) {
    const raw = m[0].replace(/\s?%$/, '');
    const percent = m[1] !== undefined;
    const separated = /[.,]/.test(raw);
    if (!percent && !separated && raw.length < 2) continue;
    const readings = new Set([Number(raw.replace(/,/g, '')), Number(raw.replace(/\./g, '').replace(',', '.')), Number(raw.replace(',', '.'))]);
    const decimals = separated ? (raw.split(/[.,]/).at(-1) ?? '').length : 0;
    const near = (x: number) =>
      numbers.some((k) => {
        if (percent) return Math.abs(k - x) <= 0.5 || Math.abs(k * 100 - x) <= 0.5;
        if (separated) return Math.abs(k - x) <= 10 ** -decimals + 1e-9 || Math.abs(k * 100 - x) <= 0.5;
        return Math.abs(k - x) <= 1;
      });
    if (![...readings].some((x) => Number.isFinite(x) && near(x))) return false;
  }
  return true;
}

function findingOf(v: unknown, known: KnownNames): AiFinding | null {
  if (!isObject(v)) return null;
  const title = textOf(v.title, REPORT_LIMITS.title);
  const explanation = textOf(v.explanation, REPORT_LIMITS.explanation);
  const questions = stringsOf(v.questions);
  const persons = stringsOf(v.persons, personKey);
  const plots = stringsOf(v.plots, plotKey);
  if (!title || !explanation || !questions || !persons || !plots) return null;
  if (questions.length === 0 && plots.length === 0) return null;
  if (!questions.every((q) => known.questions.has(q)) || !persons.every((p) => known.persons.has(p)) || !plots.every((p) => known.plots.has(p))) {
    return null;
  }
  if (known.numbers && !numbersKnown(`${title}\n${explanation}`, known.numbers)) return null;
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
 * The model's report, checked: null when it is not one (no plain, non-empty summary or no
 * findings list). Texts are cut to their limits; a finding is dropped when it names a
 * question, person or plot it may not, names neither a question nor a plot, or gives a
 * number the tools did not; unknown recheck plots and survey changes to unknown questions
 * are dropped.
 */
export function validateReport(v: unknown, known: KnownNames): AiReport | null {
  if (!isObject(v) || !Array.isArray(v.findings)) return null;
  const summary = textOf(v.summary, REPORT_LIMITS.summary);
  if (!summary) return null;
  const findings = v.findings.map((f) => findingOf(f, known)).filter((f): f is AiFinding => f !== null);
  const recheck = someStrings(v.recheckPlots, plotKey).filter((p) => known.plots.has(p));
  const changes = Array.isArray(v.surveyChanges) ? v.surveyChanges : [];
  const surveyChanges = [];
  for (const c of changes) {
    if (!isObject(c) || typeof c.question !== 'string' || !known.questions.has(c.question)) continue;
    const suggestion = textOf(c.suggestion, REPORT_LIMITS.suggestion);
    if (suggestion) surveyChanges.push({ question: c.question, suggestion });
  }
  return {
    summary,
    findings: findings.slice(0, REPORT_LIMITS.findings),
    recheckPlots: recheck.slice(0, REPORT_LIMITS.recheckPlots),
    surveyChanges: surveyChanges.slice(0, REPORT_LIMITS.surveyChanges),
  };
}

/** The model's answer to a follow-up or a question, checked: null when it has no plain text. Unknown plots are dropped. */
export function validateAnswer(v: unknown, known: KnownNames): AiAnswer | null {
  if (!isObject(v)) return null;
  const text = textOf(v.text, ANSWER_LIMITS.text);
  if (!text) return null;
  return {
    text,
    plots: someStrings(v.plots, plotKey).filter((p) => known.plots.has(p)).slice(0, ANSWER_LIMITS.plots),
    note: noteOf(v.note, ANSWER_LIMITS.note),
  };
}

// ---------------------------------------------------------------------------
// Real names, only for the dashboard

/** Fields that hold question keys: left as they are. */
const QUESTION_FIELDS = new Set(['questions', 'question']);
/** Fields that hold plot names. */
const PLOT_FIELDS = new Set(['plots', 'recheckPlots']);
/** Draft guidance notes: they become notes for every collector, so they never get a username. */
const NOTE_FIELDS = new Set(['suggestedNote', 'note']);

/**
 * The stored result with the pseudonyms replaced, in one pass, by the usernames
 * (`persons` lists and texts) and the plot names by the plot ids (`plots` lists and
 * texts), also when the model translated them ("Persona A", "Parcela 3"). Draft notes
 * get plot ids but keep any pseudonym (they never name a person). For the dashboard's
 * response only (Task 15): never sent to the model.
 */
export function withRealNames<T>(stored: StoredResult<T>): T {
  const people = stored.pseudonyms;
  const plots = stored.plots ?? {};
  const person = (p: string) => {
    const k = personKey(p);
    return Object.hasOwn(people, k) ? people[k] : p;
  };
  const plot = (p: string) => {
    const k = plotKey(p);
    return Object.hasOwn(plots, k) ? plots[k] : p;
  };
  const inText = (s: string, withPeople: boolean) => {
    const t = s.replace(PLOT_IN_TEXT, (m) => plot(m));
    return withPeople ? t.replace(PERSON_IN_TEXT, (m) => person(m)) : t;
  };
  const map = (v: unknown, key?: string): unknown => {
    if (key !== undefined && QUESTION_FIELDS.has(key)) return v;
    if (key === 'persons' && Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? person(x) : x));
    if (key !== undefined && PLOT_FIELDS.has(key) && Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? plot(x) : x));
    if (typeof v === 'string') return inText(v, key === undefined || !NOTE_FIELDS.has(key));
    if (Array.isArray(v)) return v.map((x) => map(x));
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x, k)]));
    return v;
  };
  return map(stored.result) as T;
}

// ---------------------------------------------------------------------------
// The runs

class RunStop extends Error {
  constructor(
    readonly code: FailureCode,
    readonly detail?: unknown,
  ) {
    super(FAILURE_MESSAGES[code]);
  }
}

/** An off-topic question or answer, with the refusal to show. */
class Refusal {
  constructor(readonly message: string) {}
}

/** One run's state: its pseudonyms, tools, and what it has used. */
class Run {
  readonly limits: AiRunLimits;
  readonly box: ToolBox;
  readonly progress: RunProgress = { toolCalls: [], inputTokens: 0, outputTokens: 0, modelCalls: 0 };
  /** Input tokens of the last call: the next one is about as big, and a bit more. */
  private lastInput = 0;

  constructor(
    readonly ctx: AiRunContext,
    readonly pseudonyms: Pseudonyms,
    readonly plotNames: PlotNames,
  ) {
    this.limits = { ...DEFAULT_AI_LIMITS, ...ctx.limits };
    this.box = new ToolBox(ctx, pseudonyms, plotNames);
  }

  known(checkNumbers: boolean): KnownNames {
    return { questions: this.box.questions, persons: this.pseudonyms, plots: this.box.seenPlots, ...(checkNumbers ? { numbers: this.box.numbers } : {}) };
  }

  private async report(): Promise<void> {
    await this.ctx.onProgress?.({ ...this.progress, toolCalls: [...this.progress.toolCalls] });
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    if (this.progress.inputTokens > this.limits.maxInputTokens) {
      throw new RunStop('token_budget', { inputTokens: this.progress.inputTokens });
    }
    const res = await this.ctx.client.generate(req);
    this.progress.modelCalls++;
    this.progress.inputTokens += res.inputTokens;
    this.progress.outputTokens += res.outputTokens;
    this.lastInput = res.inputTokens;
    await this.report();
    if (res.blocked) {
      throw new RunStop('blocked', { blockReason: res.blockReason ?? 'unknown' });
    }
    if (res.text === null && res.calls.length === 0) {
      throw new RunStop('blocked', { blockReason: 'empty' });
    }
    if (this.progress.inputTokens > this.limits.maxInputTokens) {
      throw new RunStop('token_budget', { inputTokens: this.progress.inputTokens });
    }
    return res;
  }

  /** Whether one more loop turn and the final call still fit in the input budget. */
  private roomForAnotherTurn(): boolean {
    const next = this.lastInput * 1.2;
    return this.progress.inputTokens + next + Math.max(this.limits.finalReserveTokens, next) <= this.limits.maxInputTokens;
  }

  /** The tool loop: until the model stops calling tools, maxToolCalls calls in all, or the budget. */
  async toolLoop(system: string, turns: AiTurn[]): Promise<void> {
    let used = 0;
    while (used < this.limits.maxToolCalls) {
      if (this.progress.modelCalls > 0 && !this.roomForAnotherTurn()) return;
      const res = await this.generate({
        system,
        turns,
        tools: [...TOOLS],
        toolMode: this.limits.loopToolMode,
        thinking: 'low',
        timeoutMs: this.limits.turnTimeoutMs,
        maxOutputTokens: this.limits.maxOutputTokens,
      });
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

  /**
   * A structured call; the JSON checked. An answer that cannot be used goes back to the
   * model with the reason, and it is asked once more.
   */
  async structured<T>(req: AiRequest, check: (json: unknown) => T | null): Promise<T> {
    const turns = [...req.turns];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.generate({ ...req, turns });
      let reason = 'it was not valid JSON';
      try {
        const value = check(JSON.parse(res.text ?? ''));
        if (value !== null) return value;
        reason = 'it did not follow the schema, or its texts were not plain text';
      } catch {
        // not JSON
      }
      turns.push(modelTurn(res), { role: 'user', text: retryPrompt(reason) });
    }
    throw new RunStop('invalid_answer');
  }

  /** A topic check (no tools, minimal thinking): true when on topic. */
  onTopic(system: string, text: string): Promise<boolean> {
    return this.structured(
      {
        system,
        turns: [{ role: 'user', text }],
        responseSchema: TOPIC_SCHEMA,
        thinking: 'minimal',
        timeoutMs: this.limits.turnTimeoutMs,
        maxOutputTokens: TOPIC_CHECK_OUTPUT_TOKENS,
      },
      (json) => (isObject(json) && typeof json.on_topic === 'boolean' ? json.on_topic : null),
    );
  }

  /** The tool loop from `start`, then the final answer with `schema`. */
  async converse<T>(start: string, finalPrompt: string, schema: object, check: (json: unknown) => T | null): Promise<T> {
    const system = systemInstruction(this.ctx.language);
    const turns: AiTurn[] = [{ role: 'user', text: start }];
    await this.toolLoop(system, turns);
    // After a tool turn this is a second user turn: the client sends both as one content.
    turns.push({ role: 'user', text: finalPrompt });
    return this.structured(
      {
        system,
        turns,
        ...(this.limits.finalTools === 'none' ? { tools: [...TOOLS], toolMode: 'none' as const } : {}),
        responseSchema: schema,
        thinking: 'low',
        timeoutMs: this.limits.finalTimeoutMs,
        maxOutputTokens: this.limits.maxFinalOutputTokens,
      },
      check,
    );
  }

  async outcome<T>(work: () => Promise<T | Refusal>): Promise<RunOutcome<T>> {
    try {
      const value = await work();
      if (value instanceof Refusal) return { ...this.progress, status: 'refused', message: value.message };
      return { ...this.progress, status: 'done', result: value, pseudonyms: this.pseudonyms.toJSON(), plots: this.plotNames.toJSON() };
    } catch (err) {
      return { ...this.progress, ...failure(err) };
    }
  }
}

function failure(err: unknown): { status: 'failed'; code: FailureCode; error: string; httpStatus?: number; cause?: unknown } {
  if (err instanceof RunStop) return { status: 'failed', code: err.code, error: err.message, ...(err.detail !== undefined ? { cause: err.detail } : {}) };
  if (err instanceof AiError) {
    const code: FailureCode = err.timeout ? 'ai_timeout' : 'ai_unavailable';
    return { status: 'failed', code, error: FAILURE_MESSAGES[code], ...(err.status !== undefined ? { httpStatus: err.status } : {}), cause: err };
  }
  return { status: 'failed', code: 'server_error', error: FAILURE_MESSAGES.server_error, cause: err };
}

function newRun(ctx: AiRunContext, parent?: StoredResult<unknown>): Run {
  return new Run(ctx, Pseudonyms.of([...ctx.members, ...usernamesOf(ctx.report)], parent?.pseudonyms), PlotNames.of(parent?.plots));
}

function failedEarly<T>(code: FailureCode): Promise<RunOutcome<T>> {
  return Promise.resolve({ toolCalls: [], inputTokens: 0, outputTokens: 0, modelCalls: 0, status: 'failed', code, error: FAILURE_MESSAGES[code] });
}

/** A quality report of the project. */
export function runReport(ctx: AiRunContext): Promise<RunOutcome<AiReport>> {
  const run = newRun(ctx);
  return run.outcome(() => run.converse(REPORT_START, reportFinalPrompt(ctx.language), REPORT_SCHEMA, (json) => validateReport(json, run.known(true))));
}

/** Every plot a parent report names, so an answer about it may name them too. */
function parentPlots(report: AiReport): string[] {
  return [...report.recheckPlots, ...report.findings.flatMap((f) => f.plots)];
}

/**
 * A fixed follow-up on one finding of a report (`parent` as stored: pseudonymous). The
 * run keeps the parent's pseudonyms and plot names, so the finding's are the same.
 */
export function runFollowUp(
  ctx: AiRunContext,
  parent: StoredResult<AiReport>,
  findingIndex: number,
  action: FollowUpAction,
): Promise<RunOutcome<AiAnswer>> {
  const finding = Number.isInteger(findingIndex) ? parent.result.findings[findingIndex] : undefined;
  if (!finding) return failedEarly('no_finding');
  if (!FOLLOW_UP_ACTIONS.includes(action)) return failedEarly('bad_action');
  const run = newRun(ctx, parent);
  run.box.addSeenPlots(finding.plots);
  return run.outcome(() =>
    run.converse(followUpStart(action, finding), followUpFinalPrompt(ctx.language), ANSWER_SCHEMA, (json) => validateAnswer(json, run.known(false))),
  );
}

/**
 * A short free question about a report. A topic check comes first (no tools, only
 * `{ on_topic }`); off topic, the run is refused and nothing more is sent. The answer is
 * checked the same way before it is given: off topic, the run is refused too.
 */
export function runQuestion(ctx: AiRunContext, parent: StoredResult<AiReport>, question: string): Promise<RunOutcome<AiAnswer>> {
  const q = typeof question === 'string' ? question.replace(INVISIBLE, '').trim() : '';
  if (q === '' || q.length > MAX_QUESTION_CHARS) return failedEarly('bad_question');
  const run = newRun(ctx, parent);
  run.box.addSeenPlots(parentPlots(parent.result));
  const refusal = new Refusal(OFF_TOPIC_MESSAGE[ctx.language] ?? OFF_TOPIC_MESSAGE.en);
  return run.outcome<AiAnswer>(async () => {
    if (!(await run.onTopic(TOPIC_CHECK_SYSTEM, topicCheckTurn(q)))) return refusal;
    const answer = await run.converse(questionStart(parent.result, q), followUpFinalPrompt(ctx.language), ANSWER_SCHEMA, (json) =>
      validateAnswer(json, run.known(false)),
    );
    if (!(await run.onTopic(ANSWER_CHECK_SYSTEM, answerCheckTurn({ text: answer.text, note: answer.note })))) return refusal;
    return answer;
  });
}
