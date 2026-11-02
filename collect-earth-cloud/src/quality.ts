// Quality figures: how far the first (main) assessments and the quality checks of the
// same plots agree, by question, by person and by week, with the plots that differ and
// the records that do not fit. Pure functions; the routes (Task 10) load the inputs.
import type { RoundInfo } from './cep.js';
import { holderHas, type Holders } from './holders.js';
import { METADATA_KEY_PARTS } from './division.js';
import { copyUnitsByUser, keyShape, recordRound, unitOfRecord, type RecordRound } from './rounds.js';
import { BOOKKEEPING_KEYS, MAX_INDEXED_ENTITIES, QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR, type Question } from './surveyOutline.js';
import type { DecisionKind } from './types.js';

/** Below this many compared plots a rate says nothing: it is null ("too few plots to judge"). */
export const MIN_PLOTS = 20;
/** The number margin, in percent, of a question the coordinator has not set one for. */
export const DEFAULT_MARGIN = 10;
export const MAX_DIFFERENCES = 500;
export const MAX_PROBLEMS = 500;
export const MAX_CONFUSIONS = 500;
export const MAX_CONFUSION_PLOTS = 20;
export const MAX_WEAKEST = 3;
/** A person's own mix-ups as first assessor (the personal report, Task 11): how many, and plots each. */
export const MAX_PERSON_CONFUSIONS = 3;
export const MAX_PERSON_CONFUSION_PLOTS = 10;
export const MAX_BEYOND_OUTLINE_KEYS = 20;

/** What the store's listRecordSummaries gives, as far as the figures need it. */
export interface QualityRecord {
  recordKey: string;
  operator: string;
  modifiedOn: number;
  activelySaved: boolean;
  deleted: boolean;
  summary: Record<string, string>;
  /** When it was first submitted (its record event `submitted`), when the store gives it; null or absent: not known. */
  firstSubmittedOn?: number | null;
  /** When the server stored its last save, when the store gives it. */
  receivedAt?: number;
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
  /**
   * unit -> usernames holding it as a main plot, for every plot of a divided file (an
   * empty set for a plot no one holds). Only the personal figures use it: a plot of a
   * divided file whose first assessor is not its main holder is left out of them.
   */
  mainHolders?: ReadonlyMap<string, Holders>;
  /** Number margins in percent, by question key; DEFAULT_MARGIN for the others and for any that is no number >= 0. */
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
  /**
   * For the person's own report: only the plots that are certainly theirs as first
   * assessor. A plot with two main assessments (two_main) is left out, and so is a plot
   * of a divided file they do not hold as main: anyone could otherwise post a first
   * assessment of someone else's plot and read its check in their report.
   */
  personal: {
    /** The checks of those plots, as asFirst. */
    asFirst: Rate;
    /**
     * Up to MAX_PERSON_CONFUSIONS mix-ups of a choice between their first assessment and
     * a check of it, ordered as the report's confusions; count is checks, with up to
     * MAX_PERSON_CONFUSION_PLOTS plots (in plot order).
     */
    confusions: Confusion[];
  };
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
  /** How many problems of each kind name each person, over all of them (not only the listed ones); by person, then kind. */
  problemsByPerson: { operator: string; kind: DataProblemKind; count: number }[];
  /** Answers to entities the outline does not list (e.g. tree[11]: it lists 1 to 10), never compared. */
  beyondOutline: { count: number; keys: string[] };
}

type Kind = 'choice' | 'number';
export type KeyRule = { compare: false; beyond: boolean } | { compare: true; kind: Kind; label: string };

/**
 * One summary key, looked up once per pair key: its rule and, for a compared key, its
 * tallies (overall and by person index, grown on demand).
 */
interface Slot {
  id: number;
  key: string;
  rule: KeyRule;
  margin: number;
  compared: number;
  agreeing: number;
  personCompared: Int32Array;
  personAgreeing: Int32Array;
  /** Confusions of a choice: first answer -> check answer -> confusion. */
  confusions: Map<string, Map<string, Confusion>>;
}

