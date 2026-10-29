// Quality figures: how far the first (main) assessments and the quality checks of the
// same plots agree, by question, by person and by week, with the plots that differ and
// the records that do not fit. Pure functions; the routes (Task 10) load the inputs.
import type { RoundInfo } from './cep.js';
import { METADATA_KEY_PARTS } from './division.js';
import { copyUnitsByUser, keyShape, recordRound, unitOfRecord } from './rounds.js';
import { MAX_INDEXED_ENTITIES, QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR, type Question } from './surveyOutline.js';

/** Below this many compared plots a rate says nothing: it is null ("too few plots to judge"). */
export const MIN_PLOTS = 20;
/** The number margin, in percent, of a question the coordinator has not set one for. */
export const DEFAULT_MARGIN = 10;
export const MAX_DIFFERENCES = 500;
export const MAX_PROBLEMS = 500;
export const MAX_CONFUSIONS = 500;
export const MAX_CONFUSION_PLOTS = 20;
export const MAX_WEAKEST = 3;
export const MAX_BEYOND_OUTLINE_KEYS = 20;

/** What the store's listRecordSummaries gives, as far as the figures need it. */
export interface QualityRecord {
  recordKey: string;
  operator: string;
  modifiedOn: number;
  activelySaved: boolean;
  deleted: boolean;
  summary: Record<string, string>;
}

export interface QualityInput {
  /** Every record of the project; drafts and deleted ones are left out here. */
  records: readonly QualityRecord[];
  info: RoundInfo | null;
  /** The plot ids (units) of every plot file, parsed with fileKeyCount; never changed after. */
  units: ReadonlySet<string>;
  /** unit -> usernames holding it only as a quality-check copy (copyHoldersOf of the divided files). */
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>;
  /** The served survey's outline, or null when there is none (keys are then judged by their name). */
  outline: ReadonlyMap<string, Question> | null;
  /** Number margins in percent, by question key; DEFAULT_MARGIN for the others. */
  margins?: Readonly<Record<string, number>>;
}

export interface Rate {
  compared: number;
  agreeing: number;
  /** agreeing / compared (0..1), null when compared < MIN_PLOTS. */
  rate: number | null;
}

export interface QuestionAgreement extends Rate {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  /** The margin used, for a number question. */
  margin?: number;
}

export interface Confusion {
  key: string;
  /** The first assessment's answer and the check's: codes without qualifier, several sorted and joined by ", ". */
  first: string;
  check: string;
  count: number;
  /** Up to MAX_CONFUSION_PLOTS plots, in plot order. */
  plots: string[];
}

export interface PersonQuality {
  username: string;
  /** Checked plots this person assessed first; a plot agrees when no compared question differs. */
  asFirst: Rate;
  /** Plots this person checked. */
  asChecker: Rate;
  /** Up to MAX_WEAKEST questions where their plots (in either role) differ most; only questions that differed. */
  weakest: { key: string; rate: number | null; compared: number; differing: number }[];
}

export interface WeekAgreement {
  /** ISO week (yyyy-Www) of the check's modifiedOn, in UTC. */
  week: string;
  compared: number;
  agreeing: number;
}

export interface Difference {
  /** The plot unit, as in the plot file (with its round part for an own round). */
  plot: string;
  first: { operator: string; recordKey: string };
  check: { operator: string; recordKey: string };
  /** Answers as given, blank and null values left out, several joined by ", ". */
  fields: { key: string; first: string; check: string }[];
}

export type DataProblemKind = 'no_plot' | 'unknown_round' | 'two_main' | 'extra_key_parts';

export interface DataProblem {
  kind: DataProblemKind;
  plot: string;
  recordKey: string;
  operator: string;
}

export interface QualityReport {
  /** Plots with at least one main record and one check record. */
  plotsChecked: number;
  plotsDiffering: number;
  questions: QuestionAgreement[];
  confusions: Confusion[];
  people: PersonQuality[];
  weeks: WeekAgreement[];
  /** Up to MAX_DIFFERENCES, in plot order. */
  differences: Difference[];
  /** Up to MAX_PROBLEMS, in plot order. */
  problems: DataProblem[];
  problemsTotal: number;
  /** Answers to entities the outline does not list (e.g. tree[11]: it lists 1 to 10), never compared. */
  beyondOutline: { count: number; keys: string[] };
}

