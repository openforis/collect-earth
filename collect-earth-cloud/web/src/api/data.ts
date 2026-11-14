// The Data tab and the analysis page: downloads, backups, IPCC exports, the analysis, uncertainty and areas.

import type { BackupFormat, BackupLinkAnswer, BackupRounds, BackupSummary, ExportChoices } from "../../../src/wire/data";
import type { PersonAnswer } from "../../../src/wire/people";
import type {
  AnalysisAnswer,
  ListItem,
  ProposedView,
  ProposedViewsAnswer,
  SharedAnalysisView,
  SharedAnalysisViewInput,
  SharedAnalysisViewsAnswer,
} from "../../../src/wire/analysis";
import { ApiError, p, request, send } from "./transport";

// --- data ------------------------------------------------------------------------------------

/** The formats of the data download: a spreadsheet, or a map file with each plot's shape. */
export const EXPORT_FORMATS = ["csv", "geojson", "kml", "shp.zip"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Which records a data download keeps: all, those changed since your last download or since a time (ms), or those with an answer. */
export type ExportRecords = { kind: "all" } | { kind: "last" } | { kind: "date"; since: number } | { kind: "answer"; question: string; value: string };

export interface ExportOptions {
  /** The person's language: the CSV's separators, and the labels' language. */
  language: string;
  /** A CSV only: without the plot locations. */
  withoutPositions?: boolean;
  /** Also the records of people left out of the results. */
  includeExcluded?: boolean;
  /** Each code answer's label after it. */
  labels?: boolean;
  records?: ExportRecords;
}

/** The collected data as a CSV or map file (fetched with the session, then saved by the page). */
export async function downloadExport(projectId: string, format: ExportFormat, options: ExportOptions): Promise<{ blob: Blob; filename: string }> {
  const query = new URLSearchParams({ lang: options.language });
  if (format === "csv" && options.withoutPositions) query.set("coordinates", "none");
  if (options.includeExcluded) query.set("excluded", "include");
  if (options.labels) query.set("labels", "include");
  const records = options.records;
  if (records?.kind === "last") query.set("since", "last");
  if (records?.kind === "date") query.set("since", new Date(records.since).toISOString());
  if (records?.kind === "answer") {
    query.set("question", records.question);
    query.set("value", records.value);
  }
  const response = await send("GET", `${p(projectId)}/export.${format}?${query}`);
  return { blob: await response.blob(), filename: attachmentName(response, `collect-earth-data.${format}`) };
}

export type { ExportChoices } from "../../../src/wire/data";

export const getExportChoices = (projectId: string) => request<ExportChoices>("GET", `${p(projectId)}/export/choices`);

/** The file name a download was sent with: the UTF-8 name (filename*) before the ASCII fallback the server sends first. */
export function attachmentName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export type { BackupCounts, BackupFormat, BackupLinkAnswer, BackupRounds, BackupSummary } from "../../../src/wire/data";

/** What the Collect Earth backup would hold with each choice. */
export function getBackupSummary(projectId: string): Promise<BackupSummary> {
  return request("GET", `${p(projectId)}/exports/collect-backup/summary`);
}

/**
 * A link to the Collect Earth backup (a zip of the survey and the records, for "Import new data
 * from ZIP", or OpenForis Collect's own backup): used once within a minute, by the browser itself,
 * which saves the file to disk as it comes and shows its progress (the page holds none of it).
 */
export async function getBackupLink(projectId: string, rounds: BackupRounds, format: BackupFormat): Promise<BackupLinkAnswer> {
  const link = await request<BackupLinkAnswer>("POST", `${p(projectId)}/exports/collect-backup/link`, { json: { rounds, format } });
  // The browser is sent to it: only a link of this server's backup is followed.
  if (!link.url.startsWith("/v1/collect-backup/")) throw new ApiError(500, "http_500");
  return link;
}

// --- the analysis page (what replaces Saiku; the server's src/analysis.ts) -----------

export type {
  AnalysisAnswer,
  AnalysisColumn,
  AnalysisModel,
  AnalysisTable,
  AreasSource,
  ColumnType,
  ListItem,
  ProposedFilter,
  ProposedView,
  SharedAnalysisView,
  SharedAnalysisViewInput,
  StandaloneAnalysis,
  TableData,
} from "../../../src/wire/analysis";

/** A code list's item; the name ExportChoices (the data section) still uses. */
export type AnalysisListItem = ListItem;

/** The survey's model and the rows of its tables, for the analysis page (any member). */
export function getAnalysis(projectId: string): Promise<AnalysisAnswer> {
  return request("GET", `${p(projectId)}/analysis`);
}

/** The analysis as one HTML file that opens with no server (fetched with the session, then saved by the page). */
export async function downloadAnalysisStandalone(projectId: string, withoutPositions = false): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/analysis/standalone${withoutPositions ? "?coordinates=none" : ""}`);
  return { blob: await response.blob(), filename: attachmentName(response, "analysis.html") };
}

export async function getSharedAnalysisViews(projectId: string): Promise<SharedAnalysisView[]> {
  return (await request<SharedAnalysisViewsAnswer>("GET", `${p(projectId)}/analysis/views`)).views;
}

/** Shares a view with the team (coordinators), replacing one of the same name and table; gives them all. */
export async function shareAnalysisView(projectId: string, view: SharedAnalysisViewInput): Promise<SharedAnalysisView[]> {
  return (await request<SharedAnalysisViewsAnswer>("PUT", `${p(projectId)}/analysis/views`, { json: view })).views;
}

/**
 * Views proposed by the AI assistant for a table of the analysis (coordinators of a project with the assistant on):
 * the server sends the model the survey's structure only, never the data. Counted against the project's AI limits.
 */
export async function proposeAnalysisViews(projectId: string, table: string, language: string): Promise<ProposedView[]> {
  return (await request<ProposedViewsAnswer>("POST", `${p(projectId)}/analysis/proposals`, { json: { table, language } })).views;
}

export async function deleteSharedAnalysisView(projectId: string, name: string, table: string): Promise<SharedAnalysisView[]> {
  return (await request<SharedAnalysisViewsAnswer>("DELETE", `${p(projectId)}/analysis/views?${new URLSearchParams({ name, table })}`)).views;
}

/** The signed-in person's own page ("My work", any member). */
export function getMyWork(projectId: string, timeZone: string): Promise<PersonAnswer> {
  return request("GET", `${p(projectId)}/my-work?${new URLSearchParams({ tz: timeZone })}`);
}