/** A pair with at least one differing question, for the second pass. */
interface DifferingPair {
  plot: string;
  first: QualityRecord;
  check: QualityRecord;
  /** The slot ids of the differing questions, in the order they were compared. */
  slots: Uint32Array;
  /** Whether the plot is certainly the first assessor's (see PersonQuality.personal). */
  own: boolean;
}

/**
 * The quality report of a project. Each plot unit's main record is paired with each of
 * its check records (all submitted): with several main records the latest is used and
 * the plot is listed as two_main. A question is compared on a pair when it is an
 * outline question (not excluded, choice or number) and at least one of the two
 * records answers it (a blank or missing value on both sides is not compared).
 *
 * Built for 100k records of ~200 answers: the first pass over the pairs only counts,
 * with one lookup per key, and keeps the differing questions of each pair; confusions
 * and differences come from those in a second pass.
 *
 * `onCheckedPlot`, when given, is called once per checked plot with the compared
 * questions that differ between its main record (the one compared) and its LATEST check:
 * the two answers a decision for the check chooses between (see finalAnswers). Survey
 * health counts from it how often a question changed on plots decided for the check.
 */
export function qualityReport(input: QualityInput, onCheckedPlot?: (plot: string, differing: readonly string[]) => void): QualityReport {
  const { info, outline } = input;
  const margins = input.margins ?? {};
  const shape = keyShape(info);
  const resolve = recordResolver(input);
  const problems: DataProblem[] = [];

  // People by index, for typed-array tallies.
  const personIndex = new Map<string, number>();
  const usernames: string[] = [];
  const indexOf = (username: string): number => {
    let i = personIndex.get(username);
    if (i === undefined) {
      i = usernames.length;
      usernames.push(username);
      personIndex.set(username, i);
    }
    return i;
  };

  // Resolve each record as the export and the division do (exportRoundOf).
  const groups = new Map<string, { main: QualityRecord[]; check: QualityRecord[] }>();
  for (const r of input.records) {
    if (!r.activelySaved || r.deleted) {
      continue;
    }
    const { unit, round: rr, group } = resolve(r);
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
    indexOf(r.operator);
    let g = groups.get(group);
    if (!g) {
      g = { main: [], check: [] };
      groups.set(group, g);
    }
    (rr.assessment === 'main' ? g.main : g.check).push(r);
  }
  const people = usernames.length;

  const slots = new Map<string, Slot>();
  const slotList: Slot[] = [];
  const slotOf = (key: string): Slot => {
    let slot = slots.get(key);
    if (!slot) {
      const rule = keyRule(key, outline);
      slot = {
        id: slotList.length,
        key,
        rule,
        margin: marginOf(margins, key),
        compared: 0,
        agreeing: 0,
        personCompared: rule.compare ? new Int32Array(people) : EMPTY,
        personAgreeing: rule.compare ? new Int32Array(people) : EMPTY,
        confusions: new Map(),
      };
      slots.set(key, slot);
      slotList.push(slot);
    }
    return slot;
  };
  const beyond = new Set<string>();

  const firstCompared = new Int32Array(people);
  const firstAgreeing = new Int32Array(people);
  const checkerCompared = new Int32Array(people);
  const checkerAgreeing = new Int32Array(people);
  const ownCompared = new Int32Array(people);
  const ownAgreeing = new Int32Array(people);
  const mainHolders = input.mainHolders;
  const weeks = new Map<string, Tally>();
  const weekOfDay = new Map<number, string>();
  const differingPairs: DifferingPair[] = [];
  const differs: number[] = [];
  let plotsChecked = 0;
  let plotsDiffering = 0;

  for (const [plot, g] of groups) {
    if (g.main.length > 1) {
      for (const m of g.main) {
        problems.push({ kind: 'two_main', plot, recordKey: m.recordKey, operator: m.operator });
      }
    }
    if (g.main.length === 0 || g.check.length === 0) {
      continue;
    }
    plotsChecked += 1;
    let plotDiffers = false;
    const first = g.main.reduce((a, b) => (later(b, a) ? b : a));
    const fs = first.summary;
    const firstKeys = Object.keys(fs);
    const fi = personIndex.get(first.operator)!;
    const holders = mainHolders?.get(plot);
    const own = g.main.length === 1 && (holders === undefined || holderHas(holders, first.operator));
    const latestCheck = onCheckedPlot ? g.check.reduce((a, b) => (later(b, a) ? b : a)) : null;
    for (const check of g.check) {
      const cs = check.summary;
      const ci = personIndex.get(check.operator)!;
      differs.length = 0;
      const compare = (slot: Slot, a: string, b: string): void => {
        // Blank on both sides is not compared: Collect Earth sends every empty root
        // question (kept as ''), and two empty answers say nothing about agreement.
        if (isBlankAnswer(a) && isBlankAnswer(b)) {
          return;
        }
        const rule = slot.rule;
        if (!rule.compare) {
          if (rule.beyond) {
            beyond.add(slot.key);
          }
          return;
        }
        const agrees = a === b || (rule.kind === 'choice' ? choiceText(a) === choiceText(b) : numbersAgree(a, b, slot.margin));
        slot.compared += 1;
        slot.personCompared[fi] += 1;
        if (ci !== fi) {
          slot.personCompared[ci] += 1;
        }
        if (agrees) {
          slot.agreeing += 1;
          slot.personAgreeing[fi] += 1;
          if (ci !== fi) {
            slot.personAgreeing[ci] += 1;
          }
        } else {
          differs.push(slot.id);
        }
      };
      // The check's keys that the first record lacks: only walked when there are some.
      let shared = 0;
      for (let k = 0; k < firstKeys.length; k++) {
        const key = firstKeys[k];
        const b = cs[key];
        if (typeof b === 'string') {
          shared += 1;
        }
        compare(slotOf(key), text(fs[key]), text(b));
      }
      const checkKeys = Object.keys(cs);
      if (shared < checkKeys.length) {
        for (let k = 0; k < checkKeys.length; k++) {
          const key = checkKeys[k];
          if (fs[key] === undefined) {
            compare(slotOf(key), '', text(cs[key]));
          }
        }
      }
      if (check === latestCheck) {
        onCheckedPlot!(plot, differs.map((id) => slotList[id].key));
      }
      const agrees = differs.length === 0;
      firstCompared[fi] += 1;
      checkerCompared[ci] += 1;
      if (own) {
        ownCompared[fi] += 1;
        if (agrees) {
          ownAgreeing[fi] += 1;
        }
      }
      if (agrees) {
        firstAgreeing[fi] += 1;
        checkerAgreeing[ci] += 1;
      } else {
        plotDiffers = true;
        differingPairs.push({ plot, first, check, slots: Uint32Array.from(differs), own });
      }
      const day = Math.floor(check.modifiedOn / 86_400_000);
      let week = weekOfDay.get(day);
      if (week === undefined) {
        week = isoWeek(check.modifiedOn);
        weekOfDay.set(day, week);
      }
      let w = weeks.get(week);
      if (!w) {
        w = tally();
        weeks.set(week, w);
      }
      count(w, agrees);
    }
    if (plotDiffers) {
      plotsDiffering += 1;
    }
  }

  differingPairs.sort((x, y) => plotOrder(x.plot, y.plot) || order(x.check.operator, y.check.operator));
  const confusions: Confusion[] = [];
  const differences: Difference[] = [];
  // Each first assessor's share of each confusion (same key, answers), by person index.
  const personConfusions = new Map<number, Map<Confusion, Confusion>>();
  for (const pair of differingPairs) {
    const { first, check, plot } = pair;
    const fi = personIndex.get(first.operator)!;
    const fs = first.summary;
    const cs = check.summary;
    const fields: Difference['fields'] = [];
    const listed = differences.length < MAX_DIFFERENCES;
    for (const id of pair.slots) {
      const slot = slotList[id];
      const choice = slot.rule.compare && slot.rule.kind === 'choice';
      if (!choice && !listed) {
        continue;
      }
      const a = text(fs[slot.key]);
      const b = text(cs[slot.key]);
      if (choice) {
        const ta = choiceText(a);
        const tb = choiceText(b);
        let byFirst = slot.confusions.get(ta);
        if (!byFirst) {
          byFirst = new Map();
          slot.confusions.set(ta, byFirst);
        }
        let c = byFirst.get(tb);
        if (!c) {
          c = { key: slot.key, first: ta, check: tb, count: 0, plots: [] };
          byFirst.set(tb, c);
          confusions.push(c);
        }
        c.count += 1;
        if (c.plots.length < MAX_CONFUSION_PLOTS && c.plots[c.plots.length - 1] !== plot) {
          c.plots.push(plot);
        }
        let mine = pair.own ? personConfusions.get(fi) : undefined;
        if (pair.own && !mine) {
          mine = new Map();
          personConfusions.set(fi, mine);
        }
        if (mine) {
          let pc = mine.get(c);
          if (!pc) {
            pc = { key: c.key, first: c.first, check: c.check, count: 0, plots: [] };
            mine.set(c, pc);
          }
          pc.count += 1;
          if (pc.plots.length < MAX_PERSON_CONFUSION_PLOTS && pc.plots[pc.plots.length - 1] !== plot) {
            pc.plots.push(plot);
          }
        }
      }
      if (listed) {
        fields.push({ key: slot.key, first: shownText(a), check: shownText(b) });
      }
    }
    if (listed) {
      differences.push({
        plot,
        first: { operator: first.operator, recordKey: first.recordKey },
        check: { operator: check.operator, recordKey: check.recordKey },
        fields,
      });
    }
  }

  const outlineKeys = outline ? [...outline.keys()] : [];
  const outlineRank = new Map(outlineKeys.map((k, i) => [k, i]));
  const rank = (k: string) => outlineRank.get(k) ?? outlineKeys.length;
  problems.sort((x, y) => plotOrder(x.plot, y.plot) || order(x.recordKey, y.recordKey) || order(x.operator, y.operator));
  const compared = slotList.filter((s) => s.compared > 0);
  const confusionOrder = (x: Confusion, y: Confusion) =>
    y.count - x.count || rank(x.key) - rank(y.key) || order(x.key, y.key) || order(x.first, y.first) || order(x.check, y.check);

  return {
    plotsChecked,
    plotsDiffering,
    questions: compared
      .map((s) => {
        const rule = s.rule as Extract<KeyRule, { compare: true }>;
        const q: QuestionAgreement = { key: s.key, label: rule.label, kind: rule.kind, compared: s.compared, agreeing: s.agreeing, rate: rateOf(s) };
        if (rule.kind === 'number') {
          q.margin = s.margin;
        }
        return q;
      })
      .sort((x, y) => rank(x.key) - rank(y.key) || order(x.key, y.key)),
    confusions: confusions.sort(confusionOrder).slice(0, MAX_CONFUSIONS),
    people: usernames
      .map((username, i) => ({ username, i }))
      .filter(({ i }) => firstCompared[i] + checkerCompared[i] > 0)
      .sort((x, y) => order(x.username, y.username))
      .map(({ username, i }) => {
        const asFirst = { compared: firstCompared[i], agreeing: firstAgreeing[i] };
        const asChecker = { compared: checkerCompared[i], agreeing: checkerAgreeing[i] };
        return {
          username,
          asFirst: { ...asFirst, rate: rateOf(asFirst) },
          asChecker: { ...asChecker, rate: rateOf(asChecker) },
          weakest: compared
            .map((s) => ({ key: s.key, compared: s.personCompared[i], agreeing: s.personAgreeing[i] }))
            .filter((t) => t.agreeing < t.compared)
            .sort(
              (a, b) =>
                Number(b.compared >= MIN_PLOTS) - Number(a.compared >= MIN_PLOTS) ||
                b.compared - b.agreeing - (a.compared - a.agreeing) ||
                a.agreeing / a.compared - b.agreeing / b.compared ||
                rank(a.key) - rank(b.key) ||
                order(a.key, b.key),
            )
            .slice(0, MAX_WEAKEST)
            .map((t) => ({ key: t.key, rate: rateOf(t), compared: t.compared, differing: t.compared - t.agreeing })),
          personal: {
            asFirst: { compared: ownCompared[i], agreeing: ownAgreeing[i], rate: rateOf({ compared: ownCompared[i], agreeing: ownAgreeing[i] }) },
            confusions: [...(personConfusions.get(i)?.values() ?? [])].sort(confusionOrder).slice(0, MAX_PERSON_CONFUSIONS),
          },
        };
      }),
    weeks: [...weeks].sort(([a], [b]) => order(a, b)).map(([week, t]) => ({ week, compared: t.compared, agreeing: t.agreeing })),
    differences,
    problems: problems.slice(0, MAX_PROBLEMS),
    problemsTotal: problems.length,
    problemsByPerson: problemCounts(problems),
    beyondOutline: { count: beyond.size, keys: [...beyond].sort(order).slice(0, MAX_BEYOND_OUTLINE_KEYS) },
  };
}

