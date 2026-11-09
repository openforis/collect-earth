// Answers per person (Task 4): how the first assessments answer each question with
// choices or numbers, for the team and for each person, without any check. Two steps:
// - answerTable, on the quality worker with the report (it reads every answer): each
//   first assessment's answers packed into typed arrays (a code index per choice
//   question, a number per number question), with its person, plot and time;
// - answerStats, on the server for a filter (person, plots, days): a pass over the
//   table's rows, cheap enough to be done per request and kept for a few filters.
import { flagBuffers, flagTable, type FlagTable } from './flags.js';
import { dayInZone } from './progress.js';
import { keyRule, MIN_PLOTS, pairBuffers, qualityReport, recordResolver, type DifferingPairs, type QualityInput, type QualityReport } from './quality.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR } from './surveyOutline.js';
import { checkedPlots, healthBuffers, healthTable, type HealthTable } from './surveyHealth.js';
import { externalReferenceFigures, referenceFigures, type ReferenceFigures } from './reference.js';

/** |z| at or above this flags a person's share of an answer (two-proportion z-test). */
export const FLAG_Z = 3;
/** A person is flagged only with at least this many plots answering the question (and so must the rest of the team). */
export const FLAG_MIN_PLOTS = MIN_PLOTS;
/**
 * A flag also needs this difference between the two shares (0.10 = 10 points): with
 * thousands of plots a small difference is "significant" but not worth a look.
 */
export const FLAG_MIN_DIFFERENCE = 0.1;
/**
 * And at least this many plots expected with and without the answer on each side (n·p̂
 * and n·(1−p̂), p̂ the pooled share): below it the normal approximation of the z-test does
 * not hold, and a rare answer (1 of 20 against 0 of 1000: z 7) would top the list.
 */
export const FLAG_MIN_EXPECTED = 5;
/**
 * How often a comparison with no real difference still reaches |z| >= FLAG_Z: the
 * two-sided tail of the normal distribution at 3 (2·(1−Φ(3))). Times the comparisons made,
 * it is about how many flags chance alone would give (AnswerStats.chanceFlags).
 */
export const CHANCE_PER_TEST = 0.0026997960632601866;
/** Flags listed, the largest |z| first. */
export const MAX_FLAGS = 100;
/** Distinct codes a choice question may have in the table; more are left out (a code list that large is no choice). */
export const MAX_CODES = 65_000;
/** In a code column: the record holds several codes (see ChoiceColumn.several). */
const SEVERAL = 0xffff;

/** One choice question's answers, a code index per record (0 blank, i + 1 for codes[i]). */
export interface ChoiceColumn {
  key: string;
  label: string;
  multiple: boolean;
  /** The codes seen, in the survey's order of its options, then the others in code order. */
  codes: string[];
  /** Each code's label from the survey (the code itself when it has none). */
  codeLabels: string[];
  /**
   * null: `values` has one entry per record (dense). Else the records (row numbers,
   * increasing) that answered, `values` one per row here (sparse: mostly blank questions).
   */
  rows: Int32Array | null;
  values: Uint16Array;
  /** Records with several codes (SEVERAL in values), increasing; their codes are codes[offsets[i]..offsets[i+1]). */
  several: { rows: Int32Array; offsets: Int32Array; codes: Uint16Array };
}

/** One number question's answers: the records holding one number, and those holding something else. */
export interface NumberColumn {
  key: string;
  label: string;
  rows: Int32Array;
  values: Float64Array;
  /** Records whose answer is not one number (text, several values), increasing. */
  nonNumeric: Int32Array;
}

/**
 * The first assessments' answers. Row r is one submitted, not deleted first assessment
 * (round 1, `assessment` main, by the quality figures' recordResolver) of a plot of a
 * plot file: its person operators[operator[r]], its plot units[unit[r]], when it was
 * last saved (modifiedOn, ms).
 */
