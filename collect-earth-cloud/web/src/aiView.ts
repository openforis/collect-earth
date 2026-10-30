// Pure helpers of the AI assistant's panel, its settings and the server owner's page:
// tool names and failure codes in words, why a run did not start (with the local time a
// limit resets), which plots can be linked, the server's own figures for a finding.

import { ApiError, type AiRunStatus, type AiRunSummary, type FindingCause, type QuestionAgreement, type Rate } from "./api";
import { formatDate } from "./format";
import type { MessageKey, Translate } from "./i18n";

/** The longest free question (characters), as the server allows. */
export const MAX_QUESTION_CHARS = 300;
/** How often a running run is asked for its progress (only while the page is visible). */
export const RUN_POLL_MS = 2000;
/** The most each AI limit may be set to (the server's AI_LIMITS). */
export const AI_LIMIT_MAX = { aiReportsPerDay: 1000, aiFollowUpsPerDay: 10_000, aiMonthlyTokens: 10_000_000_000 } as const;

const TOOL_WORDS: Record<string, MessageKey> = {
  get_survey_outline: "ai.tool.outline",
  get_agreement: "ai.tool.agreement",
  get_confusions: "ai.tool.confusions",
  get_people: "ai.tool.people",
  get_differences: "ai.tool.differences",
  get_plot: "ai.tool.plot",
  get_guidance_notes: "ai.tool.notes",
};

/** What a tool does, in words ("Reading the survey…"). */
export function toolMessageKey(name: string): MessageKey {
  return TOOL_WORDS[name] ?? "ai.tool.other";
}

/** The progress of a running run: what its last tool does, or that it is starting. */
export function progressMessageKey(tools: readonly string[]): MessageKey {
  return tools.length === 0 ? "ai.progress.starting" : toolMessageKey(tools[tools.length - 1]);
}

const FAILURE_WORDS: Record<string, MessageKey> = {
  blocked: "ai.failure.blocked",
  invalid_answer: "ai.failure.invalid_answer",
  ai_unavailable: "ai.failure.ai_unavailable",
  ai_timeout: "ai.failure.ai_timeout",
  token_budget: "ai.failure.token_budget",
  server_error: "ai.failure.server_error",
  no_finding: "ai.failure.no_finding",
  bad_action: "ai.failure.bad_action",
  bad_question: "ai.failure.bad_question",
  interrupted: "ai.failure.interrupted",
  off_topic: "ai.failure.off_topic",
};

/** Why a run failed or was refused, from its code (never the server's English text). */
export function failureMessageKey(code: string | null): MessageKey {
  return (code !== null && FAILURE_WORDS[code]) || "ai.failure.unknown";
}

const CAUSE_WORDS: Record<FindingCause, MessageKey> = {
  unclear_question: "ai.cause.unclear_question",
  overlapping_options: "ai.cause.overlapping_options",
  person_habit: "ai.cause.person_habit",
  number_typing: "ai.cause.number_typing",
  other: "ai.cause.other",
};

export function causeMessageKey(cause: FindingCause): MessageKey {
  return CAUSE_WORDS[cause] ?? "ai.cause.other";
}

/**
 * Why a run did not start, for the refusals the panel words itself: busy, and the daily
 * and monthly limits with the local time they reset (or "not allowed on this server" for
 * a limit of 0, whose resetsAt is null). Null for anything else (the error box says it).
 */
export function startErrorText(t: Translate, error: unknown, language: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409 && error.code === "busy") return t("ai.busy");
  if (error.code !== "ai_daily_limit" && error.code !== "ai_monthly_limit") return null;
  const resetsAt = typeof error.details.resetsAt === "number" ? error.details.resetsAt : null;
  const time = resetsAt === null ? "" : formatDate(resetsAt, language);
  if (error.code === "ai_monthly_limit") return resetsAt === null ? t("ai.limit.monthNone") : t("ai.limit.month", { time });
  if (error.details.limit === "follow_ups") return resetsAt === null ? t("ai.limit.followUpsNone") : t("ai.limit.followUps", { time });
  return resetsAt === null ? t("ai.limit.reportsNone") : t("ai.limit.reports", { time });
}

/** A run is asked for its progress while it runs, and only while the page is visible. */
export function shouldPollRun(status: AiRunStatus, hidden: boolean): boolean {
  return status === "running" && !hidden;
}

/** The plots of a finding or an answer: a link only for a plot in the differences list. */
export function plotLinks(plots: readonly string[], existing: ReadonlySet<string>): { plot: string; linked: boolean }[] {
  return plots.map((plot) => ({ plot, linked: existing.has(plot) }));
}

/** The server's own figures for a finding's questions (null for a question the figures do not list). */
export function findingFigures(keys: readonly string[], questions: readonly QuestionAgreement[]): { key: string; label: string; rate: Rate | null }[] {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  return keys.map((key) => {
    const q = byKey.get(key);
    return q ? { key, label: q.label, rate: { compared: q.compared, agreeing: q.agreeing, rate: q.rate } } : { key, label: key, rate: null };
  });
}

/** The free question's counter: characters (as the server counts), over 300, or empty. */
export function questionCounter(question: string): { count: number; over: boolean; empty: boolean } {
  const count = [...question].length;
  return { count, over: count > MAX_QUESTION_CHARS, empty: question.trim() === "" };
}

/** A report's follow-ups by finding (oldest first) and its free questions (oldest first). */
export function followUpsOf(runs: readonly AiRunSummary[], reportId: string): { byFinding: Map<number, AiRunSummary[]>; questions: AiRunSummary[] } {
  const children = runs.filter((r) => r.parentRunId === reportId).reverse();
  const byFinding = new Map<number, AiRunSummary[]>();
  for (const run of children) {
    if (run.kind !== "follow_up" || run.findingIndex === null) continue;
    byFinding.set(run.findingIndex, [...(byFinding.get(run.findingIndex) ?? []), run]);
  }
  return { byFinding, questions: children.filter((r) => r.kind === "question") };
}

/** A limit typed by the server owner: a whole number from 0 to max (spaces and thousands commas allowed), or null. */
export function parseLimit(text: string, max: number): number | null {
  const digits = text.replace(/[\s,'  ]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}