const EMPTY = new Int32Array(0);

function problemCounts(problems: readonly DataProblem[]): QualityReport['problemsByPerson'] {
  const counts = new Map<string, { operator: string; kind: DataProblemKind; count: number }>();
  for (const p of problems) {
    const id = `${p.kind}\u0000${p.operator}`;
    const c = counts.get(id);
    if (c) c.count += 1;
    else counts.set(id, { operator: p.operator, kind: p.kind, count: 1 });
  }
  return [...counts.values()].sort((a, b) => order(a.operator, b.operator) || order(a.kind, b.kind));
}

/** The records' resolution shared by the figures and the export's final column. */
type ResolverInput = Pick<QualityInput, 'info' | 'units' | 'copyHolders'>;

/**
 * Resolves a record as the export and the division do (exportRoundOf): its unit among
 * the files' plot ids (with the operator's copy units), its round, and the group it is
 * paired in: the unit, or when in no file its plot, or for an own round its whole key
 * (its round tells the plots apart, and the reassessment code cannot be matched to a
 * unit). Decisions are keyed by that group.
 */
export function recordResolver({ info, units, copyHolders }: ResolverInput) {
  const shape = keyShape(info);
  const copyUnits = copyUnitsByUser(copyHolders);
  const ownRound = info?.state === 'own' && shape.roundIndex !== null;
  return (r: { recordKey: string; operator: string }): { unit: string | null; round: RecordRound; group: string } => {
    const unit = unitOfRecord(r.recordKey, units, info, copyUnits.get(r.operator));
    const round = recordRound(r, info, copyHolders, unit);
    return { unit, round, group: unit ?? (ownRound ? r.recordKey : round.plot) };
  };
}

