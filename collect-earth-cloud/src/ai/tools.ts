// The AI assistant's read-only tools (Task 14). They are built from the project's cached
// quality report (Task 9), its survey outline (Task 8), its guidance notes and, for
// get_plot, the records of one plot, all loaded by the caller for this one project.
//
// Never sent as they are: usernames and operators (only pseudonyms), record keys,
// coordinates, text questions, code qualifiers (free text), and answers that are not
// codes or numbers (aiSafeValue). Plots are sent only when they are in a plot file.
import type { CodeItem } from '../cep.js';
import { aiSafeValue, type PlotRecord, type QualityReport } from '../quality.js';
import type { Question } from '../surveyOutline.js';
import type { GuidanceNote } from '../types.js';
import type { AiTool } from './client.js';
import { PROJECT_DATA_NOTE } from './prompts.js';

/** A tool result (with its wrapper) never goes over this many characters of JSON. */
export const MAX_RESULT_CHARS = 20_000;
/** Labels, answer options, help texts and codes are cut to this many characters. */
export const MAX_LABEL_CHARS = 200;
/** Guidance note texts are cut to this many characters. */
export const MAX_NOTE_CHARS = 800;
export const MAX_DIFFERENCES_LIMIT = 50;
export const DEFAULT_DIFFERENCES_LIMIT = 20;
/** Longer plot ids are never sent (an id cannot be cut). */
export const MAX_PLOT_CHARS = 200;

/** The project data the tools read. Everything is of one project, loaded under its RLS. */
export interface ToolData {
  report: QualityReport;
  /** The served survey's outline, or null when there is none. */
  outline: ReadonlyMap<string, Question> | null;
  notes: readonly GuidanceNote[];
  /** The plot ids (units) of every plot file of the project (PlotContext.units). Other plots are never sent. */
  plots: ReadonlySet<string>;
  /** The records of one plot (quality.ts recordsOfPlot); without it get_plot says it is not available. */
  plotRecords?: (plot: string) => readonly PlotRecord[] | Promise<readonly PlotRecord[]>;
}

// ---------------------------------------------------------------------------
// Pseudonyms

/** "Person A" for 0, ..., "Person Z", "Person AA", "Person AB", ... */
export function pseudonymName(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    letters = String.fromCharCode(65 + r) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `Person ${letters}`;
}

/** Shown for a person the run has no pseudonym for (never their name). */
export const UNNAMED_PERSON = 'an unnamed person';

/** The people of one run, as pseudonyms. Usernames are sorted in code-point order. */
export class Pseudonyms {
  private readonly byUser = new Map<string, string>();
  private readonly byPseudonym = new Map<string, string>();

  /**
   * The pseudonyms of `usernames` (sorted), or, with `base` (the parent run's mapping,
   * pseudonym -> username), those of the base kept and the other usernames named after them.
   */
  static of(usernames: Iterable<string>, base?: Readonly<Record<string, string>>): Pseudonyms {
    const p = new Pseudonyms();
    let next = 0;
    if (base) {
      for (const [pseudonym, username] of Object.entries(base)) {
        p.add(pseudonym, username);
      }
      next = p.byUser.size;
    }
    const rest = [...new Set(usernames)].filter((u) => !p.byUser.has(u)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const username of rest) {
      let name = pseudonymName(next++);
      while (p.byPseudonym.has(name)) {
        name = pseudonymName(next++);
      }
      p.add(name, username);
    }
    return p;
  }

  private add(pseudonym: string, username: string): void {
    if (!this.byPseudonym.has(pseudonym) && !this.byUser.has(username)) {
      this.byPseudonym.set(pseudonym, username);
      this.byUser.set(username, pseudonym);
    }
  }

  of(username: string): string {
    return this.byUser.get(username) ?? UNNAMED_PERSON;
  }

  has(pseudonym: string): boolean {
    return this.byPseudonym.has(pseudonym);
  }

  /** pseudonym -> username, to store with the run's result. */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.byPseudonym);
  }
}

/** Every username the report names, to give each a pseudonym. */
export function usernamesOf(report: QualityReport): string[] {
  const names: string[] = [];
  for (const p of report.people) names.push(p.username);
  for (const d of report.differences) names.push(d.first.operator, d.check.operator);
  for (const p of report.problems) names.push(p.operator);
  return names;
}

// ---------------------------------------------------------------------------
// Tool definitions

const NO_ARGS = { type: 'object', properties: {} };