export interface AnswerTable {
  size: number;
  operators: string[];
  units: string[];
  operator: Uint32Array;
  unit: Int32Array;
  time: Float64Array;
  choices: ChoiceColumn[];
  numbers: NumberColumn[];
  /**
   * Every question the table looks at that some row holds a key for, also those every row
   * left blank (they have no column), in the survey's order: how many rows hold the key
   * with no answer ('', "null"; Collect Earth sends an empty root question as null, kept as
   * ''). A row without the key (a record stored before blanks were kept, an entity's
   * question) is not counted here. For survey health (Task 6).
   */
  asked: AskedQuestion[];
  /**
   * Rows known to keep their empty answers (see keepsBlanks): those holding a blank value
   * of any key, and those the server received since the first such record of the project.
   */
  rowsKeepingBlanks: number;
}

/** A question of the answer table, as survey health counts it (Task 6). */
export interface AskedQuestion {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  /** Rows holding it with no answer. */
  blank: number;
  /** Rows answering only with codes beyond MAX_CODES (answered, but not in a column). */
  overflow: number;
  /** Among the rows keeping their empty answers: those holding it blank, and those answering it (non-numbers too). */
  keptBlank: number;
  keptAnswered: number;
}

/** A summary value with no answer. */
const isBlankValue = (v: string) => v === '' || v === 'null' || v.trim() === '';

/**
 * Which rows say what was left empty. The server keeps an empty answer ('') only since
 * Task 5's review; records stored before have no key for their blanks, and leaving them
 * in would make a question look emptier on new records only. A row qualifies when it holds
 * a blank value (any key: it was stored keeping them), or when the server received it at
 * or after the first row holding one (from then on every save keeps them). Rows without
 * a receivedAt qualify only by holding a blank. Without any blank in the project, none.
 */
export function keepsBlanks(rows: readonly { r: { summary: Record<string, string>; receivedAt?: number } }[]): Uint8Array {
  const has = new Uint8Array(rows.length);
  let since = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const { summary, receivedAt } = rows[i].r;
    for (const key in summary) {
      const v = summary[key];
      if (typeof v === 'string' && isBlankValue(v) && Object.hasOwn(summary, key)) {
        has[i] = 1;
        if (receivedAt !== undefined && receivedAt < since) since = receivedAt;
        break;
      }
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const at = rows[i].r.receivedAt;
    if (!has[i] && at !== undefined && at >= since) has[i] = 1;
  }
  return has;
}

/** What the quality worker computes from one read of the records. */
export interface QualityFigures {
  report: QualityReport;
  answers: AnswerTable;
  /** What the pattern flags are worked out from (Task 5), its rows those of `answers`. */
  flags: FlagTable;
  /** What survey health is worked out from (Task 6): per question counts and the checked plots' differing questions. */
  health: HealthTable;
  /** The accuracy against the reference plots (Task 14). */
  reference: ReferenceFigures;
}

/** The report, the answers, the flags' table and survey health's, from the same records. */
export function qualityFigures(input: QualityInput): QualityFigures {
  if (input.excluded && input.excluded.length > 0) {
    const out = new Set(input.excluded);
    input = { ...input, records: input.records.filter((r) => !out.has(r.operator)) };
  }
  const kept = firstAssessments(input);
  const answers = answerTable(input, kept);
  const checked = checkedPlots();
  const report = qualityReport(input, checked.add);
  const external = externalReferenceFigures(input);
  const reference = referenceFigures(input);
  return { report, answers, flags: flagTable(input, kept, answers), health: healthTable(input.outline, answers, checked.done()), reference: external ? { ...reference, external } : reference };
}

/** The typed arrays of the tables, to hand them over between threads without copying. */
export function tableBuffers(t: AnswerTable, f?: FlagTable, h?: HealthTable, pairs?: DifferingPairs): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: ArrayBufferView | null) => {
    if (a && a.byteLength > 0 && !out.includes(a.buffer as ArrayBuffer)) out.push(a.buffer as ArrayBuffer);
  };
  if (f) for (const a of flagBuffers(f)) add(a);
  if (h) for (const a of healthBuffers(h)) add(a);
  if (pairs) for (const a of pairBuffers(pairs)) add(a);
  add(t.operator);
  add(t.unit);
  add(t.time);
  for (const c of t.choices) {
    add(c.rows);
    add(c.values);
    add(c.several.rows);
    add(c.several.offsets);
    add(c.several.codes);
  }
  for (const n of t.numbers) {
    add(n.rows);
    add(n.values);
    add(n.nonNumeric);
  }
  return out;
}