/** The export's final column: the answer the coordinator took, the one set aside, both to look at again, or none. */
export type FinalAnswer = 'yes' | 'no' | 'recheck' | '';

/**
 * The final column of each record, from the coordinator's decisions (by plot unit, as
 * the figures pair records; see recordResolver). Only submitted, not deleted records of
 * a decided plot get a value:
 * - "first": the main record the figures compare (the latest, as in qualityReport) is
 *   yes, every other record of the plot no;
 * - "check": the latest check record is yes, every other no;
 * - "recheck": every record of the plot is recheck.
 * Records of other plots, drafts, and records of an unknown round are blank.
 */
export function finalAnswers(
  input: ResolverInput & { records: readonly QualityRecord[] },
  decisions: ReadonlyMap<string, DecisionKind>,
): (r: { recordKey: string; operator: string }) => FinalAnswer {
  const answers = new Map<string, FinalAnswer>();
  const id = (r: { recordKey: string; operator: string }) => `${r.recordKey}\u0000${r.operator}`;
  if (decisions.size > 0) {
    const resolve = recordResolver(input);
    const groups = new Map<string, { decision: DecisionKind; main: QualityRecord[]; check: QualityRecord[] }>();
    for (const r of input.records) {
      if (!r.activelySaved || r.deleted) {
        continue;
      }
      const { round, group } = resolve(r);
      const decision = decisions.get(group);
      if (decision === undefined || round.assessment === 'other') {
        continue;
      }
      let g = groups.get(group);
      if (!g) {
        g = { decision, main: [], check: [] };
        groups.set(group, g);
      }
      (round.assessment === 'main' ? g.main : g.check).push(r);
    }
    for (const g of groups.values()) {
      const all = [...g.main, ...g.check];
      if (g.decision === 'recheck') {
        for (const r of all) answers.set(id(r), 'recheck');
        continue;
      }
      const side = g.decision === 'first' ? g.main : g.check;
      const taken = side.length > 0 ? side.reduce((a, b) => (later(b, a) ? b : a)) : null;
      for (const r of all) answers.set(id(r), r === taken ? 'yes' : 'no');
    }
  }
  return (r) => answers.get(id(r)) ?? '';
}

