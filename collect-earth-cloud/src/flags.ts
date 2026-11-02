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
import { BOOKKEEPING_KEYS, SUMMARY_VALUES_SEPARATOR } from './surveyOutline.js';
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
  /**
   * Per row: when it was first submitted (its record event `submitted`; for a record stored
   * before events were kept, its modifiedOn). A plot corrected and submitted again later
   * keeps its place: "very fast" is about how the plots were first done.
   */
  submitted: Float64Array;
  /** The rows in each person's order: by person, then `submitted`, then record key. */
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
   * group (as the decisions are keyed): the records of groups[g] are start[g]..start[g+1],
   * each with its person, its last save (modifiedOn), when the server received it, a
   * hash of its answers, and whether it is submitted (1) or a draft (0).
   */
  saved: { groups: string[]; start: Int32Array; operators: string[]; operator: Uint32Array; time: Float64Array; received: Float64Array; hash: Uint32Array; submitted: Uint8Array };
}

/** What a decision keeps of the records of its plot as the figures showed them when it was made: each one's person and answers' hash. */
export interface DecisionSeen {
  operator: string;
  hash: number;
}

/** The keys whose answers are compared: questions, never bookkeeping, keys, plot-file values or calculated ones. */
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

/**
 * An answer as compared, or null for none: trimmed; several values (joined by "===") as
 * a set, blank and "null" parts left out, sorted.
 */
export function answerValue(v: string | undefined): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  if (!v.includes(SUMMARY_VALUES_SEPARATOR)) {
    // Most answers have no spaces around them: no trim then.
    if (v.charCodeAt(0) > 32 && v.charCodeAt(v.length - 1) > 32) return v === 'null' ? null : v;
    const t = v.trim();
    return t === '' || t === 'null' ? null : t;
  }
  const parts = [...new Set(v.split(SUMMARY_VALUES_SEPARATOR).map((p) => p.trim()).filter((p) => p !== '' && p !== 'null'))].sort();
  return parts.length === 0 ? null : parts.join(SUMMARY_VALUES_SEPARATOR);
}

