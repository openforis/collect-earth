// Reference plots (Task 14): plots a reference assessor (a coordinator or a reviewer the
// coordinator picks) assesses, and every collector checks blind. Each collector holds a copy of
// each one, so the plots reach them as round 2 like any check; their answers are then measured
// against the reference assessment: "accuracy against the reference", per person and per
// question. Those checks are left out of the agreement figures (qualityReport skips the reference
// plots), so they are not counted twice, nor in the review queue's differences, survey health's
// agreement, the check sampling's plots and its open checks.
//
// Pure functions; the routes (src/routes/reference.ts) load the inputs and store the changes,
// and the quality worker works out the figures in the same job as the report (qualityFigures).
import { isPlotUnit } from './progress.js';
import { compareAnswers, keyRule, later, MIN_PLOTS, plotOrder, recordResolver, type KeyRule, type QualityInput, type QualityRecord, type Rate } from './quality.js';
import { recordKeysOfUnit } from './rounds.js';
import { parsePlotFile } from './plots.js';
import type { Question } from './surveyOutline.js';
import { priority } from './sampling.js';
import type { RoundInfo } from './cep.js';
import type { Member, PlotAssignment, PlotHoldingKey, ReferencePlot } from './types.js';

/** At most this many reference plots per project (each is a copy for every collector). */
export const MAX_REFERENCE_PLOTS = 500;
/** At most this many plots named in one request (mark or unmark). */
export const MAX_PLOTS_PER_REQUEST = 500;

/** A question's accuracy: of the checks answering it (or the reference), how many match the reference. */
export interface ReferenceQuestion extends Rate {
  key: string;
  label: string;
  kind: 'choice' | 'number';
}

export interface ReferencePerson {
  username: string;
  /** Reference plots they checked (one check per plot, their latest); agreeing = every compared answer matches. */
  plots: Rate;
  /** Per question, in the survey's order: their answers compared with the reference's. */
  questions: { key: string; label: string; compared: number; agreeing: number; rate: number | null }[];
}

export interface ReferenceFigures {
  /** Reference plots, and of them those whose reference assessment is submitted (only those are measured). */
  plots: number;
  assessed: number;
  /** Checks measured: one per person and plot, with at least one question compared. */
  checks: number;
  /** Per question, everyone's checks together, in the survey's order. */
  questions: ReferenceQuestion[];
  /** Everyone with a check measured, by name. */
  people: ReferencePerson[];
  /** Each reference plot (plot order): its assessor, whether the reference is submitted, and how many checks of it are. */
  byPlot: { plot: string; assessor: string; assessed: boolean; checks: number }[];
  /** Against the reference answers a coordinator uploaded (externalReferenceFigures); absent without them. */
  external?: ExternalReferenceFigures;
}

export const NO_REFERENCE: ReferenceFigures = { plots: 0, assessed: 0, checks: 0, questions: [], people: [], byPlot: [] };

const rateOf = (compared: number, agreeing: number): Rate => ({ compared, agreeing, rate: compared >= MIN_PLOTS ? agreeing / compared : null });

/**
 * The accuracy against the reference: for every reference plot whose reference assessment (the
 * assessor's latest submitted first assessment of it) is submitted, each other person's latest
 * submitted check of it, compared question by question as the agreement figures compare a pair
 * (compareAnswers: the same questions, margins and blanks). A rate needs MIN_PLOTS compared,
 * else it is null ("too few plots to judge").
 */