/** A submitted record of one plot, as the figures pair it: the first (main) assessment or a check. */
export interface PlotRecord {
  assessment: 'main' | 'check';
  operator: string;
  modifiedOn: number;
  summary: Record<string, string>;
}

/**
 * The submitted, not deleted records of one plot (the unit, as `Difference.plot`), resolved
 * as the figures pair them (recordResolver), oldest first. Records of an unknown round are
 * left out. For the AI assistant's get_plot tool (Task 14), which sends only safe answers.
 */
export function recordsOfPlot(input: ResolverInput & { records: readonly QualityRecord[] }, plot: string): PlotRecord[] {
  const resolve = recordResolver(input);
  const out: PlotRecord[] = [];
  for (const r of input.records) {
    if (!r.activelySaved || r.deleted) {
      continue;
    }
    const { round, group } = resolve(r);
    if (group !== plot || round.assessment === 'other') {
      continue;
    }
    out.push({ assessment: round.assessment, operator: r.operator, modifiedOn: r.modifiedOn, summary: r.summary });
  }
  return out.sort((a, b) => a.modifiedOn - b.modifiedOn || Number(a.assessment === 'check') - Number(b.assessment === 'check'));
}

/**
 * An answer as it may be shown to the AI assistant (Task 14): never free text, names
 * or record keys. A choice gives its codes without qualifiers (the qualifier is free
 * text); a number its values when all are numbers; anything else null.
 */
