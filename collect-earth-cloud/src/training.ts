import type { RoundInfo } from './cep.js';
import { choiceText, compareAnswers, isBlankAnswer, keyRule, plotOrder, shownText, type KeyRule, type Kind } from './quality.js';
import { unitOfRecord } from './rounds.js';
import type { Question } from './surveyOutline.js';
import type { RecordRow, TrainingAttempt, TrainingGolden } from './types.js';

/**
 * Calibration and learning plots (docs/plans/2026-11-04-calibration-and-learning-plots.md): the
 * figures, pure. Answers are compared as the quality figures compare a check with its first
 * assessment (compareAnswers: the same questions, number margins, blanks on both sides not
 * compared), so "agree" means the same here as on the Quality tab.
 */

/** Most plots in one set. */
export const MAX_TRAINING_PLOTS = 500;
/** Most sets in one project. */
export const MAX_TRAINING_SETS = 50;
/** Longest explanation note of a golden answer. */
export const MAX_GOLDEN_NOTE = 2000;

/** One person's latest submitted record of a plot: its answers and when it was saved. */
export interface Answered {
  operator: string;
  modifiedOn: number;
  summary: Readonly<Record<string, string>>;
}

/**
 * The latest submitted record (actively saved, not deleted) of each person for each plot of a
 * set: plot -> operator -> record. `since(operator)` leaves out records saved before it (an
 * attempt's start).
 */
export function latestAnswers(
  records: readonly RecordRow[],
  plots: readonly string[],
  info: RoundInfo | null,
  since: (operator: string) => number = () => 0,
): Map<string, Map<string, Answered>> {
  const units = new Set(plots);
  const out = new Map<string, Map<string, Answered>>();
  for (const r of records) {
    if (!r.activelySaved || r.deleted || r.modifiedOn < since(r.operator)) continue;
    const plot = unitOfRecord(r.recordKey, units, info);
    if (plot === null) continue;
    let byPerson = out.get(plot);
    if (!byPerson) out.set(plot, (byPerson = new Map()));
    const before = byPerson.get(r.operator);
    if (!before || r.modifiedOn > before.modifiedOn) byPerson.set(r.operator, { operator: r.operator, modifiedOn: r.modifiedOn, summary: r.summary });
  }
  return out;
}

/** Whether two answers to one question agree (compareAnswers on that question alone). */
function agrees(key: string, a: string, b: string, rule: KeyRule, margins: Readonly<Record<string, number>>): boolean {
  let result = true;
  compareAnswers({ [key]: a }, { [key]: b }, () => rule, margins, (_k, _kind, same) => {
    result = same;
  });
  return result;
}

/** The questions compared among some answers, in the outline's order where it knows them. */
function comparedQuestions(
  answers: Iterable<Readonly<Record<string, string>>>,
  outline: ReadonlyMap<string, Question> | null,
): { key: string; kind: Kind; label: string }[] {
  const seen = new Map<string, { key: string; kind: Kind; label: string }>();
  for (const summary of answers) {
    for (const key of Object.keys(summary)) {
      if (seen.has(key)) continue;
      const rule = keyRule(key, outline);
      if (rule.compare) seen.set(key, { key, kind: rule.kind, label: rule.label });
    }
  }
  const position = new Map([...(outline?.keys() ?? [])].map((k, i) => [k, i]));
  return [...seen.values()].sort((a, b) => (position.get(a.key) ?? Infinity) - (position.get(b.key) ?? Infinity) || plotOrder(a.key, b.key));
}

/** Agreement as counts and their share (null with nothing compared). */
export interface Share {
  compared: number;
  agreeing: number;
  rate: number | null;
}

function share(compared: number, agreeing: number): Share {
  return { compared, agreeing, rate: compared > 0 ? agreeing / compared : null };
}

// --- calibration -----------------------------------------------------------------

export interface AnswerCount {
  /** The answer as shown (its values, qualifiers kept). */
  value: string;
  count: number;
  people: string[];
}

export interface CalibrationCell {
  key: string;
  /** Different answers given, most given first. */
  answers: AnswerCount[];
  /** Pairs of people whose answers agree, of all pairs who answered. */
  pairs: Share;
  /** The proposed agreed answer: the most given (choice) or the median (number); null on a tie or with no answer. */
  consensus: string | null;
}

export interface CalibrationPlot {
  plot: string;
  /** People with a submitted record of it. */
  people: string[];
  questions: CalibrationCell[];
}