type Kind = 'choice' | 'number';
type KeyRule = { compare: false; beyond: boolean } | { compare: true; kind: Kind; label: string };

interface Pair {
  plot: string;
  first: QualityRecord;
  check: QualityRecord;
  /** Compared question keys and whether they agree. */
  results: Map<string, boolean>;
  agrees: boolean;
}

/**
 * The quality report of a project. Each plot unit's main record is paired with each of
 * its check records (all submitted): with several main records the latest is used and
 * the plot is listed as two_main. A question is compared on a pair when it is an
 * outline question (not excluded, choice or number) and at least one of the two
 * records has it in its summary; a missing value is then blank, and two blanks agree.
 */
export function qualityReport(input: QualityInput): QualityReport {
  const { info, units, copyHolders, outline } = input;
  const margins = input.margins ?? {};
  const shape = keyShape(info);
  const copyUnits = copyUnitsByUser(copyHolders);
  const problems: DataProblem[] = [];

  // Resolve each record as the export and the division do (exportRoundOf).
  const groups = new Map<string, { main: QualityRecord[]; check: QualityRecord[] }>();
  for (const r of input.records) {
    if (!r.activelySaved || r.deleted) {
      continue;
    }
    const unit = unitOfRecord(r.recordKey, units, info, copyUnits.get(r.operator));
    const rr = recordRound(r, info, copyHolders, unit);
    const group = unit ?? rr.plot;
    const problem = (kind: DataProblemKind) => problems.push({ kind, plot: group, recordKey: r.recordKey, operator: r.operator });
    if (unit === null) {
      problem('no_plot');
    }
    if (r.recordKey.split(',').length > shape.count) {
      problem('extra_key_parts');
    }
    if (rr.assessment === 'other') {
      problem('unknown_round');
      continue;
    }
    let g = groups.get(group);
    if (!g) {
      g = { main: [], check: [] };
      groups.set(group, g);
    }
    (rr.assessment === 'main' ? g.main : g.check).push(r);
  }

  const rules = new Map<string, KeyRule>();
  const ruleOf = (key: string): KeyRule => {
    let rule = rules.get(key);
    if (!rule) {
      rule = keyRule(key, outline);
      rules.set(key, rule);
    }
    return rule;
  };
  const beyond = new Set<string>();

  const pairs: Pair[] = [];
  for (const [plot, g] of groups) {
    if (g.main.length > 1) {
      for (const m of g.main) {
        problems.push({ kind: 'two_main', plot, recordKey: m.recordKey, operator: m.operator });
      }
    }
    if (g.main.length === 0 || g.check.length === 0) {
      continue;
    }
    const first = g.main.reduce((a, b) => (b.modifiedOn > a.modifiedOn ? b : a));
    for (const check of g.check) {
      const results = new Map<string, boolean>();
      for (const key of new Set([...Object.keys(first.summary), ...Object.keys(check.summary)])) {
        const rule = ruleOf(key);
        if (!rule.compare) {
          if (rule.beyond) {
            beyond.add(key);
          }
          continue;
        }
        const a = first.summary[key] ?? '';
        const b = check.summary[key] ?? '';
        results.set(key, rule.kind === 'choice' ? choiceText(a) === choiceText(b) : numbersAgree(a, b, margins[key] ?? DEFAULT_MARGIN));
      }
      pairs.push({ plot, first, check, results, agrees: [...results.values()].every(Boolean) });
    }
  }
  pairs.sort((x, y) => plotOrder(x.plot, y.plot) || order(x.check.operator, y.check.operator));

  // By question, in the outline's order, then the keys it does not know.
  const questions = new Map<string, QuestionAgreement>();
  const confusions = new Map<string, Confusion>();
  const people = new Map<string, { asFirst: Tally; asChecker: Tally; byKey: Map<string, Tally> }>();
  const person = (username: string) => {
    let p = people.get(username);
    if (!p) {
      p = { asFirst: tally(), asChecker: tally(), byKey: new Map() };
      people.set(username, p);
    }
    return p;
  };
  const weeks = new Map<string, Tally>();
  const differing = new Set<string>();
  const differences: Difference[] = [];

  for (const pair of pairs) {
    const { first, check, plot } = pair;
    for (const [key, agrees] of pair.results) {
      const rule = ruleOf(key) as Extract<KeyRule, { compare: true }>;
      let q = questions.get(key);
      if (!q) {
        q = { key, label: rule.label, kind: rule.kind, compared: 0, agreeing: 0, rate: null };
        if (rule.kind === 'number') {
          q.margin = margins[key] ?? DEFAULT_MARGIN;
        }
        questions.set(key, q);
      }
      count(q, agrees);
      for (const username of new Set([first.operator, check.operator])) {
        const byKey = person(username).byKey;
        let t = byKey.get(key);
        if (!t) {
          t = tally();
          byKey.set(key, t);
        }
        count(t, agrees);
      }
      if (!agrees && rule.kind === 'choice') {
        const a = choiceText(first.summary[key] ?? '');
        const b = choiceText(check.summary[key] ?? '');
        const id = JSON.stringify([key, a, b]);
        let c = confusions.get(id);
        if (!c) {
          c = { key, first: a, check: b, count: 0, plots: [] };
          confusions.set(id, c);
        }
        c.count += 1;
        if (c.plots.length < MAX_CONFUSION_PLOTS && c.plots[c.plots.length - 1] !== plot) {
          c.plots.push(plot);
        }
      }
    }
    count(person(first.operator).asFirst, pair.agrees);
    count(person(check.operator).asChecker, pair.agrees);
    const week = isoWeek(check.modifiedOn);
    let w = weeks.get(week);
    if (!w) {
      w = tally();
      weeks.set(week, w);
    }
    count(w, pair.agrees);
    if (!pair.agrees) {
      differing.add(plot);
      if (differences.length < MAX_DIFFERENCES) {
        differences.push({
          plot,
          first: { operator: first.operator, recordKey: first.recordKey },
          check: { operator: check.operator, recordKey: check.recordKey },
          fields: [...pair.results]
            .filter(([, agrees]) => !agrees)
            .map(([key]) => ({ key, first: shownText(first.summary[key] ?? ''), check: shownText(check.summary[key] ?? '') })),
        });
      }
    }
  }

  const outlineKeys = outline ? [...outline.keys()] : [];
  const outlineRank = new Map(outlineKeys.map((k, i) => [k, i]));
  const rank = (k: string) => outlineRank.get(k) ?? outlineKeys.length;
  problems.sort((x, y) => plotOrder(x.plot, y.plot) || order(x.recordKey, y.recordKey) || order(x.operator, y.operator));

  return {
    plotsChecked: new Set(pairs.map((p) => p.plot)).size,
    plotsDiffering: differing.size,
    questions: [...questions.values()]
      .sort((x, y) => rank(x.key) - rank(y.key) || order(x.key, y.key))
      .map((q) => ({ ...q, rate: rateOf(q) })),
    confusions: [...confusions.values()]
      .sort((x, y) => y.count - x.count || rank(x.key) - rank(y.key) || order(x.key, y.key) || order(x.first, y.first) || order(x.check, y.check))
      .slice(0, MAX_CONFUSIONS),
    people: [...people]
      .sort(([a], [b]) => order(a, b))
      .map(([username, p]) => ({
        username,
        asFirst: { ...p.asFirst, rate: rateOf(p.asFirst) },
        asChecker: { ...p.asChecker, rate: rateOf(p.asChecker) },
        weakest: [...p.byKey]
          .filter(([, t]) => t.agreeing < t.compared)
          .sort(([ka, a], [kb, b]) => a.agreeing / a.compared - b.agreeing / b.compared || b.compared - a.compared || rank(ka) - rank(kb) || order(ka, kb))
          .slice(0, MAX_WEAKEST)
          .map(([key, t]) => ({ key, rate: rateOf(t), compared: t.compared, differing: t.compared - t.agreeing })),
      })),
    weeks: [...weeks].sort(([a], [b]) => order(a, b)).map(([week, t]) => ({ week, compared: t.compared, agreeing: t.agreeing })),
    differences,
    problems: problems.slice(0, MAX_PROBLEMS),
    problemsTotal: problems.length,
    beyondOutline: { count: beyond.size, keys: [...beyond].sort(order).slice(0, MAX_BEYOND_OUTLINE_KEYS) },
  };
}