export function aiSafeValue(kind: Question['kind'], value: string): string | null {
  if (kind === 'choice') {
    return choiceText(value);
  }
  if (kind === 'number') {
    const values = valuesOf(value);
    return values.every((v) => Number.isFinite(Number(v))) ? values.map((v) => String(Number(v))).join(', ') : null;
  }
  return null;
}

const INDEXED_ENTITY = /^(collect_entity_[^[.]+)\[\d+\]\./;

/**
 * The key a margin is set under: an indexed entity's question with its index as `[*]`
 * (`collect_entity_tree[3].real_height` → `collect_entity_tree[*].real_height`), so one
 * margin covers every tree; any other key as it is (a keyed entity, `land_use[F]`, is a
 * question of its own).
 */
export function marginKey(key: string): string {
  return key.replace(INDEXED_ENTITY, '$1[*].');
}

/** The margin of a number question: the one set (under its marginKey) when it is a number >= 0, else DEFAULT_MARGIN. */
function marginOf(margins: Readonly<Record<string, number>>, key: string): number {
  const m: unknown = margins[marginKey(key)];
  return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : DEFAULT_MARGIN;
}

/**
 * The margins a coordinator sends, checked against the served survey's outline: each key
 * a number question that is not excluded (an indexed entity's by any index or `[*]`, kept
 * as `[*]`), each value a number from 0 to 100. Gives the margins to store, or why not.
 */
export function checkMargins(margins: unknown, outline: ReadonlyMap<string, Question> | null): { margins: Record<string, number> } | { reason: string } {
  if (!margins || typeof margins !== 'object' || Array.isArray(margins)) {
    return { reason: 'margins must be an object of question key to percent' };
  }
  const numbers = new Set([...(outline?.values() ?? [])].filter((q) => q.kind === 'number' && !q.excluded).map((q) => marginKey(q.key)));
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(margins as Record<string, unknown>)) {
    const k = marginKey(key);
    if (!numbers.has(k)) {
      return { reason: `${key} is not a number question of the survey` };
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return { reason: `the margin of ${key} must be a number from 0 to 100` };
    }
    clean[k] = value;
  }
  return { margins: clean };
}