export interface CalibrationQuestion {
  key: string;
  label: string;
  kind: Kind;
  pairs: Share;
  /** Fleiss' kappa (choice questions with two people or more on a plot); null when it cannot be worked out. */
  kappa: number | null;
}

export interface CalibrationPerson {
  username: string;
  plots: number;
  /** Their answers that agree with the proposed agreed answer. */
  withConsensus: Share;
  byQuestion: Record<string, Share>;
}

export interface CalibrationFigures {
  participants: string[];
  plots: CalibrationPlot[];
  questions: CalibrationQuestion[];
  people: CalibrationPerson[];
  /** All pairs of answers, every question. */
  overall: Share;
}

/** The median of number answers, as written by one of them (the lower middle one for an even count). */
function medianOf(values: readonly string[]): string | null {
  const numbers = values.map((v) => ({ v, n: Number(v) })).filter((x) => x.v.trim() !== '' && Number.isFinite(x.n));
  if (numbers.length === 0) return null;
  numbers.sort((a, b) => a.n - b.n);
  return numbers[Math.floor((numbers.length - 1) / 2)].v.trim();
}

/**
 * Fleiss' kappa for answers to one question over several plots, each answered by any number of
 * people (two or more counted): (P̄ − Pe) / (1 − Pe). Null without such a plot or when every
 * answer is the same (Pe = 1).
 */
export function fleissKappa(plots: readonly (readonly string[])[]): number | null {
  const rated = plots.filter((p) => p.length >= 2);
  if (rated.length === 0) return null;
  const totals = new Map<string, number>();
  let all = 0;
  let pSum = 0;
  for (const answers of rated) {
    const counts = new Map<string, number>();
    for (const a of answers) counts.set(a, (counts.get(a) ?? 0) + 1);
    const n = answers.length;
    let sq = 0;
    for (const [a, c] of counts) {
      sq += c * c;
      totals.set(a, (totals.get(a) ?? 0) + c);
    }
    all += n;
    pSum += (sq - n) / (n * (n - 1));
  }
  const pBar = pSum / rated.length;
  let pe = 0;
  for (const c of totals.values()) pe += (c / all) ** 2;
  if (pe >= 1 - 1e-12) return null;
  return (pBar - pe) / (1 - pe);
}