export function referenceFigures(input: QualityInput): ReferenceFigures {
  const reference = input.reference;
  if (!reference || reference.size === 0) return NO_REFERENCE;
  const resolve = recordResolver(input);
  // Only the records that can be a reference plot's: one lookup per record, no resolution of the
  // others (a key with more parts than the survey has, a data problem, is not found this way).
  const keys = new Set<string>();
  for (const unit of reference.keys()) for (const k of recordKeysOfUnit(unit, input.info)) keys.add(k);
  const plots = new Map<string, { main: QualityRecord | null; checks: Map<string, QualityRecord> }>();
  for (const unit of reference.keys()) plots.set(unit, { main: null, checks: new Map() });
  for (const r of input.records) {
    if (!r.activelySaved || r.deleted || !keys.has(r.recordKey)) continue;
    const { round, group } = resolve(r);
    const p = plots.get(group);
    const assessor = reference.get(group);
    if (!p || assessor === undefined) continue;
    if (round.assessment === 'main' && r.operator === assessor) {
      if (!p.main || later(r, p.main)) p.main = r;
    } else if (round.assessment === 'check' && r.operator !== assessor) {
      const seen = p.checks.get(r.operator);
      if (!seen || later(r, seen)) p.checks.set(r.operator, r);
    }
  }

  const rules = new Map<string, KeyRule>();
  const ruleOf = (key: string) => {
    let rule = rules.get(key);
    if (!rule) {
      rule = keyRule(key, input.outline);
      rules.set(key, rule);
    }
    return rule;
  };
  const margins = input.margins ?? {};
  const questions = new Map<string, { kind: 'choice' | 'number'; compared: number; agreeing: number }>();
  const people = new Map<string, { compared: number; agreeing: number; questions: Map<string, { compared: number; agreeing: number }> }>();
  const byPlot: ReferenceFigures['byPlot'] = [];
  let assessed = 0;
  let checks = 0;
  for (const [plot, p] of plots) {
    byPlot.push({ plot, assessor: reference.get(plot)!, assessed: p.main !== null, checks: p.checks.size });
    if (!p.main) continue;
    assessed += 1;
    for (const [operator, check] of p.checks) {
      let person = people.get(operator);
      let all = true;
      let compared = 0;
      compareAnswers(p.main.summary, check.summary, ruleOf, margins, (key, kind, agrees) => {
        let q = questions.get(key);
        if (!q) {
          q = { kind, compared: 0, agreeing: 0 };
          questions.set(key, q);
        }
        if (!person) {
          person = { compared: 0, agreeing: 0, questions: new Map() };
          people.set(operator, person);
        }
        let pq = person.questions.get(key);
        if (!pq) {
          pq = { compared: 0, agreeing: 0 };
          person.questions.set(key, pq);
        }
        compared += 1;
        q.compared += 1;
        pq.compared += 1;
        if (agrees) {
          q.agreeing += 1;
          pq.agreeing += 1;
        } else {
          all = false;
        }
      });
      // A check with no question compared (blank wherever the reference is) says nothing: not counted.
      if (compared === 0 || !person) continue;
      checks += 1;
      person.compared += 1;
      if (all) person.agreeing += 1;
    }
  }

  const outlineKeys = input.outline ? [...input.outline.keys()] : [];
  const rank = new Map(outlineKeys.map((k, i) => [k, i]));
  const byOutline = (a: string, b: string) => (rank.get(a) ?? outlineKeys.length) - (rank.get(b) ?? outlineKeys.length) || (a < b ? -1 : a > b ? 1 : 0);
  const labelOf = (key: string) => {
    const rule = ruleOf(key);
    return rule.compare ? rule.label : key;
  };
  return {
    plots: reference.size,
    assessed,
    checks,
    questions: [...questions.keys()].sort(byOutline).map((key) => {
      const q = questions.get(key)!;
      return { key, label: labelOf(key), kind: q.kind, ...rateOf(q.compared, q.agreeing) };
    }),
    people: [...people.keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((username) => {
        const person = people.get(username)!;
        return {
          username,
          plots: rateOf(person.compared, person.agreeing),
          questions: [...person.questions.keys()].sort(byOutline).map((key) => ({ key, label: labelOf(key), ...rateOf(person.questions.get(key)!.compared, person.questions.get(key)!.agreeing) })),
        };
      }),
    byPlot: byPlot.sort((a, b) => plotOrder(a.plot, b.plot)),
  };
}

/** One person's accuracy, or null when they have no check measured (or there are no figures). */
export function personAccuracy(figures: ReferenceFigures | undefined | null, username: string): ReferencePerson | null {
  return figures?.people.find((p) => p.username === username) ?? null;
}

/** Who gets a copy of a reference plot: every collector (not disabled), never its assessor. */
export function getsReferenceCopy(m: Member, ref: Pick<ReferencePlot, 'assessorUserId'>): boolean {
  return m.role === 'operator' && !m.disabled && m.userId !== ref.assessorUserId;
}

export interface CopyPlanInput {
  references: readonly ReferencePlot[];
  members: readonly Member[];
  /** csvFileId -> its holdings now (divided files). */
  holdings: ReadonlyMap<string, readonly PlotAssignment[]>;
  /** Whether the person (username) has a record of the unit, any round, drafts too (not deleted). */
  hasRecord: (username: string, unit: string) => boolean;
  /** Only this person's copies are added (my-assignment); nothing is dropped then. */
  only?: string;
}

/**
 * The reference copies to add and drop so that every collector holds a copy of every reference
 * plot of a divided file: added for each collector (getsReferenceCopy) with no holding of the plot
 * in that file (marking leaves only the assessor as its main holder there). Dropped: the copies
 * of someone who would not get one now (no longer a collector, disabled; the assessor's own
 * holding is never touched) and has no record of the plot. A copy whose holder has a record of
 * the plot (any round, a draft too) is kept: it is their work in progress or done, and in a
 * project without a round in the key the copy is what tells their record from a second first
 * assessment (with a round, the key does). Members removed have no holdings left to drop.
 */
export function referenceCopyPlan(input: CopyPlanInput): { add: PlotHoldingKey[]; drop: PlotHoldingKey[] } {
  const add: PlotHoldingKey[] = [];
  const drop: PlotHoldingKey[] = [];
  const members = input.only !== undefined ? input.members.filter((m) => m.userId === input.only) : input.members;
  const byId = new Map(input.members.map((m) => [m.userId, m]));
  for (const ref of input.references) {
    const list = input.holdings.get(ref.csvFileId);
    if (!list) continue;
    const holders = new Set<string>();
    for (const a of list) if (a.plotKey === ref.plotKey) holders.add(a.userId);
    for (const m of members) {
      if (getsReferenceCopy(m, ref) && !holders.has(m.userId)) add.push({ csvFileId: ref.csvFileId, plotKey: ref.plotKey, userId: m.userId });
    }
    if (input.only !== undefined) continue;
    for (const a of list) {
      if (a.plotKey !== ref.plotKey || !a.overlap || a.userId === ref.assessorUserId) continue;
      const m = byId.get(a.userId);
      if (m && getsReferenceCopy(m, ref)) continue;
      if (m && input.hasRecord(m.username, ref.plotKey)) continue;
      // Someone no longer in the project has no holdings (removeMember drops them).
      if (m) drop.push({ csvFileId: ref.csvFileId, plotKey: ref.plotKey, userId: a.userId });
    }
  }
  return { add, drop };
}

/** Why plots cannot be marked; `plots`: up to 20 of those concerned. */
export interface MarkRefusal {
  code: 'whole_file' | 'unknown_plots' | 'not_a_plot' | 'in_other_file' | 'assessed_by_others' | 'too_many' | 'bad_assessor';
  plots?: string[];
}

export interface MarkInput {
  /** The file's plot units, in file order; null for a whole file. */
  units: readonly string[] | null;
  plots: readonly string[];
  info: RoundInfo | null;
  /** Whether the unit is also in another plot file. */
  inOtherFile: (unit: string) => boolean;
  /** Units with a first assessment (submitted or a draft) by someone other than the assessor. */
  assessedByOthers: ReadonlySet<string>;
  /** Reference plots of the project now, all files. */
  existing: number;
  /** Of `plots`, how many are reference plots already (of this file). */
  already: number;
}

/** Checks a mark: the plots exist in the (divided) file, are plots, are in no other file, and nobody else assessed them first. */
export function checkMark(input: MarkInput): MarkRefusal | null {
  if (input.units === null) return { code: 'whole_file' };
  if (input.existing - input.already + input.plots.length > MAX_REFERENCE_PLOTS) return { code: 'too_many' };
  const inFile = new Set(input.units);
  const some = (bad: (unit: string) => boolean) => input.plots.filter(bad).slice(0, 20);
  const unknown = some((u) => !inFile.has(u));
  if (unknown.length > 0) return { code: 'unknown_plots', plots: unknown };
  const isPlot = isPlotUnit(input.info);
  const checks = some((u) => !isPlot(u));
  if (checks.length > 0) return { code: 'not_a_plot', plots: checks };
  const elsewhere = some(input.inOtherFile);
  if (elsewhere.length > 0) return { code: 'in_other_file', plots: elsewhere };
  const assessed = some((u) => input.assessedByOthers.has(u));
  if (assessed.length > 0) return { code: 'assessed_by_others', plots: assessed };
  return null;
}

/**
 * `count` plots of a file picked at random (a seeded order: the same seed picks the same plots)
 * among those `free` says may be marked, in file order. Those `preferred` says come first: plots
 * whose collector has not downloaded their plots yet cannot be compared with a colleague's file
 * already on disk (a collector who compares plot files could otherwise spot a plot that appeared).
 */
export function pickReference(units: readonly string[], free: (unit: string) => boolean, count: number, seed: number, preferred: (unit: string) => boolean = () => false): string[] {
  const candidates = units.filter(free);
  const order = new Map(units.map((u, i) => [u, i]));
  const picked: string[] = [];
  // Preferred plots first, the rest only to make up the count; within each, spread over the file
  // (one plot at random from each of `need` equal stretches) so the picks are not neighbours that a
  // collector would notice as a run (a person's plots are often a block of the file).
  for (const tier of [candidates.filter(preferred), candidates.filter((u) => !preferred(u))]) {
    const need = Math.min(Math.max(0, count) - picked.length, tier.length);
    for (let i = 0; i < need; i++) {
      const from = Math.floor((i * tier.length) / need);
      const to = Math.floor(((i + 1) * tier.length) / need);
      let best = tier[from];
      for (let k = from + 1; k < to; k++) if (priority(seed, tier[k]) < priority(seed, best)) best = tier[k];
      picked.push(best);
    }
  }
  return picked.sort((a, b) => order.get(a)! - order.get(b)!);
}

/**
 * Plot ids as typed: an id that is not a plot of the file but whose comma-separated parts all are
 * ("5, 6, 7" pasted on one line) stands for those plots. Ids of several keys hold commas
 * themselves ("12,3"), so an id is only split when it is not a plot as it is. An id that is the
 * first key of exactly one plot of a file with several keys ("lagoon" for "lagoon,1", the id as
 * it is in the CSV) stands for that plot; when it is the first key of several, it stays unknown.
 */
export function splitListedPlots(plots: readonly string[], units: readonly string[]): string[] {
  const inFile = new Set(units);
  // The first key of each plot of several keys, and its plot (null: several plots share it).
  const byFirstKey = new Map<string, string | null>();
  for (const u of units) {
    const comma = u.indexOf(',');
    if (comma <= 0) continue;
    const first = u.slice(0, comma);
    byFirstKey.set(first, byFirstKey.has(first) ? null : u);
  }
  const out = new Set<string>();
  for (const plot of plots) {
    const parts = plot.split(',').map((p) => p.trim()).filter((p) => p !== '');
    const only = inFile.has(plot) ? null : byFirstKey.get(plot.trim());
    if (!inFile.has(plot) && parts.length > 1 && parts.every((p) => inFile.has(p))) parts.forEach((p) => out.add(p));
    else if (only) out.add(only);
    else out.add(plot);
  }
  return [...out];
}

/** The plot ids of a request: a list of distinct non-empty strings, at most MAX_PLOTS_PER_REQUEST; null otherwise. */
export function parsePlotList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLOTS_PER_REQUEST || !value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 1000)) return null;
  return [...new Set(value as string[])];
}

