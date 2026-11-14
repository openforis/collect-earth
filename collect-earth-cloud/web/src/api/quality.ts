// The Quality tab: the figures, decisions and notes, answers per person, pattern flags, the AI assistant, the
// printable reports.

import type { PlotColumn } from "../../../src/wire/plotFiles";
import type { ProjectAi } from "../../../src/wire/projectSettings";
import type {
  AnswerColumnsAnswer,
  AnswersAnswer,
  DecisionKind,
  FlagKind,
  FlagsAnswer,
  GuidanceNote,
  GuidanceNoteInput,
  PlotPlaces,
  PublicDecision as QualityDecision,
  QualityAnswer,
  QualitySettingsAnswer,
} from "../../../src/wire/quality";
import type { AiRunAnswer, AiRunListed, AiRunsAnswer, AiRunStartBody, AiRunStarted, AiStart, AiUsageAnswer } from "../../../src/wire/ai";
import type { MyQualityAnswer, TeamReportAnswer } from "../../../src/wire/reports";
import { ApiError, p, request, send } from "./transport";

// --- quality ---------------------------------------------------------------------------------

export type {
  AnswerOptions,
  Confusion,
  DataProblem,
  DataProblemKind,
  DecisionKind,
  Difference,
  GuidanceNote,
  GuidanceNoteInput,
  PersonQuality,
  PlotOutline,
  PlotPlace,
  PlotPlaces,
  PublicDecision as QualityDecision,
  QualityAnswer,
  QualitySettingsAnswer,
  QuestionAgreement,
  WeekAgreement,
} from "../../../src/wire/quality";

/** The quality figures. A 503 "busy" (other projects' figures being worked out) is thrown as ApiError code "busy". */
export function getQuality(projectId: string): Promise<QualityAnswer> {
  return request("GET", `${p(projectId)}/quality`);
}

/** The "very fast" threshold of a project that has not set one, and the range it may take (as the server's). */
export const DEFAULT_FAST_SECONDS = 15;
export const MIN_FAST_SECONDS = 1;
export const MAX_FAST_SECONDS = 120;

/** Sets the "very fast" flag's threshold (whole seconds); returns it as saved. The margins stay as they are. */
/** The quality settings alone (the number margins and the "very fast" threshold in force), without the figures. */
export function getQualitySettings(projectId: string): Promise<QualitySettingsAnswer> {
  return request("GET", `${p(projectId)}/quality/settings`);
}

export async function saveFastSeconds(projectId: string, fastSeconds: number): Promise<number> {
  return (await request<QualitySettingsAnswer>("PUT", `${p(projectId)}/quality/settings`, { json: { fastSeconds } })).fastSeconds;
}

/** Replaces the number margins (percent, by margin key); returns them as saved. */
export async function saveQualityMargins(projectId: string, margins: Record<string, number>): Promise<Record<string, number>> {
  return (await request<QualitySettingsAnswer>("PUT", `${p(projectId)}/quality/settings`, { json: { margins } })).margins;
}

const decisionPath = (projectId: string, plot: string) => `${p(projectId)}/quality/decisions/${encodeURIComponent(plot)}`;

export async function setQualityDecision(projectId: string, plot: string, decision: DecisionKind, comment: string): Promise<QualityDecision> {
  const json = comment.trim() ? { decision, comment: comment.trim() } : { decision };
  try {
    return await request<QualityDecision>("PUT", decisionPath(projectId, plot), { json });
  } catch (error) {
    // A plot in no plot file and without records (or one a reviewer may not see) is a 404: say so plainly.
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, NO_SUCH_PLOT, error.reason, error.details);
    throw error;
  }
}

/** The code setQualityDecision gives a 404: the plot is not in this project (any more). */
export const NO_SUCH_PLOT = "no_such_plot";

