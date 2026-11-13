// Pure helpers of the AI assistant's panel, its settings and the server owner's page:
// tool names and failure codes in words, why a run did not start (with the local time a
// limit resets), which plots can be linked, the server's own figures for a finding.

import { ApiError, type AiAnswer, type AiReport, type AiRunAnswer, type AiRunKind, type AiRunListed, type AiRunStatus, type FindingCause, type QuestionAgreement, type Rate } from "./api";
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

/** After this many failed asks in a row, the panel says it has lost contact (and keeps trying). */
export const LOST_CONTACT_AFTER = 3;
/** The longest wait between asks after failures. */
export const RUN_RETRY_MAX_MS = 30_000;

/**
 * What to do after asking for a run's progress failed: the run is gone (404), so stop
 * following it; another refusal (signed out, no right to it...) will not pass by
 * itself, so stop and say why; the server or the connection failing may pass, so try
 * again a little later.
 */
export function runPollFailure(error: unknown): "gone" | "stop" | "retry" {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) return "retry";
  return error.status === 404 ? "gone" : "stop";
}

/** The wait before asking again after `failures` failures in a row: 2, 4, 8, 16, then 30 s at most. */
export function runRetryDelay(failures: number): number {
  return Math.min(RUN_RETRY_MAX_MS, RUN_POLL_MS * 2 ** Math.max(0, failures - 1));
}

/** The runs list with a run's newer state (a run not in it is left out), so a finished run is not followed again before the list comes back. */
export function withRunState(runs: readonly AiRunListed[], run: AiRunListed): AiRunListed[] {
  return runs.map((r) =>
    r.id === run.id ? { ...r, status: run.status, finishedAt: run.finishedAt, tokens: run.tokens, errorCode: run.errorCode } : r,
  );
}

/**
 * The run the panel follows: the one it follows already, else one the list says is
 * running and the panel is not done with (finished here, or given up on).
 */
export function runToFollow(runs: readonly AiRunListed[], activeId: string | null, done: ReadonlySet<string>): string | null {
  if (activeId !== null) return activeId;
  return runs.find((r) => r.status === "running" && !done.has(r.id))?.id ?? null;
}

/** The kind of the run followed: as started here (known at once), else from the list or its details. */
export function followedKind(
  active: { id: string; kind?: AiRunKind } | null,
  runs: readonly AiRunListed[],
  details: ReadonlyMap<string, { kind: AiRunKind }>,
): AiRunKind | null {
  if (!active) return null;
  return active.kind ?? runs.find((r) => r.id === active.id)?.kind ?? details.get(active.id)?.kind ?? null;
}

/** A report run's report, once it is done (null before, or for another kind of run). */
export function reportOf(run: AiRunAnswer | undefined): AiReport | null {
  const result = run?.result;
  return run?.kind === "report" && result && "findings" in result ? result : null;
}

/** A follow-up's or a question's answer, once it is done (null before, or for another kind of run). */
export function answerOf(run: AiRunAnswer | undefined): AiAnswer | null {
  const result = run?.result;
  return (run?.kind === "follow_up" || run?.kind === "question") && result && "text" in result ? result : null;
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
export function followUpsOf(runs: readonly AiRunListed[], reportId: string): { byFinding: Map<number, AiRunListed[]>; questions: AiRunListed[] } {
  const children = runs.filter((r) => r.parentRunId === reportId).reverse();
  const byFinding = new Map<number, AiRunListed[]>();
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
