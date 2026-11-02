// Pattern flags (Task 5): plots worth a look, found without any check. None blocks
// anything, none says anyone did wrong: a flag is a reason to open the plot.
// - very fast: a first assessment submitted under the project's threshold (15 s by
//   default) after the same person's previous one;
// - same as before: every answer the same as the same person's previous plot, in runs
//   of 3 or more;
// - required left empty: a question the survey requires without condition, blank;
// - edited after a decision: a record of a decided plot saved after the decision;
// - two first assessments, plot in no file: the quality report's data problems (they
//   are only linked to here, never worked out again).
// Two steps, as the answers per person (src/answerStats.ts):
// - flagTable, on the quality worker in the same job as the report and the answer
//   table (it reads every answer): what needs the answers, packed per answer-table row;
// - patternFlags, on the server per request: the threshold, the decisions (which change
//   without the records changing) and the filters applied to it, one pass over the rows.
import type { AnswerTable, FirstAssessment } from './answerStats.js';
import { keyRule, recordResolver, type QualityInput, type QualityReport } from './quality.js';
import { BOOKKEEPING_KEYS } from './surveyOutline.js';
import type { DecisionKind } from './types.js';

export const FLAG_KINDS = ['very_fast', 'same_as_before', 'required_empty', 'edited_after_decision', 'two_main', 'no_plot'] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** The "very fast" threshold of a project that has not set one, in seconds. */
export const DEFAULT_FAST_SECONDS = 15;
/** The threshold a project may set, in seconds. */
export const MIN_FAST_SECONDS = 1;
export const MAX_FAST_SECONDS = 120;
/** "Same as before" needs a run of this many plots with the same answers (the first of them included). */
export const MIN_SAME_RUN = 3;
/**
 * And at least this many answers in common: with one or two questions answered, plots
 * next to each other are often alike (forest, forest, forest) and that says nothing.
 */
export const MIN_SAME_ANSWERS = 3;
/** Flags listed in one answer, newest first (the counts are of all of them). */
export const MAX_LISTED_FLAGS = 500;
/** Required questions a table keeps (more are left out). */
const MAX_REQUIRED = 65_000;

/** One plot worth a look. A stable shape: the review queue (Task 7) is built from it. */
export interface Flag {
  kind: FlagKind;
  /** The plot unit (as Difference.plot and the decisions), or for a plot in no file its id. */
  plot: string;
  /** The username of the person whose record it is: the only person a flag ever names. */
  operator: string;
  /** When that record was saved (modifiedOn, ms), or null when it is not known. */
  at: number | null;
  details: FlagDetails;
}

export type FlagDetails =
  /** very_fast: ms since the same person's previous first assessment, and its plot. */
  | { gapMs: number; previousPlot: string }
  /** same_as_before: the plot before it (same answers), the run's length and its first plot. */
  | { previousPlot: string; runLength: number; firstPlot: string; answers: number }
  /** required_empty: the questions left empty. */
  | { questions: { key: string; label: string }[] }
  /** edited_after_decision: the decision and when it was made. */
  | { decision: DecisionKind; decidedAt: number }
  /** two_main, no_plot: the record (the quality report's data problem). */
  | { recordKey: string };

/**
 * What the flags need of the answers, its rows those of the answer table (row r is the
 * table's row r: a submitted, not deleted first assessment of a plot of a plot file).
 */
export interface FlagTable {
  /** The rows in each person's order: by person, then modifiedOn, then record key. */
  order: Int32Array;
  /**
   * Per row: 1 when its answers are all the same as those of the same person's previous
   * row in `order`, with at least MIN_SAME_ANSWERS of them; else 0.
   */
  same: Uint8Array;
  /** How many answers each row has (questions answered, blanks left out), up to 65,535. */
  answers: Uint16Array;
  /** The survey's required questions (Question.required), and the rows where some were left blank. */
  required: { keys: string[]; labels: string[] };
  /** Rows (increasing) with blank required questions; their indexes in `required` are keys[offsets[i]..offsets[i+1]). */
  empty: { rows: Int32Array; offsets: Int32Array; keys: Uint16Array };
  /**
   * Every saved, not deleted record of a known round (drafts and checks too), by its plot
   * group (as the decisions are keyed): the records of groups[g] are start[g]..start[g+1].
   */
  saved: { groups: string[]; start: Int32Array; operators: string[]; operator: Uint32Array; time: Float64Array };
}