/** The calibration figures of a set from its participants' latest submitted records. */
export function calibrationFigures(input: {
  plots: readonly string[];
  answers: ReadonlyMap<string, ReadonlyMap<string, Answered>>;
  participants: readonly string[];
  outline: ReadonlyMap<string, Question> | null;
  margins: Readonly<Record<string, number>>;
}): CalibrationFigures {
  const { outline, margins } = input;
  const all = [...input.answers.values()].flatMap((m) => [...m.values()].map((a) => a.summary));
  const questions = comparedQuestions(all, outline);
  const perQuestion = new Map(questions.map((q) => [q.key, { compared: 0, agreeing: 0, kappaPlots: [] as string[][] }]));
  const people = new Map<string, { plots: number; compared: number; agreeing: number; byQuestion: Map<string, { compared: number; agreeing: number }> }>();
  const personOf = (username: string) => {
    let p = people.get(username);
    if (!p) people.set(username, (p = { plots: 0, compared: 0, agreeing: 0, byQuestion: new Map() }));
    return p;
  };
  for (const name of input.participants) personOf(name);
  let overallCompared = 0;
  let overallAgreeing = 0;
  const plots: CalibrationPlot[] = [];
  for (const plot of input.plots) {
    const byPerson = input.answers.get(plot) ?? new Map<string, Answered>();
    const names = [...byPerson.keys()].sort(plotOrder);
    for (const name of names) personOf(name).plots += 1;
    const cells: CalibrationCell[] = [];
    for (const q of questions) {
      const rule = keyRule(q.key, outline) as KeyRule & { compare: true };
      const given = names
        .map((name) => ({ name, value: byPerson.get(name)!.summary[q.key] ?? '' }))
        .filter((g) => typeof g.value === 'string' && !isBlankAnswer(g.value));
      if (given.length === 0) continue;
      // Answers grouped as compared (a choice by its codes); shown with their values.
      const groups = new Map<string, AnswerCount>();
      for (const g of given) {
        const id = q.kind === 'choice' ? choiceText(g.value) : g.value.trim();
        const group = groups.get(id);
        if (group) {
          group.count += 1;
          group.people.push(g.name);
        } else groups.set(id, { value: shownText(g.value), count: 1, people: [g.name] });
      }
      const answers = [...groups.values()].sort((a, b) => b.count - a.count || plotOrder(a.value, b.value));
      let consensus: string | null;
      if (q.kind === 'number') consensus = medianOf(given.map((g) => g.value));
      else consensus = answers.length === 1 || answers[0].count > answers[1].count ? (given.find((g) => answers[0].people.includes(g.name))?.value ?? null) : null;
      let pairCount = 0;
      let pairAgree = 0;
      for (let i = 0; i < given.length; i++) {
        for (let j = i + 1; j < given.length; j++) {
          pairCount += 1;
          if (agrees(q.key, given[i].value, given[j].value, rule, margins)) pairAgree += 1;
        }
      }
      const acc = perQuestion.get(q.key)!;
      acc.compared += pairCount;
      acc.agreeing += pairAgree;
      if (q.kind === 'choice') acc.kappaPlots.push(given.map((g) => choiceText(g.value)));
      overallCompared += pairCount;
      overallAgreeing += pairAgree;
      if (consensus !== null) {
        for (const g of given) {
          const p = personOf(g.name);
          const same = agrees(q.key, g.value, consensus, rule, margins);
          p.compared += 1;
          if (same) p.agreeing += 1;
          const b = p.byQuestion.get(q.key) ?? { compared: 0, agreeing: 0 };
          b.compared += 1;
          if (same) b.agreeing += 1;
          p.byQuestion.set(q.key, b);
        }
      }
      cells.push({ key: q.key, answers, pairs: share(pairCount, pairAgree), consensus });
    }
    plots.push({ plot, people: names, questions: cells });
  }
  return {
    participants: [...input.participants].sort(plotOrder),
    plots,
    questions: questions.map((q) => {
      const acc = perQuestion.get(q.key)!;
      return { key: q.key, label: q.label, kind: q.kind, pairs: share(acc.compared, acc.agreeing), kappa: q.kind === 'choice' ? fleissKappa(acc.kappaPlots) : null };
    }),
    people: [...people]
      .map(([username, p]) => ({
        username,
        plots: p.plots,
        withConsensus: share(p.compared, p.agreeing),
        byQuestion: Object.fromEntries([...p.byQuestion].map(([k, v]) => [k, share(v.compared, v.agreeing)])),
      }))
      .sort((a, b) => plotOrder(a.username, b.username)),
    overall: share(overallCompared, overallAgreeing),
  };
}

/** Calibration figures without anyone's name: for reviewers (no one's agreement by name, as for reference plots). */
export interface AnonymousCalibration {
  participants: number;
  plots: { plot: string; people: number; questions: { key: string; answers: { value: string; count: number }[]; pairs: Share; consensus: string | null }[] }[];
  questions: CalibrationQuestion[];
  overall: Share;
}

export function anonymousCalibration(figures: CalibrationFigures): AnonymousCalibration {
  return {
    participants: figures.participants.length,
    plots: figures.plots.map((p) => ({
      plot: p.plot,
      people: p.people.length,
      questions: p.questions.map((q) => ({ key: q.key, answers: q.answers.map((a) => ({ value: a.value, count: a.count })), pairs: q.pairs, consensus: q.consensus })),
    })),
    questions: figures.questions,
    overall: figures.overall,
  };
}

/**
 * Golden answers from the proposed agreed answers of a calibration: for each plot, every
 * question with one. Plots without any are left out.
 */
export function goldenFromConsensus(figures: CalibrationFigures): { plotKey: string; answers: Record<string, string> }[] {
  return figures.plots
    .map((p) => ({ plotKey: p.plot, answers: Object.fromEntries(p.questions.filter((c) => c.consensus !== null).map((c) => [c.key, c.consensus!])) }))
    .filter((g) => Object.keys(g.answers).length > 0);
}

// --- learning --------------------------------------------------------------------

/** An answer as the interpreter reads it: each code of a choice as "Label (code)" when the survey labels it. */
export function labelled(outline: ReadonlyMap<string, Question> | null, key: string, value: string): string {
  const shown = shownText(value);
  const options = outline?.get(key)?.options;
  if (!options || options.length === 0) return shown;
  return shown
    .split(', ')
    .map((code) => {
      const option = options.find((o) => o.code === code);
      return option && option.label.trim() && option.label !== code ? `${option.label} (${code})` : code;
    })
    .join(', ');
}

/** One question of one plot: the person's answer next to the golden one. */
export interface ScoredAnswer {
  key: string;
  label: string;
  golden: string;
  given: string;
  right: boolean;
}

