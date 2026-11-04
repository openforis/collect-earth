import type { TrainingQuestion, TrainingShare } from "./api";
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
