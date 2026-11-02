import type { Assessment, PlotMatch, PlotRecordView, PlotSearchResult } from "./api";
import type { MessageKey } from "./i18n";

/** How long the search box waits after the last key before asking (ms). */
export const SEARCH_DELAY_MS = 250;

/** A search's answer, with what it was asked for. */
export interface SearchAnswer {
  query: string;
  result: PlotSearchResult;
}

/**
 * The matches to offer for what is typed now: an answer for another text (an older search, or
 * one still on its way) offers none, so Enter never opens a plot of an earlier search.
 */
export function shownMatches(answer: SearchAnswer | null, typed: string): PlotSearchResult {
  return answer !== null && answer.query === typed.trim() ? answer.result : { plots: [], more: false };
}

/** What a screen reader is told once a search is answered: how many plots were found (at most the 20 listed). */
export function foundMessage(count: number): { key: MessageKey; n?: number } {
  if (count === 0) return { key: "plotSearch.foundNone" };
  if (count === 1) return { key: "plotSearch.foundOne" };
  return { key: "plotSearch.found", n: count };
}

/** A found plot as the search lists it: its id, and the id the collector sees when that is another. */
export function matchLabel(match: Pick<PlotMatch, "plot" | "name">): string {
  return match.name !== match.plot ? `${match.plot} (${match.name})` : match.plot;
}

const RECORD_KEYS: Record<Assessment, MessageKey> = {
  main: "plot.record.main",
  check: "plot.record.check",
  other: "plot.record.other",
};

/** What a record is: the first assessment, a quality check, or a record of another round. */
export function recordKindKey(assessment: Assessment): MessageKey {
  return RECORD_KEYS[assessment];
}

/** A record's state: submitted, not submitted (a draft), or deleted. */
export function recordStateKey(record: Pick<PlotRecordView, "submitted" | "deleted">): MessageKey {
  return record.deleted ? "plot.deleted" : record.submitted ? "plot.submitted" : "plot.draft";
}

export interface AnswerRow {
  key: string;
  label: string;
  /** Each record's answer, in the records' order (null: deleted, or no such question in it). */
  values: (string | null)[];
  /** The first assessments and checks (not deleted) answer it differently (a blank counts as an answer). */
  differs: boolean;
}

/**
 * The answers as a table: one row per question (those no record answers left out), one value
 * per record. Deleted records show no answers.
 */
export function answerRows(questions: readonly { key: string; label: string }[], records: readonly Pick<PlotRecordView, "deleted" | "answers" | "assessment">[]): AnswerRow[] {
  return questions.flatMap((q) => {
    const values = records.map((r) => (!r.deleted && Object.hasOwn(r.answers, q.key) ? r.answers[q.key] : null));
    const given = values.filter((v): v is string => v !== null);
    if (given.every((v) => v === "")) return [];
    const compared = values.filter((v, i): v is string => v !== null && records[i].assessment !== "other");
    return [{ key: q.key, label: q.label, values, differs: new Set(compared).size > 1 }];
  });
}

/** "Check is right" needs a submitted check that is not deleted. */
export function hasCheck(records: readonly Pick<PlotRecordView, "assessment" | "submitted" | "deleted">[]): boolean {
  return records.some((r) => r.assessment === "check" && r.submitted && !r.deleted);
}