/** The ISO 8601 week (yyyy-Www) of a time, in UTC: the week's Thursday gives the year. */
export function isoWeek(time: number): string {
  const d = new Date(time);
  const date = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekday = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(date + (3 - weekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Whether and how a summary key is compared.
 * - In the outline: when not excluded and a choice or a number.
 * - An entity index beyond the outline (tree[11] when it lists tree[1] to tree[10]):
 *   never compared, counted.
 * - Else (no outline, or a key it does not know): never when its name has a
 *   METADATA_KEY_PARTS part; else by its prefix, code_ and boolean_ as a choice,
 *   integer_ and real_ (not ranges) as a number, and never anything else (free text).
 */
function keyRule(key: string, outline: ReadonlyMap<string, Question> | null): KeyRule {
  const q = outline?.get(key);
  if (q) {
    return !q.excluded && (q.kind === 'choice' || q.kind === 'number')
      ? { compare: true, kind: q.kind, label: q.label }
      : { compare: false, beyond: false };
  }
  if (outline) {
    const indexed = /^collect_entity_([^[.]+)\[(\d+)\]\.(.+)$/.exec(key);
    if (indexed && Number(indexed[2]) > MAX_INDEXED_ENTITIES && outline.has(`collect_entity_${indexed[1]}[1].${indexed[3]}`)) {
      return { compare: false, beyond: true };
    }
  }
  const lower = key.toLowerCase();
  if (METADATA_KEY_PARTS.some((part) => lower.includes(part))) {
    return { compare: false, beyond: false };
  }
  const name = key.slice(key.lastIndexOf('.') + 1).replace(/^collect_/, '');
  if (/^(code|boolean)_/.test(name)) {
    return { compare: true, kind: 'choice', label: key };
  }
  if (/^(integer|real)_/.test(name) && !/^(integer|real)_range_/.test(name)) {
    return { compare: true, kind: 'number', label: key };
  }
  return { compare: false, beyond: false };
}

/** The values of a summary answer: several joined by "===", blank and "null" parts left out. */
function valuesOf(text: string): string[] {
  return text
    .split(SUMMARY_VALUES_SEPARATOR)
    .map((v) => v.trim())
    .filter((v) => v !== '' && v !== 'null');
}

/** A choice answer as compared: codes without their qualifier, as a sorted set joined by ", ". */
function choiceText(text: string): string {
  const codes = valuesOf(text).map((v) => {
    const i = v.indexOf(QUALIFIER_SEPARATOR);
    return i < 0 ? v : v.slice(0, i);
  });
  return [...new Set(codes)].sort(order).join(', ');
}

/** An answer as shown in the differences list: its values, qualifiers kept. */
function shownText(text: string): string {
  return valuesOf(text).join(', ');
}

/**
 * Two number answers agree when both are blank, or when |a-b| <= margin% of the larger
 * magnitude. A text that is no number, or several values, agrees only with the same
 * text (several values as a set).
 */
function numbersAgree(a: string, b: string, margin: number): boolean {
  const va = valuesOf(a);
  const vb = valuesOf(b);
  if (va.length === 1 && vb.length === 1) {
    const x = Number(va[0]);
    const y = Number(vb[0]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return Math.abs(x - y) * 100 <= margin * Math.max(Math.abs(x), Math.abs(y));
    }
  }
  const set = (v: string[]) => [...new Set(v)].sort(order).join('\n');
  return set(va) === set(vb);
}

interface Tally {
  compared: number;
  agreeing: number;
}

function tally(): Tally {
  return { compared: 0, agreeing: 0 };
}

function count(t: Tally, agrees: boolean): void {
  t.compared += 1;
  if (agrees) {
    t.agreeing += 1;
  }
}

function rateOf(t: Tally): number | null {
  return t.compared >= MIN_PLOTS ? t.agreeing / t.compared : null;
}

const plotCollator = new Intl.Collator('en', { numeric: true });

function plotOrder(a: string, b: string): number {
  return plotCollator.compare(a, b) || order(a, b);
}

/** Plain code-point order. */
function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
