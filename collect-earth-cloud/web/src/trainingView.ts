import type { LearningScore, TrainingQuestion, TrainingShare } from "./api";
import { percentText } from "./progressView";

/** A share as a percent, "–" when nothing was compared. */
export function shareText(share: TrainingShare, language: string): string {
  return percentText(share.agreeing, share.compared, language);
}

/** Fleiss' kappa with two decimals, "–" when it cannot be worked out. */
export function kappaText(kappa: number | null, language: string): string {
  if (kappa === null || !Number.isFinite(kappa)) return "–";
  return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kappa);
}

/**
 * An answer as people read it: each code of a choice by its label ("Forest"), the code kept when
 * the survey gives none; numbers and unknown questions as they are.
 */
export function answerLabel(questions: readonly TrainingQuestion[], key: string, value: string): string {
  const q = questions.find((x) => x.key === key);
  if (!q || q.kind !== "choice" || !q.options || q.options.length === 0) return value;
  return value
    .split(/,\s*/)
    .map((code) => {
      const option = q.options!.find((o) => o.code === code.trim());
      return option && option.label.trim() ? option.label : code;
    })
    .join(", ");
}

/** A question's label, or its key when the survey has no label for it. */
export function questionLabel(questions: readonly { key: string; label: string }[], key: string): string {
  return questions.find((q) => q.key === key)?.label || key;
}

/**
 * The questions a golden answer is asked for on a plot: the survey's (choice and number), and any
 * other key the golden answer already holds (e.g. copied from a record), in that order.
 */
export function goldenKeys(questions: readonly TrainingQuestion[], answers: Readonly<Record<string, string>>): string[] {
  const keys = questions.map((q) => q.key);
  for (const key of Object.keys(answers)) if (!keys.includes(key)) keys.push(key);
  return keys;
}

/** The pass mark typed: a whole number 0-100, null when empty, undefined when it is no such number. */
export function readPassMark(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 100 ? n : undefined;
}

/** Everyone's answers to one question (or on one plot) against the golden ones. */
export interface Accuracy extends TrainingShare {
  key: string;
  /** For a plot: people who submitted it, and those with every answer right. */
  people?: number;
  allRight?: number;
}

const byRate = (a: Accuracy, b: Accuracy) => (a.rate ?? Infinity) - (b.rate ?? Infinity) || a.key.localeCompare(b.key, undefined, { numeric: true });

/** Each question's accuracy over every participant's open attempt, weakest first. */
export function questionAccuracy(scores: readonly { score: LearningScore }[]): Accuracy[] {
  const sums = new Map<string, { compared: number; agreeing: number }>();
  for (const { score } of scores) {
    for (const [key, share] of Object.entries(score.byQuestion)) {
      const s = sums.get(key) ?? { compared: 0, agreeing: 0 };
      s.compared += share.compared;
      s.agreeing += share.agreeing;
      sums.set(key, s);
    }
  }
  return [...sums].map(([key, s]) => ({ key, ...s, rate: s.compared > 0 ? s.agreeing / s.compared : null })).sort(byRate);
}

/** Each plot's accuracy over the participants who submitted it, hardest first. */
export function plotAccuracy(scores: readonly { score: LearningScore }[]): Accuracy[] {
  const sums = new Map<string, { compared: number; agreeing: number; people: number; allRight: number }>();
  for (const { score } of scores) {
    for (const p of score.byPlot) {
      const s = sums.get(p.plot) ?? { compared: 0, agreeing: 0, people: 0, allRight: 0 };
      s.compared += p.answers.compared;
      s.agreeing += p.answers.agreeing;
      s.people += 1;
      if (p.right) s.allRight += 1;
      sums.set(p.plot, s);
    }
  }
  return [...sums].map(([key, s]) => ({ key, ...s, rate: s.compared > 0 ? s.agreeing / s.compared : null })).sort(byRate);
}