interface ChoiceBuild {
  kind: 'choice';
  key: string;
  label: string;
  multiple: boolean;
  options: { code: string; label: string }[];
  index: Map<string, number>;
  codes: string[];
  values: Uint16Array;
  present: number;
  severalRows: number[];
  severalOffsets: number[];
  severalCodes: number[];
  blank: number;
  overflow: number;
  keptBlank: number;
  keptAnswered: number;
}

interface NumberBuild {
  kind: 'number';
  key: string;
  label: string;
  values: Float64Array;
  present: number;
  nonNumeric: number[];
  blank: number;
  overflow: number;
  keptBlank: number;
  keptAnswered: number;
}

type Build = ChoiceBuild | NumberBuild | null;

const EMPTY_I32 = new Int32Array(0);
const EMPTY_U16 = new Uint16Array(0);

/** A choice answer's codes: without qualifiers, blank and "null" parts left out, each once. */
function codesOf(text: string): string[] {
  if (!text.includes(SUMMARY_VALUES_SEPARATOR) && !text.includes(QUALIFIER_SEPARATOR)) {
    const v = text.trim();
    return v === '' || v === 'null' ? [] : [v];
  }
  const out: string[] = [];
  for (const part of text.split(SUMMARY_VALUES_SEPARATOR)) {
    const i = part.indexOf(QUALIFIER_SEPARATOR);
    const code = (i < 0 ? part : part.slice(0, i)).trim();
    if (code !== '' && code !== 'null' && !out.includes(code)) out.push(code);
  }
  return out;
}