// --- Reference answers from a file: a coordinator's own reference set (Collect Earth Online's
// reference data), keyed by plot id, every collector's latest record of those plots compared with it.

/** At most this many plots in an uploaded reference set. */
export const MAX_REFERENCE_ANSWERS = 100_000;
/** At most this many unmatched values and unknown plots are reported back. */
const MAX_REPORTED = 50;

export interface ExternalReferenceFigures {
  /** Plots with reference answers, and of them those someone's record was compared on. */
  plots: number;
  assessed: number;
  /** Records compared: each person's latest submitted record of each plot (first assessment or check). */
  checks: number;
  /** Per question, everyone's answers together, in the survey's order: agreeing = the same as the reference. */
  questions: ReferenceQuestion[];
  /** Per person, by name: `answers` every compared answer (its share differing is their disagreement), `plots` all agreeing. */
  people: (ReferencePerson & { answers: Rate })[];
  /** Per plot (plot order): records compared, and their answers compared and agreeing. */
  byPlot: { plot: string; records: number; compared: number; agreeing: number }[];
}

export interface ParsedReferenceAnswers {
  rows: { plotKey: string; answers: Record<string, string> }[];
  /** The file's columns taken, with the question each one is. */
  columns: { column: string; key: string }[];
  /** Columns that are no question answers are compared on (by name, key or label). */
  unmatchedColumns: string[];
  /** Answers that are none of the question's (a number for a number question), with how often. */
  unmatchedValues: { column: string; value: string; count: number }[];
  /** Plot ids in no plot file of the project (their rows are not kept). */
  unknownPlots: string[];
  unknownPlotCount: number;
}