export const TOOLS: readonly AiTool[] = [
  {
    name: 'get_survey_outline',
    description: 'The survey\'s choice and number questions: key, label, kind, answer options and help text.',
    parameters: NO_ARGS,
  },
  {
    name: 'get_agreement',
    description:
      'How far first assessments and quality checks agree: for each question the checks compared, how many agree and the rate (null when too few checks to judge), and the same by ISO week.',
    parameters: NO_ARGS,
  },
  {
    name: 'get_confusions',
    description: 'For one question (its key), which answer of the first assessment was replaced by which answer in the check, how often, with up to 20 plots each.',
    parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question key.' } }, required: ['question'] },
  },
  {
    name: 'get_people',
    description: 'Figures per person (by pseudonym): checks of their plots as first assessor, checks they made, and their weakest questions.',
    parameters: NO_ARGS,
  },
  {
    name: 'get_differences',
    description: 'Plots where the first assessment and a check differ, with the differing choice and number answers. Optionally only for one question or one person (pseudonym).',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Only plots differing on this question key.' },
        person: { type: 'string', description: 'Only plots this person (pseudonym, e.g. "Person A") assessed or checked.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_DIFFERENCES_LIMIT, description: `How many plots, ${DEFAULT_DIFFERENCES_LIMIT} when not given.` },
      },
    },
  },
  {
    name: 'get_plot',
    description: 'The choice and number answers of the first assessment and of each check of one plot (its id).',
    parameters: { type: 'object', properties: { plot: { type: 'string', description: 'The plot id.' } }, required: ['plot'] },
  },
  {
    name: 'get_guidance_notes',
    description: 'The guidance notes the coordinators wrote for collectors, by question and, for a mix-up, the two answers.',
    parameters: NO_ARGS,
  },
];

export const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));

// ---------------------------------------------------------------------------
// Running a tool

/** What a call gave: the result to send, and the arguments as validated (null when refused). */
export interface ToolOutcome {
  ok: boolean;
  args: Record<string, unknown> | null;
  /** `{ project_data, note }`, or `{ error }`. */
  result: Record<string, unknown>;
}

/** Thrown inside a tool for arguments it refuses; the message is ours, never the arguments. */
class ToolArgError extends Error {}

/** A question as the tools may show it. */
interface ShownQuestion {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  options: CodeItem[] | null;
  help: string | null;
}

/** A key not from the outline is sent only when it looks like a summary key. */
const SAFE_KEY = /^collect_[A-Za-z0-9_]{1,150}(\[[A-Za-z0-9_]{1,40}\])?(\.[A-Za-z0-9_]{1,150})?$/;
/** A code not in the question's list is sent only when it looks like a code (no spaces, short). */
const CODE_LIKE = /^[\p{L}\p{N}_.\-]{1,50}$/u;

/** Cuts a text to `max` characters (code points), without breaking one. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join('');
}

/** The read-only tools of one run, with the plots and questions they have sent so far. */
export class ToolBox {
  /** Every plot id any tool result of this run contained (as sent, after capping). */
  readonly seenPlots = new Set<string>();
  /** The question keys a finding may name: the outline's choice and number questions, and the report's. */
  readonly questions: ReadonlyMap<string, ShownQuestion>;

  constructor(
    private readonly data: ToolData,
    readonly pseudonyms: Pseudonyms,
  ) {
    const questions = new Map<string, ShownQuestion>();
    if (data.outline) {
      for (const q of data.outline.values()) {
        if (!q.excluded && (q.kind === 'choice' || q.kind === 'number')) {
          questions.set(q.key, { key: q.key, label: q.label, kind: q.kind, options: q.options, help: q.help });
        }
      }
    }
    for (const q of data.report.questions) {
      if (!questions.has(q.key) && SAFE_KEY.test(q.key)) {
        questions.set(q.key, { key: q.key, label: q.label, kind: q.kind, options: null, help: null });
      }
    }
    this.questions = questions;
  }

  async call(name: string, rawArgs: unknown): Promise<ToolOutcome> {
    if (!TOOL_NAMES.has(name)) {
      return { ok: false, args: null, result: { error: 'There is no such tool.' } };
    }
    let args: Record<string, unknown>;
    let data: Record<string, unknown>;
    try {
      args = this.validate(name, rawArgs);
      data = await this.run(name, args);
    } catch (err) {
      if (err instanceof ToolArgError) {
        return { ok: false, args: null, result: { error: err.message } };
      }
      throw err;
    }
    const result = capResult(data);
    collectPlots(result, this.seenPlots);
    return { ok: !('error' in result), args, result };
  }

  /** Mark plots as returned by a tool (a parent report's, already checked). */
  addSeenPlots(plots: Iterable<string>): void {
    for (const p of plots) {
      if (this.data.plots.has(p)) this.seenPlots.add(p);
    }
  }