/** FNV-1a over a string, 32 bits, going on from h. */
function fnv(text: string, h: number): number {
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The answers of a summary, walked by the outline's answer keys in order, or (no outline)
 * by every answer key of the records, sorted (gathered once: sorting each summary's own
 * keys took seconds on 100,000 records).
 */
function answersReader(outline: QualityInput['outline'], records: readonly { summary: Record<string, string> }[]) {
  const isAnswer = answerKeyRule(outline);
  let keys: string[];
  if (outline) {
    keys = [...outline.keys()].filter(isAnswer);
  } else {
    const all = new Set<string>();
    for (const r of records) for (const key in r.summary) if (!all.has(key) && Object.hasOwn(r.summary, key) && isAnswer(key)) all.add(key);
    keys = [...all].sort();
  }
  const keysOf = (_summary: Record<string, string>): readonly string[] => keys;
  // Each key's own hash, worked out once.
  const keyHashes = keys.map((k) => fnv(k, 0x811c9dc5));
  const get = (summary: Record<string, string>, key: string) => answerValue(Object.hasOwn(summary, key) ? summary[key] : undefined);
  return {
    /** Each answer of x is y's (with as many answers on both: the same answers). */
    same(x: Record<string, string>, y: Record<string, string>): boolean {
      for (const key of keysOf(x)) {
        const v = get(x, key);
        if (v !== null && v !== get(y, key)) return false;
      }
      return true;
    },
    /** In one pass: a hash of its answers (the questions answered and their answers, as compared) and how many there are. */
    digest(summary: Record<string, string>): { hash: number; count: number } {
      let h = 0x811c9dc5;
      let count = 0;
      for (let i = 0; i < keys.length; i++) {
        const v = get(summary, keys[i]);
        if (v !== null) {
          h = fnv(v, Math.imul(h ^ keyHashes[i], 0x01000193) >>> 0);
          count += 1;
        }
      }
      return { hash: h, count };
    },
  };
}

/**
 * The flag table of a project, from the same inputs and rows as the answer table
 * (`kept`: firstAssessments(input); `answers`: answerTable(input, kept)).
 */
export function flagTable(input: QualityInput, kept: readonly FirstAssessment[], answers: AnswerTable): FlagTable {
  const size = kept.length;
  const outline = input.outline;
  const reader = answersReader(outline, input.records);
  // Each record's answers digested once (the rows and the saved records share them).
  const digests = new Map<object, { hash: number; count: number }>();
  for (const r of input.records) if (!r.deleted) digests.set(r, reader.digest(r.summary));

  // Each person's order, by first submission (by the answer table's person index: the
  // same person, the same index; the order of the people among themselves does not matter).
  const submitted = new Float64Array(size);
  for (let row = 0; row < size; row++) submitted[row] = kept[row].r.firstSubmittedOn ?? kept[row].r.modifiedOn;
  const order = Int32Array.from({ length: size }, (_, i) => i);
  order.sort((a, b) => answers.operator[a] - answers.operator[b] || submitted[a] - submitted[b] || (kept[a].r.recordKey < kept[b].r.recordKey ? -1 : kept[a].r.recordKey > kept[b].r.recordKey ? 1 : 0));

  // Same answers as the person's previous plot: the same questions answered (blanks left
  // out), each with the same answer (several values as a set).
  const same = new Uint8Array(size);
  const counts = new Uint16Array(size);
  let prev = -1;
  for (let k = 0; k < size; k++) {
    const row = order[k];
    const r = kept[row].r;
    const d = digests.get(r) ?? reader.digest(r.summary);
    const n = d.count;
    counts[row] = Math.min(n, 0xffff);
    const p = prev >= 0 ? kept[prev].r : null;
    // Equal hashes first (cheap), then the answers themselves.
    if (p !== null && answers.operator[prev] === answers.operator[row] && n >= MIN_SAME_ANSWERS && counts[prev] === counts[row] && (digests.get(p) ?? reader.digest(p.summary)).hash === d.hash && reader.same(r.summary, p.summary)) {
      same[row] = 1;
    }
    prev = row;
  }

  // Required questions left blank. Collect Earth sends every empty root question as null
  // (kept as ''); a key absent from the summary is a record of a survey without the
  // question (or one stored before nulls were kept), and is not counted.
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
        if (Object.hasOwn(summary, requiredKeys[i]) && answerValue(summary[requiredKeys[i]]) === null) emptyKeys.push(i);
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
  const received = new Float64Array(total);
  const hash = new Uint32Array(total);
  const savedSubmitted = new Uint8Array(total);
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
    // Not known (a store that does not give it): taken as its last save.
    received[at] = r.receivedAt ?? r.modifiedOn;
    hash[at] = (digests.get(r) ?? reader.digest(r.summary)).hash;
    savedSubmitted[at] = r.activelySaved ? 1 : 0;
  });

  return {
    submitted,
    order,
    same,
    answers: counts,
    required: { keys: requiredKeys, labels: requiredLabels },
    empty: { rows: Int32Array.from(emptyRows), offsets: Int32Array.from(emptyOffsets), keys: Uint16Array.from(emptyKeys) },
    saved: { groups, start, operators, operator, time, received, hash, submitted: savedSubmitted },
  };
}

/** The records of a plot as the figures hold them: what a decision on it keeps (null when the figures do not have the plot). */
export function seenOf(f: FlagTable, plot: string): DecisionSeen[] | null {
  const g = groupIndexOf(f).get(plot);
  if (g === undefined) return null;
  const out: DecisionSeen[] = [];
  for (let i = f.saved.start[g]; i < f.saved.start[g + 1]; i++) out.push({ operator: f.saved.operators[f.saved.operator[i]], hash: f.saved.hash[i] });
  return out;
}

