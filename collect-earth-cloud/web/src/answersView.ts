// The Quality tab's Answers section (Task 4): what it shows, worked out from the
// server's figures. Pure, so it is tested on its own.
import type { AnswerFlag, AnswersData, ChoiceAnswers, NumberAnswers, NumberSpread } from "./api";
import { formatNumber } from "./format";
import type { Translate } from "./i18n";
import { formatRate } from "./qualityView";

/** One question to choose in the section. */
export interface AnswerQuestion {
  key: string;
  label: string;
  kind: "choice" | "number";
  /** Flags on it (shares far from the rest of the team). */
  flags: number;
}

/** The questions with answers, in the survey's order (choices, then numbers, as the server lists them), with the server's count of flags on each (not only the listed ones). */
export function answerQuestions(data: AnswersData): AnswerQuestion[] {
  return [
    ...data.choices.map((c) => ({ key: c.key, label: c.label, kind: "choice" as const, flags: c.flags })),
    ...data.numbers.map((n) => ({ key: n.key, label: n.label, kind: "number" as const, flags: 0 })),
  ];
}

/** The question shown: the one chosen when it is still there, else the first with a flag, else the first. */
export function shownQuestion(questions: readonly AnswerQuestion[], chosen: string | null): string | null {
  if (chosen !== null && questions.some((q) => q.key === chosen)) return chosen;
  return (questions.find((q) => q.flags > 0) ?? questions[0])?.key ?? null;
}

/** One answer of a choice question: the team's share, and with a person, theirs and the rest of the team's. */
export interface ChoiceRow {
  code: string;
  label: string;
  /** Plots holding it, and its share of the plots answering. */
  count: number;
  share: number;
  /** With a person: theirs and the rest of the team's; share null when that side has no answer to the question. */
  person: { count: number; share: number | null } | null;
  rest: { count: number; share: number | null } | null;
}

const share = (count: number, of: number) => (of > 0 ? count / of : 0);
const shareOrNull = (count: number, of: number) => (of > 0 ? count / of : null);

/**
 * The rows of a choice question. With `person` (a username with a row in it): their
 * shares and the rest of the team's, the same comparison the flags make.
 */
export function choiceRows(choice: ChoiceAnswers, person: string | null): ChoiceRow[] {
  const mine = person === null ? undefined : choice.people.find((p) => p.username === person);
  return choice.codes.map((code, i) => {
    const row: ChoiceRow = { code: code.code, label: code.label, count: code.count, share: share(code.count, choice.answered), person: null, rest: null };
    if (mine) {
      const count = mine.counts[i] ?? 0;
      const restOf = choice.answered - mine.answered;
      row.person = { count, share: shareOrNull(count, mine.answered) };
      row.rest = { count: code.count - count, share: shareOrNull(code.count - count, restOf) };
    }
    return row;
  });
}

/** The rest of the team's row of a choice's table (everyone answering but `person`), or null without a person in it. */
export function restOfTeam(choice: ChoiceAnswers, person: string | null): { answered: number; counts: number[] } | null {
  const mine = person === null ? undefined : choice.people.find((p) => p.username === person);
  if (!mine) return null;
  return { answered: choice.answered - mine.answered, counts: choice.codes.map((c, i) => c.count - (mine.counts[i] ?? 0)) };
}

/** Whether the days of a filter are in order (either may be missing). */
export function datesInOrder(from: string | null, to: string | null): boolean {
  return from === null || to === null || from <= to;
}

/** "About 0.3 of them": how many flags chance alone would give, rounded so it reads (one decimal under 10). */
export function chanceText(t: Translate, chanceFlags: number, language: string): string {
  if (chanceFlags < 0.05) return t("answers.chanceNone");
  const rounded = chanceFlags < 10 ? Math.round(chanceFlags * 10) / 10 : Math.round(chanceFlags);
  let n: string;
  try {
    n = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(rounded);
  } catch {
    n = String(rounded);
  }
  return t("answers.chance", { n });
}

/** "41 %" */
export const percent = (value: number, language: string) => formatRate(value, language);

/** A yes/no question's key: the desktop app's summary prefix for a boolean, at the root or in an entity. */
const BOOLEAN_KEY = /(?:^collect_|\.)boolean_/;

/** An answer's label as shown: Yes / No in the person's language for a yes/no question, else the survey's. */
export function answerLabel(t: Translate, key: string, code: string, label: string): string {
  if (BOOLEAN_KEY.test(key) && (code === "true" || code === "false")) return t(code === "true" ? "common.yes" : "common.no");
  return label || code;
}

/** "Ana: Cropland on 41 % of 64 plots; the rest of the team: 22 %." */
export function flagText(t: Translate, flag: AnswerFlag, language: string): string {
  return t("answers.flag", {
    person: flag.username,
    answer: answerLabel(t, flag.key, flag.code, flag.codeLabel),
    share: percent(flag.share, language),
    plots: formatNumber(flag.plots, language),
    team: percent(flag.others.share, language),
  });
}

/** A number as shown: at most two decimals. */
export function numberText(value: number | null, language: string): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
  } catch {
    return String(Math.round(value * 100) / 100);
  }
}

/** "median 12 (half of the plots between 8 and 20)" or "no numbers". */
export function spreadText(t: Translate, s: NumberSpread, language: string): string {
  if (s.median === null) return t("answers.noNumbers");
  return t("answers.spread", { median: numberText(s.median, language), q1: numberText(s.q1, language), q3: numberText(s.q3, language) });
}

/** The scale of a number question's chart: from the lowest Q1 to the highest Q3 of the team and the people shown (a single value gets some room). */
export function spreadScale(n: NumberAnswers): { min: number; max: number } {
  const all = [n.team, ...n.people].filter((s) => s.q1 !== null && s.q3 !== null);
  if (all.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...all.map((s) => s.q1!));
  let max = Math.max(...all.map((s) => s.q3!));
  if (max === min) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

/** Whether any filter is set. */
export function hasFilter(f: { person: string | null; file: string | null; from: string | null; to: string | null }): boolean {
  return f.person !== null || f.file !== null || f.from !== null || f.to !== null;
}