/** The questions answers are compared on (keyRule: calculated ones too, as the agreement figures compare them). */
function comparedQuestions(outline: ReadonlyMap<string, Question>): Question[] {
  return [...outline.values()].filter((q) => !q.excluded && (q.kind === 'choice' || q.kind === 'number'));
}

/**
 * Reads an uploaded reference set: a CSV (its first keyCount columns the plot id, as in a plot
 * file, then one column per question) or a JSON array of objects (`plot`, `plot_id` or `id`, then
 * the questions). A column is a question when its name is the question's summary key, its name
 * without the "collect_<type>_" prefix, or its label (case ignored). Choice answers are the codes
 * (or their labels); number answers numbers; blank cells give no answer. Rows of plots in no plot
 * file (`units`) are left out and listed, as are columns and answers that do not match.
 */
export function parseReferenceAnswers(
  body: Buffer | readonly unknown[],
  outline: ReadonlyMap<string, Question>,
  units: ReadonlySet<string>,
  keyCount: number,
): ParsedReferenceAnswers {
  const byName = new Map<string, Question>();
  for (const q of comparedQuestions(outline)) {
    for (const name of [q.label, q.key.replace(/^collect_[a-z]+_/, ''), q.key]) if (name) byName.set(name.trim().toLowerCase(), q);
  }
  // The table: a header of column names and rows of [plot id, cells by column].
  let names: string[];
  let table: { plot: string; cells: Record<string, unknown> }[];
  if (Buffer.isBuffer(body)) {
    const file = parsePlotFile(body, keyCount);
    const header = file.header?.fields ?? [];
    names = header.slice(keyCount);
    table = file.rows.map((row) => ({ plot: row.id, cells: Object.fromEntries(names.map((n, i) => [n, row.fields[keyCount + i] ?? ''])) }));
  } else {
    const objects = body.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x));
    const idOf = (o: Record<string, unknown>) => ['plot', 'plot_id', 'id'].find((k) => typeof o[k] === 'string' || typeof o[k] === 'number');
    names = [...new Set(objects.flatMap((o) => Object.keys(o).filter((k) => k !== idOf(o))))];
    table = objects.filter((o) => idOf(o) !== undefined).map((o) => ({ plot: String(o[idOf(o)!]).trim(), cells: o }));
  }
  const columns = names.flatMap((column) => {
    const q = byName.get(column.trim().toLowerCase());
    return q ? [{ column, key: q.key }] : [];
  });
  const taken = new Set(columns.map((c) => c.column));
  const unmatchedColumns = names.filter((n) => !taken.has(n) && n.trim() !== '');
  const questionOf = new Map(columns.map((c) => [c.column, outline.get(c.key)!]));
  const bad = new Map<string, { column: string; value: string; count: number }>();
  const unknown: string[] = [];
  const seen = new Set<string>();
  const rows: ParsedReferenceAnswers['rows'] = [];
  for (const { plot, cells } of table) {
    if (!units.has(plot)) {
      if (plot !== '' && !unknown.includes(plot)) unknown.push(plot);
      continue;
    }
    if (seen.has(plot)) continue; // the first row of a plot is taken, as in a plot file
    seen.add(plot);
    const answers: Record<string, string> = {};
    for (const { column, key } of columns) {
      const raw = cells[column];
      const value = raw === null || raw === undefined ? '' : String(raw).trim();
      if (value === '') continue;
      const q = questionOf.get(column)!;
      let answer: string | null = value;
      if (q.kind === 'number') {
        answer = Number.isFinite(Number(value.replace(',', '.'))) ? value.replace(',', '.') : null;
      } else if (!q.multiple && q.options && q.options.length > 0) {
        const lower = value.toLowerCase();
        answer = (q.options.find((o) => o.code === value) ?? q.options.find((o) => o.code.toLowerCase() === lower || o.label.trim().toLowerCase() === lower))?.code ?? null;
      }
      if (answer === null) {
        const id = `${column}\u0000${value}`;
        const b = bad.get(id);
        if (b) b.count += 1;
        else bad.set(id, { column, value, count: 1 });
        continue;
      }
      answers[key] = answer;
    }
    if (Object.keys(answers).length > 0) rows.push({ plotKey: plot, answers });
  }
  return {
    rows,
    columns,
    unmatchedColumns,
    // The most frequent first; else in the order met.
    unmatchedValues: [...bad.values()].sort((a, b) => b.count - a.count).slice(0, MAX_REPORTED),
    unknownPlots: unknown.slice(0, MAX_REPORTED),
    unknownPlotCount: unknown.length,
  };
}