/** The typed arrays of a flag table, to hand it over between threads without copying. */
export function flagBuffers(f: FlagTable): ArrayBufferView[] {
  return [f.submitted, f.order, f.same, f.answers, f.empty.rows, f.empty.offsets, f.empty.keys, f.saved.start, f.saved.operator, f.saved.time, f.saved.received, f.saved.hash, f.saved.submitted];
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

/** A decision as the flags read it; `seen`: the records of its plot when it was made (null: not kept). */
export interface FlagDecision {
  plot: string;
  decision: DecisionKind;
  decidedAt: number;
  seen?: readonly DecisionSeen[] | null;
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
  decisions: readonly FlagDecision[],
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
          at: f.submitted[row],
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
      const gap = f.submitted[row] - f.submitted[prev];
      if (gap < fastMs) {
        add({ kind: 'very_fast', plot: plotOf(row), operator: t.operators[t.operator[row]], at: f.submitted[row], details: { gapMs: gap, previousPlot: plotOf(prev) } });
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

  // Saved again after a decision: a record of the plot the server received after the
  // decision whose answers are not those the decision was made on (`seen`: the records
  // as the figures showed them then). Merely going through a plot's tabs saves it again
  // (a new modifiedOn, the same answers): not flagged. A decision made without figures at
  // hand kept nothing: then a save made after it (modifiedOn, the collector's clock) and
  // received after it. Not after "both need another look": saving the plot again is then
  // what was asked (the review queue shows those apart, Task 7).
  const groups = decisions.some((d) => d.decision !== 'recheck') ? groupIndexOf(f) : null;
  for (const d of decisions) {
    if (d.decision === 'recheck' || groups === null) continue;
    const g = groups.get(d.plot);
    if (g === undefined) continue;
    for (const [o, at] of savedAgain(f, g, d, false)) {
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

/**
 * The records of plot group g the server received after decision d, each person's latest
 * (person index -> its modifiedOn). A record counts when its answers are not among those
 * the decision saw (`seen`), or, without `seen`, when it was also saved after the decision
 * (modifiedOn, the collector's clock). `submitted`: only records submitted now, and then
 * also one saved after the decision with the same answers (it was submitted again: the
 * answer to "both need another look"; going through a plot's tabs alone leaves it unsubmitted).
 */
function savedAgain(f: FlagTable, g: number, d: FlagDecision, submitted: boolean): Map<number, number> {
  const seen = d.seen ?? null;
  const latest = new Map<number, number>();
  for (let i = f.saved.start[g]; i < f.saved.start[g + 1]; i++) {
    if (f.saved.received[i] <= d.decidedAt) continue;
    if (submitted && f.saved.submitted[i] !== 1) continue;
    const operator = f.saved.operators[f.saved.operator[i]];
    const after = f.saved.time[i] > d.decidedAt;
    const unseen = seen !== null && !seen.some((x) => x.operator === operator && x.hash === f.saved.hash[i]);
    const counts = seen === null ? after : unseen || (submitted && after);
    if (counts && f.saved.time[i] > (latest.get(f.saved.operator[i]) ?? -Infinity)) latest.set(f.saved.operator[i], f.saved.time[i]);
  }
  return latest;
}

/** A plot decided "both need another look" whose record came back submitted: who, when (modifiedOn), and when it was decided. */
export interface Resubmitted {
  plot: string;
  operator: string;
  at: number;
  decidedAt: number;
}

/**
 * The plots decided "both need another look" that were submitted again since (the review
 * queue's third part, Task 7): a record of the plot submitted now, received after the
 * decision, either with answers the decision did not see or saved after it (see
 * savedAgain); each person once. Newest first. Sending a plot back (Task 12) will bring
 * these in by itself; until then the collector reopens the plot.
 */
export function resubmittedAfterRecheck(f: FlagTable, decisions: readonly FlagDecision[]): Resubmitted[] {
  const out: Resubmitted[] = [];
  if (!decisions.some((d) => d.decision === 'recheck')) return out;
  const groups = groupIndexOf(f);
  for (const d of decisions) {
    if (d.decision !== 'recheck') continue;
    const g = groups.get(d.plot);
    if (g === undefined) continue;
    for (const [o, at] of savedAgain(f, g, d, true)) out.push({ plot: d.plot, operator: f.saved.operators[o], at, decidedAt: d.decidedAt });
  }
  return out.sort((a, b) => b.at - a.at || (a.plot < b.plot ? -1 : a.plot > b.plot ? 1 : 0) || (a.operator < b.operator ? -1 : 1));
}

/** One person's counts (the coordinator's person page: never computed there, from the figures at hand). */
export function flagCountsOf(
  source: FlagSource,
  decisions: readonly FlagDecision[],
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