/** The keys whose answers "same as before" compares: questions, never bookkeeping, keys, plot-file values or calculated ones. */
function answerKeyRule(outline: QualityInput['outline']): (key: string) => boolean {
  const memo = new Map<string, boolean>();
  return (key) => {
    let ok = memo.get(key);
    if (ok === undefined) {
      if (BOOKKEEPING_KEYS.has(key)) ok = false;
      else if (outline) {
        const q = outline.get(key);
        ok = q !== undefined && !q.excluded && !q.calculated;
      } else ok = keyRule(key, null).compare;
      memo.set(key, ok);
    }
    return ok;
  };
}

const isBlank = (v: string) => {
  const t = v.trim();
  return t === '' || t === 'null';
};

/**
 * The flag table of a project, from the same inputs and rows as the answer table
 * (`kept`: firstAssessments(input); `answers`: answerTable(input, kept)).
 */
export function flagTable(input: QualityInput, kept: readonly FirstAssessment[], answers: AnswerTable): FlagTable {
  const size = kept.length;
  const outline = input.outline;

  // Each person's order (by the answer table's person index: the same person, the same
  // index; the order of the people among themselves does not matter).
  const order = Int32Array.from({ length: size }, (_, i) => i);
  order.sort((a, b) => answers.operator[a] - answers.operator[b] || answers.time[a] - answers.time[b] || (kept[a].r.recordKey < kept[b].r.recordKey ? -1 : kept[a].r.recordKey > kept[b].r.recordKey ? 1 : 0));

  // Same answers as the person's previous plot: the same questions answered (blanks left
  // out), each with the same answer.
  const isAnswer = answerKeyRule(outline);
  const same = new Uint8Array(size);
  const counts = new Uint16Array(size);
  // With an outline, its answer keys are looked up (much faster than walking each summary).
  const answerKeys = outline ? [...outline.keys()].filter(isAnswer) : null;
  const value = (summary: Record<string, string>, key: string): string | null => {
    const v = Object.hasOwn(summary, key) ? summary[key] : undefined;
    if (typeof v !== 'string' || v.length === 0) return null;
    // Most answers have no spaces around them: no trim then.
    if (v.charCodeAt(0) > 32 && v.charCodeAt(v.length - 1) > 32) return v === 'null' ? null : v;
    const t = v.trim();
    return t === '' || t === 'null' ? null : t;
  };
  const answered = (summary: Record<string, string>): number => {
    let n = 0;
    if (answerKeys) {
      for (let i = 0; i < answerKeys.length; i++) if (value(summary, answerKeys[i]) !== null) n += 1;
      return n;
    }
    for (const key in summary) {
      if (Object.hasOwn(summary, key) && isAnswer(key) && value(summary, key) !== null) n += 1;
    }
    return n;
  };
  /** Each answer of x is y's (with as many answers on both, the same answers). */
  const sameAnswers = (x: Record<string, string>, y: Record<string, string>): boolean => {
    if (answerKeys) {
      for (let i = 0; i < answerKeys.length; i++) {
        const v = value(x, answerKeys[i]);
        if (v !== null && v !== value(y, answerKeys[i])) return false;
      }
      return true;
    }
    for (const key in x) {
      if (!Object.hasOwn(x, key) || !isAnswer(key)) continue;
      const v = value(x, key);
      if (v !== null && v !== value(y, key)) return false;
    }
    return true;
  };
  let prev = -1;
  for (let k = 0; k < size; k++) {
    const row = order[k];
    const summary = kept[row].r.summary;
    const n = answered(summary);
    counts[row] = Math.min(n, 0xffff);
    // Each answer of this plot is the previous one's, and as many: the same answers.
    if (prev >= 0 && answers.operator[prev] === answers.operator[row] && n >= MIN_SAME_ANSWERS && counts[prev] === counts[row] && sameAnswers(summary, kept[prev].r.summary)) {
      same[row] = 1;
    }
    prev = row;
  }

  // Required questions left blank (present in the summary: a record of a survey without
  // the question does not have it, and is not counted).
  const requiredKeys: string[] = [];
  const requiredLabels: string[] = [];
  for (const q of outline?.values() ?? []) {
    if (q.required === true && requiredKeys.length < MAX_REQUIRED) {
      requiredKeys.push(q.key);
      requiredLabels.push(q.label);
    }
  }
  const emptyRows: number[] = [];
  const emptyOffsets: number[] = [];
  const emptyKeys: number[] = [];
  if (requiredKeys.length > 0) {
    for (let row = 0; row < size; row++) {
      const summary = kept[row].r.summary;
      const at = emptyKeys.length;
      for (let i = 0; i < requiredKeys.length; i++) {
        const v = summary[requiredKeys[i]];
        if (typeof v === 'string' && Object.hasOwn(summary, requiredKeys[i]) && isBlank(v)) emptyKeys.push(i);
      }
      if (emptyKeys.length > at) {
        emptyRows.push(row);
        emptyOffsets.push(at);
      }
    }
  }
  if (emptyRows.length > 0) emptyOffsets.push(emptyKeys.length);

  // Every saved record by plot group, for the decisions.
  const resolve = recordResolver(input);
  const groupIndex = new Map<string, number>();
  const groups: string[] = [];
  const operatorIndex = new Map<string, number>();
  const operators: string[] = [];
  const recordGroup = new Int32Array(input.records.length).fill(-1);
  const sizes: number[] = [];
  input.records.forEach((r, i) => {
    if (r.deleted) return;
    const { round, group } = resolve(r);
    if (round.assessment === 'other') return;
    let g = groupIndex.get(group);
    if (g === undefined) {
      g = groups.length;
      groups.push(group);
      groupIndex.set(group, g);
      sizes.push(0);
    }
    recordGroup[i] = g;
    sizes[g] += 1;
  });
  const start = new Int32Array(groups.length + 1);
  for (let g = 0; g < groups.length; g++) start[g + 1] = start[g] + sizes[g];
  const fill = start.slice(0, groups.length);
  const total = start[groups.length];
  const operator = new Uint32Array(total);
  const time = new Float64Array(total);
  input.records.forEach((r, i) => {
    const g = recordGroup[i];
    if (g < 0) return;
    let o = operatorIndex.get(r.operator);
    if (o === undefined) {
      o = operators.length;
      operators.push(r.operator);
      operatorIndex.set(r.operator, o);
    }
    const at = fill[g]++;
    operator[at] = o;
    time[at] = r.modifiedOn;
  });

  return {
    order,
    same,
    answers: counts,
    required: { keys: requiredKeys, labels: requiredLabels },
    empty: { rows: Int32Array.from(emptyRows), offsets: Int32Array.from(emptyOffsets), keys: Uint16Array.from(emptyKeys) },
    saved: { groups, start, operators, operator, time },
  };
}

