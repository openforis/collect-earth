// The Activity tab: the log, the weekly summary, the downloads, and the bell (what needs attention).

import type { BellAnswer } from "../../../src/wire/progress";
import type { ActivityPage, ExportAnswer, ExportKind, WeeklyAnswer } from "../../../src/wire/activity";
import { p, request } from "./transport";

// --- activity: the log, the weekly summary, the downloads and the bell (coordinators) ----

export type {
  ActivityPage,
  DailyRow,
  DecisionRow,
  DifferenceRow,
  ExportAnswer,
  ExportFigures,
  ExportKind,
  LogItem,
  RecordChange,
  WeeklyAnswer,
  WeeklyPerson,
  WeeklySummary,
} from "../../../src/wire/activity";

/** What the log can be filtered by (the server's LOG_KINDS). */
export const LOG_KINDS = ["all", "records", "submitted", "resubmitted", "draft", "unsubmitted", "deleted", "coordinators", "decisions", "people", "files", "settings", "downloads"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface ActivityQuery {
  person?: string | null;
  kind?: LogKind;
  /** ms since 1970: from (included) and to (not included). */
  from?: number | null;
  to?: number | null;
  cursor?: string | null;
  limit?: number;
}

/** One page of the activity log (coordinators). */
export function getActivity(projectId: string, q: ActivityQuery = {}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (q.person) query.set("person", q.person);
  if (q.kind && q.kind !== "all") query.set("kind", q.kind);
  if (q.from != null) query.set("from", String(Math.round(q.from)));
  if (q.to != null) query.set("to", String(Math.round(q.to)));
  if (q.cursor) query.set("cursor", q.cursor);
  if (q.limit) query.set("limit", String(q.limit));
  const qs = query.toString();
  return request("GET", `${p(projectId)}/activity${qs ? `?${qs}` : ""}`);
}

/** One ISO week's summary (null: the viewer's current week), its days in the browser's time zone. */
export function getWeekly(projectId: string, week: string | null, timeZone: string): Promise<WeeklyAnswer> {
  const query = new URLSearchParams({ tz: timeZone });
  if (week) query.set("week", week);
  return request("GET", `${p(projectId)}/weekly?${query}`);
}

/** The rows of a download (the server notes who downloaded what). */
export function getExport<K extends ExportKind>(projectId: string, kind: K, timeZone: string): Promise<Extract<ExportAnswer, { kind: K }>> {
  const query = new URLSearchParams({ tz: timeZone });
  return request("GET", `${p(projectId)}/exports/${kind}?${query}`);
}

/** The bell's "needs attention" items, with what this coordinator has read. */
export function getAttention(projectId: string): Promise<BellAnswer> {
  return request("GET", `${p(projectId)}/attention`);
}

/** Marks items read (by key), or all of them. */
export function markAttentionRead(projectId: string, keys: string[] | "all"): Promise<BellAnswer> {
  return request("POST", `${p(projectId)}/attention/read`, { json: keys === "all" ? { all: true } : { keys } });
}