/** Undoes a decision (a decision already gone counts as undone). */
export async function deleteQualityDecision(projectId: string, plot: string): Promise<void> {
  try {
    await send("DELETE", decisionPath(projectId, plot));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

const notesPath = (projectId: string) => `${p(projectId)}/quality/notes`;

export function createGuidanceNote(projectId: string, note: GuidanceNoteInput): Promise<GuidanceNote> {
  return request("POST", notesPath(projectId), { json: note });
}

export function updateGuidanceNote(projectId: string, id: string, note: GuidanceNoteInput): Promise<GuidanceNote> {
  return request("PUT", `${notesPath(projectId)}/${encodeURIComponent(id)}`, { json: note });
}

/** Deletes a note (one already gone counts as deleted). */
export async function deleteGuidanceNote(projectId: string, id: string): Promise<void> {
  try {
    await send("DELETE", `${notesPath(projectId)}/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

/** Where some plots are (the ones in no plot file are left out). */
export async function getPlotPlaces(projectId: string, plots: string[]): Promise<PlotPlaces> {
  if (plots.length === 0) return { places: [], outline: { kind: "place" } };
  return request("POST", `${p(projectId)}/quality/places`, { json: { plots } });
}

// --- the AI assistant -------------------------------------------------------------------

export type {
  AiAnswer,
  AiFinding,
  AiReport,
  AiRunAnswer,
  AiRunKind,
  AiRunListed,
  AiRunStatus,
  AiStart,
  AiUsageAnswer,
  AiUsageCounts,
  FindingCause,
  FollowUpAction,
} from "../../../src/wire/ai";

/** The assistant in a project: switched on here, and available on the server. */
export type { ProjectAi } from "../../../src/wire/projectSettings";

export function getProjectAi(projectId: string): Promise<ProjectAi> {
  return request("GET", `${p(projectId)}/ai`);
}

/** Switches the assistant on or off for a project (a person's session only: a project key gets 403 user_session_required). */
export function setProjectAi(projectId: string, enabled: boolean): Promise<ProjectAi> {
  return request("PUT", `${p(projectId)}/ai`, { json: { enabled } });
}

/**
 * Starts a run in the dashboard's language; returns its id. Refusals: 409 busy, 429
 * ai_daily_limit / ai_monthly_limit with `resetsAt` (ms, or null for a limit of 0) in details.
 */
export async function startAiRun(projectId: string, start: AiStart, language: string): Promise<string> {
  const json: AiRunStartBody = { ...start, language };
  return (await request<AiRunStarted>("POST", `${p(projectId)}/ai/runs`, { json })).runId;
}

/** The project's runs, newest first, without their results. */
export async function listAiRuns(projectId: string): Promise<AiRunListed[]> {
  return (await request<AiRunsAnswer>("GET", `${p(projectId)}/ai/runs`)).runs;
}

export function getAiRun(projectId: string, runId: string): Promise<AiRunAnswer> {
  return request("GET", `${p(projectId)}/ai/runs/${encodeURIComponent(runId)}`);
}

/** The assistant's use this UTC month, per project id (never names or content). */
export function getAiUsage(): Promise<AiUsageAnswer> {
  return request("GET", "/v1/admin/ai-usage");
}

// --- the printable reports ----------------------------------------------------------------

export type { MyQualityAnswer, ReportConfusion, ReportNote, ReportRate, TeamReportAnswer } from "../../../src/wire/reports";

export function getMyQuality(projectId: string): Promise<MyQualityAnswer> {
  return request("GET", `${p(projectId)}/my-quality`);
}

export function getTeamReport(projectId: string): Promise<TeamReportAnswer> {
  return request("GET", `${p(projectId)}/quality/team-report`);
}

// --- answers per person (the Quality tab's Answers section, Task 4) -------------------

export type { AnswerColumnsAnswer, AnswerFlag, AnswersAnswer, ChoiceStats, CodeCount, NumberStats, Spread } from "../../../src/wire/quality";

/** Which first assessments the answers count; null or "" for no filter. */
export interface AnswersFilter {
  person: string | null;
  file: string | null;
  /** A column of `file` (1 or more) and the value the plots have in it. */
  column: number | null;
  value: string | null;
  /** Days (YYYY-MM-DD) of when the plots were last saved, both included. */
  from: string | null;
  to: string | null;
}

export const NO_ANSWERS_FILTER: AnswersFilter = { person: null, file: null, column: null, value: null, from: null, to: null };

/** The query of a filter: only what is set, a column only with its file and value. */
export function answersQuery(filter: AnswersFilter, timeZone: string): URLSearchParams {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.file) {
    query.set("file", filter.file);
    if (filter.column !== null && filter.value !== null) {
      query.set("column", String(filter.column));
      query.set("value", filter.value);
    }
  }
  if (filter.from) query.set("from", filter.from);
  if (filter.to) query.set("to", filter.to);
  query.set("tz", timeZone);
  return query;
}

/** The first assessments' answers, by person (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export function getAnswers(projectId: string, filter: AnswersFilter, timeZone: string): Promise<AnswersAnswer> {
  return request("GET", `${p(projectId)}/quality/answers?${answersQuery(filter, timeZone)}`);
}

/** A plot file's columns (not the id) and their values, to filter the answers by one. */
export async function getAnswerColumns(projectId: string, fileId: string): Promise<PlotColumn[]> {
  return (await request<AnswerColumnsAnswer>("GET", `${p(projectId)}/quality/answers/columns?${new URLSearchParams({ file: fileId })}`)).columns;
}

// ---------------------------------------------------------------------------
// Pattern flags (Task 5)

export type { Flag as PatternFlag, FlagCounts, FlagDetails, FlagKind, FlagsAnswer } from "../../../src/wire/quality";

export const FLAG_KINDS: readonly FlagKind[] = ["very_fast", "same_as_before", "required_empty", "edited_after_decision", "two_main", "no_plot"];

export interface FlagsFilter {
  person: string | null;
  kind: FlagKind | null;
}

export const NO_FLAGS_FILTER: FlagsFilter = { person: null, kind: null };

/** Plots worth a look (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export function getFlags(projectId: string, filter: FlagsFilter): Promise<FlagsAnswer> {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.kind) query.set("kind", filter.kind);
  const q = query.toString();
  return request("GET", `${p(projectId)}/quality/flags${q ? `?${q}` : ""}`);
}