  private validate(name: string, raw: unknown): Record<string, unknown> {
    const args = raw ?? {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw new ToolArgError('The arguments must be an object.');
    }
    const a = args as Record<string, unknown>;
    const allowed: Record<string, string[]> = {
      get_confusions: ['question'],
      get_differences: ['question', 'person', 'limit'],
      get_plot: ['plot'],
    };
    const keys = allowed[name] ?? [];
    for (const k of Object.keys(a)) {
      if (!keys.includes(k)) throw new ToolArgError(`Unknown argument; this tool takes ${keys.length ? keys.join(', ') : 'none'}.`);
    }
    const out: Record<string, unknown> = {};
    if ('question' in a || name === 'get_confusions') {
      if (typeof a.question !== 'string' || !this.questions.has(a.question)) {
        throw new ToolArgError('"question" must be the key of a choice or number question of the survey (see get_survey_outline).');
      }
      out.question = a.question;
    }
    if ('person' in a) {
      if (typeof a.person !== 'string' || !this.pseudonyms.has(a.person)) {
        throw new ToolArgError('"person" must be a pseudonym given by get_people, such as "Person A".');
      }
      out.person = a.person;
    }
    if ('limit' in a) {
      if (typeof a.limit !== 'number' || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > MAX_DIFFERENCES_LIMIT) {
        throw new ToolArgError(`"limit" must be a whole number from 1 to ${MAX_DIFFERENCES_LIMIT}.`);
      }
      out.limit = a.limit;
    }
    if (name === 'get_plot') {
      if (typeof a.plot !== 'string' || !this.data.plots.has(a.plot) || a.plot.length > MAX_PLOT_CHARS) {
        throw new ToolArgError('"plot" must be the id of a plot of this project.');
      }
      out.plot = a.plot;
    }
    return out;
  }

  private async run(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case 'get_survey_outline':
        return this.surveyOutline();
      case 'get_agreement':
        return this.agreement();
      case 'get_confusions':
        return this.confusions(args.question as string);
      case 'get_people':
        return this.people();
      case 'get_differences':
        return this.differences(args as { question?: string; person?: string; limit?: number });
      case 'get_plot':
        return this.plot(args.plot as string);
      default:
        return this.notes();
    }
  }

  private surveyOutline(): Record<string, unknown> {
    return {
      questions: [...this.questions.values()].map((q) => ({
        key: q.key,
        label: cut(q.label, MAX_LABEL_CHARS),
        kind: q.kind,
        options: q.options ? q.options.map((o) => ({ code: cut(o.code, MAX_LABEL_CHARS), label: cut(o.label, MAX_LABEL_CHARS) })) : null,
        help: q.help === null ? null : cut(q.help, MAX_LABEL_CHARS),
      })),
    };
  }

  private agreement(): Record<string, unknown> {
    const r = this.data.report;
    return {
      plotsChecked: r.plotsChecked,
      plotsDiffering: r.plotsDiffering,
      questions: r.questions
        .filter((q) => this.questions.has(q.key))
        .map((q) => ({
          key: q.key,
          label: cut(this.questions.get(q.key)!.label, MAX_LABEL_CHARS),
          kind: q.kind,
          checks: q.compared,
          agreeing: q.agreeing,
          rate: q.rate,
          ...(q.margin !== undefined ? { marginPercent: q.margin } : {}),
        })),
      weeks: r.weeks.map((w) => ({ week: w.week, checks: w.compared, agreeing: w.agreeing })),
      about: 'Counts are checks. A rate is null when there are too few checks to judge.',
    };
  }

  private confusions(question: string): Record<string, unknown> {
    const q = this.questions.get(question)!;
    const confusions = [];
    for (const c of this.data.report.confusions) {
      if (c.key !== question) continue;
      const first = this.safeCodes(q, c.first);
      const check = this.safeCodes(q, c.check);
      if (first === null || check === null) continue;
      confusions.push({ first, check, checks: c.count, plots: this.safePlots(c.plots) });
    }
    return { question, confusions };
  }

  private people(): Record<string, unknown> {
    return {
      people: this.data.report.people.map((p) => ({
        person: this.pseudonyms.of(p.username),
        asFirstAssessor: { checks: p.asFirst.compared, agreeing: p.asFirst.agreeing, rate: p.asFirst.rate },
        asChecker: { checks: p.asChecker.compared, agreeing: p.asChecker.agreeing, rate: p.asChecker.rate },
        weakestQuestions: p.weakest
          .filter((w) => this.questions.has(w.key))
          .map((w) => ({ question: w.key, checks: w.compared, differing: w.differing, rate: w.rate })),
      })),
    };
  }

  private differences({ question, person, limit }: { question?: string; person?: string; limit?: number }): Record<string, unknown> {
    const out = [];
    let total = 0;
    const max = limit ?? DEFAULT_DIFFERENCES_LIMIT;
    for (const d of this.data.report.differences) {
      if (!this.plotOk(d.plot)) continue;
      const first = this.pseudonyms.of(d.first.operator);
      const check = this.pseudonyms.of(d.check.operator);
      if (person !== undefined && first !== person && check !== person) continue;
      const fields = [];
      for (const f of d.fields) {
        const q = this.questions.get(f.key);
        if (!q) continue;
        fields.push({ question: f.key, first: this.safeAnswer(q, f.first), check: this.safeAnswer(q, f.check) });
      }
      if (question !== undefined && !fields.some((f) => f.question === question)) continue;
      if (fields.length === 0) continue;
      total++;
      if (out.length < max) out.push({ plot: d.plot, firstAssessor: first, checker: check, answers: fields });
    }
    return {
      differences: out,
      matching: total,
      about: 'Up to the first 500 differing checks of the project. An answer of null cannot be shown; "" is no answer.',
    };
  }

  private async plot(plot: string): Promise<Record<string, unknown>> {
    if (!this.data.plotRecords) {
      return { error: 'The answers of single plots are not available.' };
    }
    const records = await this.data.plotRecords(plot);
    return {
      plot,
      assessments: records.map((r) => {
        const answers = [];
        for (const [key, value] of Object.entries(r.summary)) {
          const q = this.questions.get(key);
          if (!q) continue;
          const v = this.safeAnswer(q, value);
          if (v !== null && v !== '') answers.push({ question: key, answer: v });
        }
        return { assessment: r.assessment === 'main' ? 'first' : 'check', person: this.pseudonyms.of(r.operator), answers };
      }),
    };
  }

  private notes(): Record<string, unknown> {
    return {
      notes: this.data.notes.map((n) => ({
        question: cut(n.questionKey, MAX_LABEL_CHARS),
        firstAnswer: n.firstValue === null ? null : cut(n.firstValue, MAX_LABEL_CHARS),
        checkAnswer: n.checkValue === null ? null : cut(n.checkValue, MAX_LABEL_CHARS),
        text: cut(n.text, MAX_NOTE_CHARS),
      })),
    };
  }

  private plotOk(plot: string): boolean {
    return plot.length <= MAX_PLOT_CHARS && this.data.plots.has(plot);
  }

  private safePlots(plots: readonly string[]): string[] {
    return plots.filter((p) => this.plotOk(p));
  }

  /** An answer through aiSafeValue, and for a choice only codes of its list or that look like codes. */
  private safeAnswer(q: ShownQuestion, value: string): string | null {
    const v = aiSafeValue(q.kind, value);
    if (v === null || v === '' || q.kind === 'number') return v;
    return this.safeCodes(q, v);
  }

  /** Codes joined by ", " (as the report gives them), or null when one could be free text. */
  private safeCodes(q: ShownQuestion, codes: string): string | null {
    if (codes === '') return '';
    const known = q.options ? new Set(q.options.map((o) => o.code)) : null;
    const parts = codes.split(', ');
    return parts.every((c) => known?.has(c) || CODE_LIKE.test(c)) ? cut(codes, MAX_LABEL_CHARS) : null;
  }
}