/** The typed arrays of a flag table, to hand it over between threads without copying. */
export function flagBuffers(f: FlagTable): ArrayBufferView[] {
  return [f.order, f.same, f.answers, f.empty.rows, f.empty.offsets, f.empty.keys, f.saved.start, f.saved.operator, f.saved.time];
}

/** group -> index in saved.groups, built once per table. */
const groupIndexes = new WeakMap<FlagTable, Map<string, number>>();
function groupIndexOf(f: FlagTable): Map<string, number> {
  let m = groupIndexes.get(f);
  if (!m) {
    m = new Map(f.saved.groups.map((g, i) => [g, i]));
    groupIndexes.set(f, m);
  }
  return m;
}

export type FlagCounts = Record<FlagKind, number>;

export const noCounts = (): FlagCounts => ({ very_fast: 0, same_as_before: 0, required_empty: 0, edited_after_decision: 0, two_main: 0, no_plot: 0 });

export interface FlagOptions {
  /** The "very fast" threshold, in seconds. */
  fastSeconds: number;
  /** Only this person's flags (the counts per person are of everyone). */
  person?: string | null;
  /** Only flags of this kind (the counts per kind are of every kind). */
  kind?: FlagKind | null;
}

export interface PatternFlags {
  fastSeconds: number;
  /** First assessments looked at (the answer table's rows). */
  plots: number;
  /** Flags of each kind, of the person when one is chosen; two_main and no_plot are all the report found. */
  counts: FlagCounts;
  /** Everyone with a flag, the most first: their counts by kind and in all. */
  people: { username: string; counts: FlagCounts; total: number }[];
  /** Flags that match the filters, listed or not. */
  total: number;
  /** Up to MAX_LISTED_FLAGS of them, newest first (the report lists up to 500 data problems: the two_main and no_plot listed are among those). */
  flags: Flag[];
  /** Whether the survey has questions required without condition (else required_empty can never be found). */
  requiredQuestions: number;
}

