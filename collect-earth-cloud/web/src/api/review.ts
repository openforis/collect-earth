// Checking the work: automatic checks, reference plots, the review queue, survey health and plot search.

import type {
  HealthReason,
  ReferenceAnswer,
  ReferenceAnswersReport,
  ReferenceChangeAnswer,
  ReferenceMarkBody,
  SamplingDrawAnswer,
  SamplingRuleInput,
  SamplingView,
  SurveyHealthAnswer,
} from "../../../src/wire/checks";
import type { BulkDecisionAnswer, BulkRule, PlotPageAnswer, PlotSearchAnswer, ReviewQueueAnswer, ReviewQueueItem } from "../../../src/wire/review";
import { FLAG_KINDS } from "./quality";
import { p, request, send, upload } from "./transport";

// --- automatic checks (Task 13) --------------------------------------------------

export type {
  SamplingChecker,
  SamplingCore,
  SamplingDraw,
  SamplingDrawAnswer,
  SamplingFile,
  SamplingFileRule,
  SamplingRule,
  SamplingRuleInput,
  SamplingView,
} from "../../../src/wire/checks";

export function getSampling(projectId: string): Promise<SamplingView> {
  return request("GET", `${p(projectId)}/sampling`);
}

export function saveSampling(projectId: string, rule: SamplingRuleInput): Promise<SamplingView> {
  return request("PUT", `${p(projectId)}/sampling`, { json: rule });
}

/** "Draw now": the draw's counts and the section as it is after it. */
export function drawSamplingNow(projectId: string): Promise<SamplingDrawAnswer> {
  return request("POST", `${p(projectId)}/sampling/draw`);
}

// --- reference plots (Task 14) ----------------------------------------------------

export type {
  ExternalReferenceFigures,
  ReferenceAnswer,
  ReferenceAnswersReport,
  ReferenceChangeAnswer,
  ReferenceChangeResult,
  ReferenceFiguresAnswer,
  ReferenceMarkBody,
  ReferencePerson,
  ReferencePlotRow,
  ReferenceQuestion,
  ReferenceSet,
} from "../../../src/wire/checks";

/** Uploads a reference set (a CSV, or a JSON array for a .json file); it replaces the one the project had. */
export function uploadReferenceAnswers(projectId: string, file: File): Promise<ReferenceAnswersReport> {
  const json = file.name.toLowerCase().endsWith(".json");
  return upload("PUT", `${p(projectId)}/reference/answers`, file, json ? "application/json" : "text/csv");
}

export async function deleteReferenceAnswers(projectId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/reference/answers`);
}

export function getReference(projectId: string): Promise<ReferenceAnswer> {
  return request("GET", `${p(projectId)}/reference`);
}

/** Marks plots of a divided file as reference plots: the ids given, or `random` plots nobody has assessed. */
export function markReference(projectId: string, body: ReferenceMarkBody): Promise<ReferenceChangeAnswer> {
  return request("POST", `${p(projectId)}/reference/plots`, { json: body });
}

/** No longer reference plots: the copies of those who did not check them go. */
export function unmarkReference(projectId: string, plots: { csvFileId: string; plot: string }[] | "all"): Promise<ReferenceChangeAnswer> {
  return request("POST", `${p(projectId)}/reference/remove`, { json: plots === "all" ? { all: true } : { plots } });
}

// --- the review queue (Task 7) ----------------------------------------------------

export type { BulkDecisionAnswer, BulkRule, PlotDecision, QueueSection, Resubmission, ReviewQueueAnswer, ReviewQueueItem } from "../../../src/wire/review";
/** What the queue can be filtered by: a part, or a kind of flag (as the server's QUEUE_KINDS). */
export const QUEUE_KINDS = ["difference", ...FLAG_KINDS, "resubmitted"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

/** One plot of the review queue, with everything known about it. */
export type QueueItem = ReviewQueueItem;
export type ReviewQueueData = ReviewQueueAnswer;

export interface QueueFilter {
  person: string | null;
  kind: QueueKind | null;
}

export const NO_QUEUE_FILTER: QueueFilter = { person: null, kind: null };

/** The review queue (coordinators and reviewers), after the cursor `after` (a page's `next`). A 503 "busy" is thrown as ApiError code "busy". */
export async function getReviewQueue(projectId: string, filter: QueueFilter, after: string | null): Promise<ReviewQueueData> {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.kind) query.set("kind", filter.kind);
  if (after) query.set("after", after);
  const q = query.toString();
  return request<ReviewQueueAnswer>("GET", `${p(projectId)}/quality/queue${q ? `?${q}` : ""}`);
}

/** Bulk decisions (coordinators): `dryRun` only counts the plots the rule would decide. */
export function bulkDecisions(projectId: string, rule: BulkRule, dryRun: boolean): Promise<BulkDecisionAnswer> {
  return request("POST", `${p(projectId)}/quality/decisions:bulk${dryRun ? "?dryRun=1" : ""}`, { json: { rule } });
}

// --- survey health (Task 6) -----------------------------------------------------

export type { HealthCodes, HealthReason, HealthRow, SurveyHealthAnswer } from "../../../src/wire/checks";
export const HEALTH_REASONS: readonly HealthReason[] = ["low_agreement", "often_other", "often_empty", "often_changed"];

/** Survey health (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export function getSurveyHealth(projectId: string): Promise<SurveyHealthAnswer> {
  return request("GET", `${p(projectId)}/quality/survey-health`);
}

// --- plot search (Task 8) ---------------------------------------------------------

export type { Assessment, PlotMatch, PlotPageAnswer, PlotPageFile, PlotPageRecord, PlotSearchAnswer } from "../../../src/wire/review";

/** Plots whose id starts with `query` (coordinators and reviewers); nothing is asked for an empty one. */
export async function searchPlots(projectId: string, query: string): Promise<PlotSearchAnswer> {
  const q = query.trim();
  if (q === "") return { plots: [], more: false };
  return request("GET", `${p(projectId)}/plots/search?${new URLSearchParams({ q }).toString()}`);
}

/** One plot's page (GET /plots/:plot). */
export type PlotPageData = PlotPageAnswer;

/** One plot (coordinators and reviewers); a 404 for a plot in no plot file. */
export async function getPlotPage(projectId: string, plot: string): Promise<PlotPageData> {
  return request<PlotPageAnswer>("GET", `${p(projectId)}/plots/${encodeURIComponent(plot)}`);
}