/**
 * `{ project_data, note }`, at most MAX_RESULT_CHARS of JSON: when longer, the longest
 * lists are shortened (and `truncated: true` says so); `{ error }` when that is not enough.
 */
export function capResult(data: Record<string, unknown>): Record<string, unknown> {
  if ('error' in data) return { error: data.error };
  const wrap = (d: Record<string, unknown>) => ({ project_data: d, note: PROJECT_DATA_NOTE });
  const size = (d: Record<string, unknown>) => JSON.stringify(wrap(d)).length;
  if (size(data) <= MAX_RESULT_CHARS) return wrap(data);
  const d: Record<string, unknown> = { ...data, truncated: true };
  const lists = Object.keys(d)
    .filter((k) => Array.isArray(d[k]))
    .sort((a, b) => JSON.stringify(d[b]).length - JSON.stringify(d[a]).length);
  for (const k of lists) {
    const full = d[k] as unknown[];
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      d[k] = full.slice(0, mid);
      if (size(d) <= MAX_RESULT_CHARS) lo = mid;
      else hi = mid - 1;
    }
    d[k] = full.slice(0, lo);
    if (size(d) <= MAX_RESULT_CHARS) return wrap(d);
  }
  return { error: 'The result was too large to send.' };
}

/** The plot ids in a result as sent: every `plot` string and `plots` list. */
function collectPlots(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectPlots(v, into);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'plot' && typeof v === 'string') {
        into.add(v);
      } else if (k === 'plots' && Array.isArray(v)) {
        for (const p of v) {
          if (typeof p === 'string') into.add(p);
        }
      } else {
        collectPlots(v, into);
      }
    }
  }
}