/** |a-b| <= margin% of the larger magnitude, with a relative tolerance for rounding (100 vs 90 at 10 %). */
function withinMargin(a: number, b: number, margin: number): boolean {
  return Math.abs(a - b) * 100 <= margin * Math.max(Math.abs(a), Math.abs(b)) * (1 + 1e-9);
}

/** Whether record a is taken over b (main, or check for a decision): the latest modifiedOn, then the lowest key, then operator. */
function later(a: QualityRecord, b: QualityRecord): boolean {
  if (a.modifiedOn !== b.modifiedOn) {
    return a.modifiedOn > b.modifiedOn;
  }
  return a.recordKey !== b.recordKey ? a.recordKey < b.recordKey : a.operator < b.operator;
}

/** A summary value, or blank when missing (or not a string, e.g. an inherited property). */
function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
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
export function keyRule(key: string, outline: ReadonlyMap<string, Question> | null): KeyRule {
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
  // Bookkeeping and round are never answers, also when the outline does not know them
  // (an outline of another survey, or none): a root key named round, of any type.
  if (BOOKKEEPING_KEYS.has(key) || /^collect_(?:[a-z]+_)+round$/.test(key)) {
    return { compare: false, beyond: false };
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

/** No answer: blank, "null", or only blank parts. */
function isBlankAnswer(text: string): boolean {
  if (text === '') return true;
  if (text.charCodeAt(0) > 32 && text !== 'null' && !text.includes(SUMMARY_VALUES_SEPARATOR)) return false;
  return valuesOf(text).length === 0;
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
  if (!text.includes(SUMMARY_VALUES_SEPARATOR) && !text.includes(QUALIFIER_SEPARATOR)) {
    const v = text.trim();
    return v === 'null' ? '' : v;
  }
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
  if (!a.includes(SUMMARY_VALUES_SEPARATOR) && !b.includes(SUMMARY_VALUES_SEPARATOR)) {
    // One value (or none) on each side: the common case, without splitting.
    if (a.length > 0 && b.length > 0 && a.charCodeAt(0) > 32 && b.charCodeAt(0) > 32 && a !== 'null' && b !== 'null') {
      // Neither is blank (its first character is no space), and Number() trims itself.
      const nx = Number(a);
      const ny = Number(b);
      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        return withinMargin(nx, ny, margin);
      }
    }
    const x = a.trim();
    const y = b.trim();
    const blankX = x === '' || x === 'null';
    const blankY = y === '' || y === 'null';
    if (blankX || blankY) {
      return blankX && blankY;
    }
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      return withinMargin(nx, ny, margin);
    }
    return x === y;
  }
  const va = valuesOf(a);
  const vb = valuesOf(b);
  if (va.length === 1 && vb.length === 1) {
    const x = Number(va[0]);
    const y = Number(vb[0]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return withinMargin(x, y, margin);
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