/** The figures the flags are worked out from: the report and the two tables of one computation. */
export interface FlagSource {
  report: QualityReport;
  answers: AnswerTable;
  flags: FlagTable;
}

/**
 * The pattern flags of a project, from the figures of one computation, the decisions as
 * they are now and the threshold. One pass over the rows in each person's order.
 */
export function patternFlags(
  source: FlagSource,
  decisions: readonly { plot: string; decision: DecisionKind; decidedAt: number }[],
  options: FlagOptions,
): PatternFlags {
  const { answers: t, flags: f, report } = source;
  const fastMs = options.fastSeconds * 1000;
  const person = options.person ?? null;
  const kind = options.kind ?? null;
  const all: Flag[] = [];
  const byPerson = new Map<string, FlagCounts>();
  const countFor = (username: string): FlagCounts => {
    let c = byPerson.get(username);
    if (!c) {
      c = noCounts();
      byPerson.set(username, c);
    }
    return c;
  };
  const add = (flag: Flag) => {
    countFor(flag.operator)[flag.kind] += 1;
    if ((person === null || flag.operator === person) && (kind === null || flag.kind === kind)) all.push(flag);
  };
  const plotOf = (row: number) => t.units[t.unit[row]];

  // Very fast and same as before, in each person's order.
  let runStart = -1;
  let runLength = 0;
  const pendingRun: number[] = [];
  const closeRun = () => {
    if (runLength >= MIN_SAME_RUN) {
      for (let i = 1; i < pendingRun.length; i++) {
        const row = pendingRun[i];
        add({
          kind: 'same_as_before',
          plot: plotOf(row),
          operator: t.operators[t.operator[row]],
          at: t.time[row],
          details: { previousPlot: plotOf(pendingRun[i - 1]), runLength, firstPlot: plotOf(runStart), answers: f.answers[row] },
        });
      }
    }
    pendingRun.length = 0;
    runLength = 0;
  };
  let prev = -1;
  for (let k = 0; k < f.order.length; k++) {
    const row = f.order[k];
    const samePerson = prev >= 0 && t.operator[prev] === t.operator[row];
    if (samePerson) {
      const gap = t.time[row] - t.time[prev];
      if (gap < fastMs) {
        add({ kind: 'very_fast', plot: plotOf(row), operator: t.operators[t.operator[row]], at: t.time[row], details: { gapMs: gap, previousPlot: plotOf(prev) } });
      }
    }
    if (samePerson && f.same[row] === 1) {
      pendingRun.push(row);
      runLength += 1;
    } else {
      closeRun();
      runStart = row;
      pendingRun.push(row);
      runLength = 1;
    }
    prev = row;
  }
  closeRun();

  // Required questions left empty.
  for (let i = 0; i < f.empty.rows.length; i++) {
    const row = f.empty.rows[i];
    const questions: { key: string; label: string }[] = [];
    for (let j = f.empty.offsets[i]; j < f.empty.offsets[i + 1]; j++) {
      const q = f.empty.keys[j];
      questions.push({ key: f.required.keys[q], label: f.required.labels[q] });
    }
    add({ kind: 'required_empty', plot: plotOf(row), operator: t.operators[t.operator[row]], at: t.time[row], details: { questions } });
  }

  // Saved again after a decision. Not after "both need another look": saving the plot
  // again is then what was asked (the review queue shows those apart, Task 7).
  const groups = decisions.some((d) => d.decision !== 'recheck') ? groupIndexOf(f) : null;
  for (const d of decisions) {
    if (d.decision === 'recheck' || groups === null) continue;
    const g = groups.get(d.plot);
    if (g === undefined) continue;
    // Each person's latest save after the decision, once.
    const latest = new Map<number, number>();
    for (let i = f.saved.start[g]; i < f.saved.start[g + 1]; i++) {
      if (f.saved.time[i] > d.decidedAt && f.saved.time[i] > (latest.get(f.saved.operator[i]) ?? -Infinity)) latest.set(f.saved.operator[i], f.saved.time[i]);
    }
    for (const [o, at] of latest) {
      add({ kind: 'edited_after_decision', plot: d.plot, operator: f.saved.operators[o], at, details: { decision: d.decision, decidedAt: d.decidedAt } });
    }
  }

  // The report's data problems: counted from all of them, listed from those it lists.
  for (const c of report.problemsByPerson ?? []) {
    if (c.kind === 'two_main' || c.kind === 'no_plot') countFor(c.operator)[c.kind] += c.count;
  }
  const groupsForTimes = report.problems.length > 0 ? groupIndexOf(f) : null;
  const savedAt = (plot: string, operator: string): number | null => {
    const g = groupsForTimes?.get(plot);
    if (g === undefined) return null;
    let at: number | null = null;
    for (let i = f.saved.start[g]; i < f.saved.start[g + 1]; i++) {
      if (f.saved.operators[f.saved.operator[i]] === operator && (at === null || f.saved.time[i] > at)) at = f.saved.time[i];
    }
    return at;
  };
  for (const p of report.problems) {
    if (p.kind !== 'two_main' && p.kind !== 'no_plot') continue;
    if ((person !== null && p.operator !== person) || (kind !== null && p.kind !== kind)) continue;
    all.push({ kind: p.kind, plot: p.plot, operator: p.operator, at: savedAt(p.plot, p.operator), details: { recordKey: p.recordKey } });
  }

  const counts = noCounts();
  if (person === null) {
    for (const c of byPerson.values()) for (const k of FLAG_KINDS) counts[k] += c[k];
  } else {
    Object.assign(counts, byPerson.get(person) ?? noCounts());
  }
  const totalOf = (c: FlagCounts) => FLAG_KINDS.reduce((s, k) => s + c[k], 0);
  const people = [...byPerson]
    .map(([username, c]) => ({ username, counts: c, total: totalOf(c) }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total || (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
  // Problems listed are a part of those counted: the total is the count's.
  const total =
    kind === null ? totalOf(counts) : counts[kind];
  all.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || (a.plot < b.plot ? -1 : a.plot > b.plot ? 1 : 0) || FLAG_KINDS.indexOf(a.kind) - FLAG_KINDS.indexOf(b.kind));
  return {
    fastSeconds: options.fastSeconds,
    plots: t.size,
    counts,
    people,
    total,
    flags: all.slice(0, MAX_LISTED_FLAGS),
    requiredQuestions: f.required.keys.length,
  };
}

/** One person's counts (the coordinator's person page: never computed there, from the figures at hand). */
export function flagCountsOf(
  source: FlagSource,
  decisions: readonly { plot: string; decision: DecisionKind; decidedAt: number }[],
  fastSeconds: number,
  username: string,
): FlagCounts {
  return patternFlags(source, decisions, { fastSeconds, person: username }).counts;
}

/** The threshold in a project's quality settings, or the default. */
export function fastSecondsOf(settings: { fastSeconds?: number }): number {
  const s = settings.fastSeconds;
  return typeof s === 'number' && Number.isInteger(s) && s >= MIN_FAST_SECONDS && s <= MAX_FAST_SECONDS ? s : DEFAULT_FAST_SECONDS;
}