/**
 * Everyone's answers against the uploaded reference answers (`input.referenceAnswers`, by plot
 * unit): each person's latest submitted record of each of those plots (a first assessment or a
 * check), only the questions the reference answers, compared as the agreement figures compare
 * (compareAnswers: margins, blanks; a question the reference answers and the record leaves blank
 * differs). Null without reference answers. A rate needs MIN_PLOTS compared, else it is null.
 */
export function externalReferenceFigures(input: QualityInput): ExternalReferenceFigures | null {
  const reference = input.referenceAnswers;
  if (!reference || reference.size === 0) return null;
  const resolve = recordResolver(input);
  const keys = new Set<string>();
  for (const unit of reference.keys()) for (const k of recordKeysOfUnit(unit, input.info)) keys.add(k);
  const latest = new Map<string, Map<string, QualityRecord>>();
  for (const r of input.records) {
    if (!r.activelySaved || r.deleted || !keys.has(r.recordKey)) continue;
    const { unit, group } = resolve(r);
    const plot = unit !== null && reference.has(unit) ? unit : reference.has(group) ? group : null;
    if (plot === null) continue;
    let byOperator = latest.get(plot);
    if (!byOperator) latest.set(plot, (byOperator = new Map()));
    const seen = byOperator.get(r.operator);
    if (!seen || later(r, seen)) byOperator.set(r.operator, r);
  }
  const rules = new Map<string, KeyRule>();
  const ruleOf = (key: string) => {
    let rule = rules.get(key);
    if (!rule) rules.set(key, (rule = keyRule(key, input.outline)));
    return rule;
  };
  const margins = input.margins ?? {};
  const count = () => ({ compared: 0, agreeing: 0 });
  const questions = new Map<string, { kind: 'choice' | 'number'; compared: number; agreeing: number }>();
  const people = new Map<string, { answers: { compared: number; agreeing: number }; plots: { compared: number; agreeing: number }; questions: Map<string, { compared: number; agreeing: number }> }>();
  const byPlot: ExternalReferenceFigures['byPlot'] = [];
  let checks = 0;
  for (const [plot, answers] of reference) {
    const entry = { plot, records: 0, compared: 0, agreeing: 0 };
    for (const [operator, record] of latest.get(plot) ?? []) {
      // Only what the reference answers: a question it leaves out says nothing.
      const mine: Record<string, string> = {};
      for (const key of Object.keys(answers)) if (Object.hasOwn(record.summary, key)) mine[key] = record.summary[key];
      let person = people.get(operator);
      let compared = 0;
      let all = true;
      compareAnswers(answers, mine, ruleOf, margins, (key, kind, agrees) => {
        if (!person) people.set(operator, (person = { answers: count(), plots: count(), questions: new Map() }));
        let q = questions.get(key);
        if (!q) questions.set(key, (q = { kind, ...count() }));
        let pq = person.questions.get(key);
        if (!pq) person.questions.set(key, (pq = count()));
        compared += 1;
        for (const c of [q, pq, person.answers]) {
          c.compared += 1;
          if (agrees) c.agreeing += 1;
        }
        if (agrees) entry.agreeing += 1;
        else all = false;
      });
      if (compared === 0 || !person) continue;
      checks += 1;
      entry.records += 1;
      entry.compared += compared;
      person.plots.compared += 1;
      if (all) person.plots.agreeing += 1;
    }
    byPlot.push(entry);
  }
  const outlineKeys = input.outline ? [...input.outline.keys()] : [];
  const rank = new Map(outlineKeys.map((k, i) => [k, i]));
  const byOutline = (a: string, b: string) => (rank.get(a) ?? outlineKeys.length) - (rank.get(b) ?? outlineKeys.length) || (a < b ? -1 : a > b ? 1 : 0);
  const labelOf = (key: string) => {
    const rule = ruleOf(key);
    return rule.compare ? rule.label : key;
  };
  return {
    plots: reference.size,
    assessed: byPlot.filter((p) => p.records > 0).length,
    checks,
    questions: [...questions.keys()].sort(byOutline).map((key) => {
      const q = questions.get(key)!;
      return { key, label: labelOf(key), kind: q.kind, ...rateOf(q.compared, q.agreeing) };
    }),
    people: [...people.keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((username) => {
        const p = people.get(username)!;
        return {
          username,
          answers: rateOf(p.answers.compared, p.answers.agreeing),
          plots: rateOf(p.plots.compared, p.plots.agreeing),
          questions: [...p.questions.keys()].sort(byOutline).map((key) => ({ key, label: labelOf(key), ...rateOf(p.questions.get(key)!.compared, p.questions.get(key)!.agreeing) })),
        };
      }),
    byPlot: byPlot.sort((a, b) => plotOrder(a.plot, b.plot)),
  };
}