export interface ScoredPlot {
  plot: string;
  submittedAt: number;
  answers: Share;
  /** Every compared answer right. */
  right: boolean;
  questions: ScoredAnswer[];
}

/** One person's score on a set in one attempt. */
export interface LearningScore {
  /** Plots with a golden interpretation (what is scored). */
  plots: number;
  /** Of those, the ones they submitted in the attempt. */
  submitted: number;
  /** Answers that match the golden ones (accuracy). */
  answers: Share;
  /** Plots with every answer right. */
  plotsRight: number;
  byQuestion: Record<string, Share>;
  /** Every plot submitted and accuracy at least the pass mark; null without a pass mark or before the end. */
  passed: boolean | null;
  byPlot: ScoredPlot[];
}

/** A person's answers on a set's plots compared with the golden ones. */
export function learningScore(input: {
  plots: readonly string[];
  golden: ReadonlyMap<string, TrainingGolden>;
  /** plot -> their latest submitted record in the attempt. */
  answers: ReadonlyMap<string, Answered>;
  outline: ReadonlyMap<string, Question> | null;
  margins: Readonly<Record<string, number>>;
  passMark: number | null;
}): LearningScore {
  const { outline, margins } = input;
  const scored = input.plots.filter((p) => input.golden.has(p));
  let compared = 0;
  let agreeing = 0;
  let plotsRight = 0;
  const byQuestion = new Map<string, { compared: number; agreeing: number }>();
  const byPlot: ScoredPlot[] = [];
  for (const plot of scored) {
    const record = input.answers.get(plot);
    if (!record) continue;
    const golden = input.golden.get(plot)!.answers;
    const questions: ScoredAnswer[] = [];
    // Only the golden interpretation's questions are scored: what it leaves out is not judged.
    const given = Object.fromEntries(Object.keys(golden).map((k) => [k, record.summary[k] ?? '']));
    compareAnswers(golden, given, (key) => keyRule(key, outline), margins, (key, _kind, right) => {
      const rule = keyRule(key, outline);
      questions.push({ key, label: rule.compare ? rule.label : key, golden: labelled(outline, key, golden[key] ?? ''), given: labelled(outline, key, given[key] ?? ''), right });
      const b = byQuestion.get(key) ?? { compared: 0, agreeing: 0 };
      b.compared += 1;
      if (right) b.agreeing += 1;
      byQuestion.set(key, b);
    });
    // In the survey's order, as the interpreter answered them.
    const position = new Map([...(outline?.keys() ?? [])].map((k, i) => [k, i]));
    questions.sort((a, b) => (position.get(a.key) ?? Infinity) - (position.get(b.key) ?? Infinity) || plotOrder(a.key, b.key));
    const plotRight = questions.filter((q) => q.right).length;
    compared += questions.length;
    agreeing += plotRight;
    const allRight = plotRight === questions.length;
    if (allRight) plotsRight += 1;
    byPlot.push({ plot, submittedAt: record.modifiedOn, answers: share(questions.length, plotRight), right: allRight, questions });
  }
  const answers = share(compared, agreeing);
  const done = scored.length > 0 && byPlot.length === scored.length;
  return {
    plots: scored.length,
    submitted: byPlot.length,
    answers,
    plotsRight,
    byQuestion: Object.fromEntries([...byQuestion].map(([k, v]) => [k, share(v.compared, v.agreeing)])),
    passed: input.passMark === null || !done ? null : (answers.rate ?? 0) * 100 >= input.passMark,
    byPlot,
  };
}

/** A person's open attempt (the highest number without results), or attempt 1 when none is stored; attempt 1 starts at 0. */
export function openAttempt(attempts: readonly TrainingAttempt[], userId: string): { number: number; startedAt: number } {
  const mine = attempts.filter((a) => a.userId === userId);
  const open = mine.filter((a) => a.results === null).sort((a, b) => b.number - a.number)[0];
  // Attempt 1 counts every record (a desktop's clock may be behind the server's); later ones from their start.
  if (open) return { number: open.number, startedAt: open.number === 1 ? 0 : open.startedAt };
  const last = mine.sort((a, b) => b.number - a.number)[0];
  return last ? { number: last.number + 1, startedAt: Date.now() } : { number: 1, startedAt: 0 };
}

/** What a closed attempt keeps: its score, answers plot by plot included (the server keeps only a record's latest version). */
export interface AttemptSnapshot {
  score: LearningScore;
  closedAt: number;
}