/** A number answer: blank (null), one number, or NaN for anything else (text, several values). */
function numberOf(text: string): number | null {
  const v = text.trim();
  if (v === '' || v === 'null') return null;
  if (v.includes(SUMMARY_VALUES_SEPARATOR)) {
    const parts = v.split(SUMMARY_VALUES_SEPARATOR).map((p) => p.trim()).filter((p) => p !== '' && p !== 'null');
    if (parts.length === 0) return null;
    return parts.length === 1 ? numberOf(parts[0]) : Number.NaN;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** A submitted, not deleted first assessment of a plot of a plot file, with that plot (unit). */
export interface FirstAssessment {
  r: QualityInput['records'][number];
  unit: string;
}

/** The rows of the answer table (and of the flag table), in the records' order. */
export function firstAssessments(input: QualityInput): FirstAssessment[] {
  const resolve = recordResolver(input);
  const kept: FirstAssessment[] = [];
  for (const r of input.records) {
    if (!r.activelySaved || r.deleted) continue;
    const { unit, round } = resolve(r);
    if (unit === null || round.assessment !== 'main') continue;
    kept.push({ r, unit });
  }
  return kept;
}

/**
 * The answer table of a project, from the same inputs as the quality report. A question
 * is one the report would compare (keyRule: an outline question with choices or a number,
 * not excluded; without an outline, by its name). A column answered by under a third of
 * the records is kept sparse.
 */
export function answerTable(input: QualityInput, kept: readonly FirstAssessment[] = firstAssessments(input)): AnswerTable {
  const size = kept.length;
  const operatorIndex = new Map<string, number>();
  const unitIndex = new Map<string, number>();
  const operators: string[] = [];
  const units: string[] = [];
  const operator = new Uint32Array(size);
  const unit = new Int32Array(size);
  const time = new Float64Array(size);
  const outline = input.outline;
  const builds = new Map<string, Build>();
  const buildOf = (key: string): Build => {
    let b = builds.get(key);
    if (b !== undefined) return b;
    const rule = keyRule(key, outline);
    b = null;
    if (rule.compare) {
      const q = outline?.get(key);
      if (rule.kind === 'choice') {
        const options = (q?.options ?? []).map((o) => ({ code: o.code, label: o.label }));
        b = {
          kind: 'choice', key, label: rule.label, multiple: q?.multiple === true, options,
          index: new Map(), codes: [], values: new Uint16Array(size), present: 0, severalRows: [], severalOffsets: [], severalCodes: [], blank: 0, overflow: 0, keptBlank: 0, keptAnswered: 0,
        };
      } else {
        b = { kind: 'number', key, label: rule.label, values: new Float64Array(size).fill(Number.NaN), present: 0, nonNumeric: [], blank: 0, overflow: 0, keptBlank: 0, keptAnswered: 0 };
      }
    }
    builds.set(key, b);
    return b;
  };
  const codeIndex = (b: ChoiceBuild, code: string): number | null => {
    let i = b.index.get(code);
    if (i === undefined) {
      if (b.codes.length >= MAX_CODES) return null;
      i = b.codes.length;
      b.codes.push(code);
      b.index.set(code, i);
    }
    return i;
  };

  const keeping = keepsBlanks(kept);
  let rowsKeepingBlanks = 0;
  for (let row = 0; row < size; row++) {
    const { r, unit: u } = kept[row];
    const keeps = keeping[row] === 1;
    if (keeps) rowsKeepingBlanks += 1;
    let oi = operatorIndex.get(r.operator);
    if (oi === undefined) {
      oi = operators.length;
      operators.push(r.operator);
      operatorIndex.set(r.operator, oi);
    }
    let ui = unitIndex.get(u);
    if (ui === undefined) {
      ui = units.length;
      units.push(u);
      unitIndex.set(u, ui);
    }
    operator[row] = oi;
    unit[row] = ui;
    time[row] = r.modifiedOn;
    const summary = r.summary;
    for (const key in summary) {
      if (!Object.hasOwn(summary, key)) continue;
      const value = summary[key];
      if (typeof value !== 'string') continue;
      const b = buildOf(key);
      if (b === null) continue;
      if (b.kind === 'number') {
        const n = numberOf(value);
        if (n === null) {
          b.blank += 1;
          if (keeps) b.keptBlank += 1;
          continue;
        }
        if (keeps) b.keptAnswered += 1;
        if (Number.isNaN(n)) {
          b.nonNumeric.push(row);
        } else {
          b.values[row] = n;
          b.present += 1;
        }
        continue;
      }
      const codes = codesOf(value);
      if (codes.length === 0) {
        b.blank += 1;
        if (keeps) b.keptBlank += 1;
        continue;
      }
      if (keeps) b.keptAnswered += 1;
      if (codes.length === 1) {
        const i = codeIndex(b, codes[0]);
        if (i === null) {
          b.overflow += 1;
          continue;
        }
        b.values[row] = i + 1;
      } else {
        const indexes = codes.map((c) => codeIndex(b, c)).filter((i): i is number => i !== null);
        if (indexes.length === 0) {
          b.overflow += 1;
          continue;
        }
        b.values[row] = SEVERAL;
        b.severalRows.push(row);
        b.severalOffsets.push(b.severalCodes.length);
        b.severalCodes.push(...indexes);
      }
      b.present += 1;
    }
  }

  // Questions in the survey's order, then the others by key.
  const outlineKeys = outline ? [...outline.keys()] : [];
  const rank = new Map(outlineKeys.map((k, i) => [k, i]));
  const all = [...builds.values()]
    .filter((b): b is ChoiceBuild | NumberBuild => b !== null)
    .sort((a, b) => (rank.get(a.key) ?? outlineKeys.length) - (rank.get(b.key) ?? outlineKeys.length) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const asked = all.map((b) => ({ key: b.key, label: b.label, kind: b.kind, blank: b.blank, overflow: b.overflow, keptBlank: b.keptBlank, keptAnswered: b.keptAnswered }));
  const ordered = all.filter((b) => b.present > 0 || (b.kind === 'number' && b.nonNumeric.length > 0));

  const choices: ChoiceColumn[] = [];
  const numbers: NumberColumn[] = [];
  for (const b of ordered) {
    if (b.kind === 'number') {
      const rows = new Int32Array(b.present);
      const values = new Float64Array(b.present);
      let j = 0;
      for (let row = 0; row < size; row++) {
        const v = b.values[row];
        if (!Number.isNaN(v)) {
          rows[j] = row;
          values[j] = v;
          j++;
        }
      }
      numbers.push({ key: b.key, label: b.label, rows, values, nonNumeric: Int32Array.from(b.nonNumeric) });
      continue;
    }
    // Codes in the order of the survey's options, then the others; the values renumbered.
    const optionRank = new Map(b.options.map((o, i) => [o.code, i]));
    const order = b.codes.map((code, i) => ({ code, i })).sort(
      (x, y) => (optionRank.get(x.code) ?? b.options.length) - (optionRank.get(y.code) ?? b.options.length) || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0),
    );
    const renumber = new Uint16Array(b.codes.length);
    order.forEach((o, k) => (renumber[o.i] = k));
    const labelOf = new Map(b.options.map((o) => [o.code, o.label]));
    const codes = order.map((o) => o.code);
    const codeLabels = codes.map((c) => labelOf.get(c) || c);
    const sparse = b.present * 3 < size;
    const rows = sparse ? new Int32Array(b.present) : null;
    const values = sparse ? new Uint16Array(b.present) : b.values;
    let j = 0;
    for (let row = 0; row < size; row++) {
      const v = b.values[row];
      const renumbered = v === 0 || v === SEVERAL ? v : renumber[v - 1] + 1;
      if (sparse) {
        if (v !== 0) {
          rows![j] = row;
          values[j] = renumbered;
          j++;
        }
      } else {
        values[row] = renumbered;
      }
    }
    const several = {
      rows: b.severalRows.length > 0 ? Int32Array.from(b.severalRows) : EMPTY_I32,
      offsets: b.severalRows.length > 0 ? Int32Array.from([...b.severalOffsets, b.severalCodes.length]) : EMPTY_I32,
      codes: b.severalCodes.length > 0 ? Uint16Array.from(b.severalCodes, (c) => renumber[c]) : EMPTY_U16,
    };
    choices.push({ key: b.key, label: b.label, multiple: b.multiple, codes, codeLabels, rows, values, several });
  }
  return { size, operators, units, operator, unit, time, choices, numbers, asked, rowsKeepingBlanks };
}

/** Which first assessments are counted. */
export interface AnswerFilter {
  /** Only this person's row and flags; the team's figures stay everyone's. */
  person?: string | null;
  /** Only these plots (a plot file's, or those with one value in a column of it). */
  units?: ReadonlySet<string> | null;
  /** Calendar days (YYYY-MM-DD, both included) of when the plot was last saved, in timeZone (UTC by default). */
  from?: string | null;
  to?: string | null;
  timeZone?: string;
}

export interface CodeCount {
  code: string;
  label: string;
  count: number;
}

export interface ChoiceStats {
  key: string;
  label: string;
  multiple: boolean;
  /** Plots answering it (at least one code). */
  answered: number;
  /** Plots in the filter that did not answer it (blank, or not shown). */
  blank: number;
  /** Plots holding each code (a plot of a multiple question counts once per code it holds), codes nobody gave left out. */
  codes: CodeCount[];
  /** Per person: plots answering, and plots holding each of `codes`, in that order. */
  people: { username: string; answered: number; counts: number[] }[];
  /** Flags on this question (all of them, also those beyond MAX_FLAGS). */
  flags: number;
}

export interface Spread {
  /** Plots holding one number. */
  values: number;
  /** Plots holding something else (text, several values): not used. */
  nonNumeric: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
}

export interface NumberStats {
  key: string;
  label: string;
  team: Spread;
  people: ({ username: string } & Spread)[];
}

export interface AnswerFlag {
  key: string;
  label: string;
  username: string;
  code: string;
  codeLabel: string;
  /** The person's plots answering the question, and those holding the code. */
  plots: number;
  count: number;
  share: number;
  /** The same for the rest of the team (everyone in the filter but this person). */
  others: { plots: number; count: number; share: number };
  z: number;
}

export interface AnswerStats {
  /** First assessments in the filter. */
  plots: number;
  person: string | null;
  /** Each person's plots in the filter (only the person's when one is chosen), by name. */
  people: { username: string; plots: number }[];
  choices: ChoiceStats[];
  numbers: NumberStats[];
  /** Up to MAX_FLAGS, the largest |z| first. */
  flags: AnswerFlag[];
  flagsTotal: number;
  /** Comparisons made (a person and an answer against the rest of the team, enough plots on both sides). */
  tests: number;
  /** About how many flags chance alone would give: tests × CHANCE_PER_TEST. */
  chanceFlags: number;
}

/**
 * The two-proportion z statistic of x1 of n1 against x2 of n2, with the pooled share;
 * null when it cannot be worked out (no plots on a side, or a pooled share of 0 or 1).
 */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return null;
  return (x1 / n1 - x2 / n2) / se;
}

/** Quartiles of sorted values, by linear interpolation between them (as R's type 7 and spreadsheets' QUARTILE.INC). */
export function quartiles(sorted: ArrayLike<number>): { q1: number; median: number; q3: number } {
  const at = (p: number) => {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(sorted.length - 1, lo + 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) };
}

function spreadOf(sorted: Float64Array, nonNumeric: number): Spread {
  if (sorted.length === 0) return { values: 0, nonNumeric, median: null, q1: null, q3: null };
  const { q1, median, q3 } = quartiles(sorted);
  return { values: sorted.length, nonNumeric, median, q1, q3 };
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The figures of the first assessments a filter keeps. */
export function answerStats(table: AnswerTable, filter: AnswerFilter = {}): AnswerStats {
  const { size, operators } = table;
  const people = operators.length;
  // Rows kept: by plot and by day.
  const keep = new Uint8Array(size);
  let unitKept: Uint8Array | null = null;
  if (filter.units) {
    unitKept = new Uint8Array(table.units.length);
    table.units.forEach((u, i) => {
      if (filter.units!.has(u)) unitKept![i] = 1;
    });
  }
  const from = filter.from ?? null;
  const to = filter.to ?? null;
  const dayOf = from !== null || to !== null ? dayInZone(filter.timeZone ?? 'UTC') : null;
  const plotsOf = new Int32Array(people);
  let plots = 0;
  for (let r = 0; r < size; r++) {
    if (unitKept && !unitKept[table.unit[r]]) continue;
    if (dayOf) {
      const d = dayOf(table.time[r]);
      if ((from !== null && d < from) || (to !== null && d > to)) continue;
    }
    keep[r] = 1;
    plots += 1;
    plotsOf[table.operator[r]] += 1;
  }
  const personIndex = filter.person ? operators.indexOf(filter.person) : -1;
  const shown = (i: number) => (filter.person ? i === personIndex : plotsOf[i] > 0);
  const shownPeople = operators.map((username, i) => ({ username, i })).filter(({ i }) => shown(i)).sort((a, b) => byName(a.username, b.username));

  const choices: ChoiceStats[] = [];
  const flags: AnswerFlag[] = [];
  let tests = 0;
  for (const c of table.choices) {
    const k = c.codes.length;
    // counts[person * k + code], answered per person.
    const counts = new Int32Array(people * k);
    const answeredOf = new Int32Array(people);
    let s = 0;
    const n = c.rows ? c.rows.length : size;
    for (let j = 0; j < n; j++) {
      const r = c.rows ? c.rows[j] : j;
      const v = c.values[j];
      if (v === SEVERAL) {
        // Rows with several codes come in increasing order: keep up with them.
        while (c.several.rows[s] < r) s++;
      }
      if (v === 0 || !keep[r]) continue;
      const p = table.operator[r];
      answeredOf[p] += 1;
      if (v === SEVERAL) {
        for (let x = c.several.offsets[s]; x < c.several.offsets[s + 1]; x++) counts[p * k + c.several.codes[x]] += 1;
      } else {
        counts[p * k + v - 1] += 1;
      }
    }
    let answered = 0;
    const team = new Int32Array(k);
    for (let p = 0; p < people; p++) {
      answered += answeredOf[p];
      for (let code = 0; code < k; code++) team[code] += counts[p * k + code];
    }
    if (answered === 0) continue;
    const given = [...team.keys()].filter((code) => team[code] > 0);
    const choice: ChoiceStats = {
      key: c.key,
      label: c.label,
      multiple: c.multiple,
      answered,
      blank: plots - answered,
      codes: given.map((code) => ({ code: c.codes[code], label: c.codeLabels[code], count: team[code] })),
      people: shownPeople.map(({ username, i }) => ({ username, answered: answeredOf[i], counts: given.map((code) => counts[i * k + code]) })),
      flags: 0,
    };
    choices.push(choice);
    const answering: number[] = [];
    for (let p = 0; p < people; p++) if (answeredOf[p] > 0) answering.push(p);
    // Each person against the rest of the team, NOT against the whole team: the person's
    // own plots would pull the team's share towards theirs and hide the difference.
    for (const { username, i } of shownPeople) {
      const n1 = answeredOf[i];
      const n2 = answered - n1;
      if (n1 < FLAG_MIN_PLOTS || n2 < FLAG_MIN_PLOTS) continue;
      // Two people answering: the second against "the rest" (the first) is the first's
      // comparison seen from the other side. Listed (and counted) once, from the first
      // by name, unless that one is not shown (the person filter).
      if (answering.length === 2) {
        const other = answering[0] === i ? answering[1] : answering[0];
        if (operators[other] < username && shown(other)) continue;
      }
      for (const code of given) {
        const x1 = counts[i * k + code];
        const x2 = team[code] - x1;
        const pooled = (x1 + x2) / (n1 + n2);
        const expected = Math.min(n1 * pooled, n1 * (1 - pooled), n2 * pooled, n2 * (1 - pooled));
        if (expected < FLAG_MIN_EXPECTED) continue;
        tests += 1;
        const z = twoProportionZ(x1, n1, x2, n2);
        if (z === null || Math.abs(z) < FLAG_Z || Math.abs(x1 / n1 - x2 / n2) < FLAG_MIN_DIFFERENCE) continue;
        choice.flags += 1;
        flags.push({
          key: c.key,
          label: c.label,
          username,
          code: c.codes[code],
          codeLabel: c.codeLabels[code],
          plots: n1,
          count: x1,
          share: x1 / n1,
          others: { plots: n2, count: x2, share: x2 / n2 },
          z,
        });
      }
    }
  }

  const numbers: NumberStats[] = [];
  for (const q of table.numbers) {
    const countOf = new Int32Array(people);
    const otherOf = new Int32Array(people);
    let total = 0;
    let other = 0;
    for (let j = 0; j < q.rows.length; j++) {
      const r = q.rows[j];
      if (!keep[r]) continue;
      countOf[table.operator[r]] += 1;
      total += 1;
    }
    for (const r of q.nonNumeric) {
      if (!keep[r]) continue;
      otherOf[table.operator[r]] += 1;
      other += 1;
    }
    if (total === 0 && other === 0) continue;
    // Each person's values together (offsets by person), then sorted per person.
    const offsets = new Int32Array(people + 1);
    for (let p = 0; p < people; p++) offsets[p + 1] = offsets[p] + countOf[p];
    const fill = offsets.slice(0, people);
    const byPerson = new Float64Array(total);
    for (let j = 0; j < q.rows.length; j++) {
      const r = q.rows[j];
      if (!keep[r]) continue;
      byPerson[fill[table.operator[r]]++] = q.values[j];
    }
    const all = byPerson.slice().sort();
    numbers.push({
      key: q.key,
      label: q.label,
      team: spreadOf(all, other),
      people: shownPeople.map(({ username, i }) => ({ username, ...spreadOf(byPerson.subarray(offsets[i], offsets[i + 1]).sort(), otherOf[i]) })),
    });
  }

  flags.sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || byName(a.username, b.username) || byName(a.key, b.key) || byName(a.code, b.code));
  return {
    plots,
    person: filter.person ?? null,
    people: shownPeople.map(({ username, i }) => ({ username, plots: plotsOf[i] })),
    choices,
    numbers,
    flags: flags.slice(0, MAX_FLAGS),
    flagsTotal: flags.length,
    tests,
    chanceFlags: tests * CHANCE_PER_TEST,
  };
}
