// The Progress tab, its settings, and progress links for funders.

import type { ProgressAnswer, ProgressSettings, PublicProgress } from "../../../src/wire/progress";
import type { NewShareLinkAnswer, ShareLink, ShareLinksAnswer } from "../../../src/wire/projectSettings";
import { p, request, send } from "./transport";

// --- progress (the Progress tab) -----------------------------------------------------

// The types are the server's own (src/wire/progress.ts): the answers are used as they come.
export type {
  AttentionItem,
  AttentionKind,
  AttentionPerson,
  BellAnswer,
  Forecast,
  ProgressAnswer,
  ProgressDay,
  ProgressSettings,
  ProgressTotals,
  PublicProgress,
} from "../../../src/wire/progress";

/** The Progress tab's figures, with the days in the browser's time zone. */
export function getProgress(projectId: string, timeZone: string, days = 90): Promise<ProgressAnswer> {
  const query = new URLSearchParams({ days: String(days), tz: timeZone });
  return request("GET", `${p(projectId)}/progress?${query}`);
}

export function getProgressSettings(projectId: string): Promise<ProgressSettings> {
  return request("GET", `${p(projectId)}/progress/settings`);
}

export function saveProgressSettings(projectId: string, settings: ProgressSettings): Promise<ProgressSettings> {
  return request("PUT", `${p(projectId)}/progress/settings`, { json: settings });
}

// --- progress links for funders (Task 18) -------------------------------------------

export type { NewShareLinkAnswer, ShareLink } from "../../../src/wire/projectSettings";

export async function listShareLinks(projectId: string): Promise<ShareLink[]> {
  return (await request<ShareLinksAnswer>("GET", `${p(projectId)}/share-links`)).links;
}

/** A new link; its token and address are shown this once. */
export function createShareLink(projectId: string, label: string): Promise<NewShareLinkAnswer> {
  return request("POST", `${p(projectId)}/share-links`, { json: { label } });
}

export async function revokeShareLink(projectId: string, linkId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/share-links/${encodeURIComponent(linkId)}`);
}

/** A progress link's figures, asked without the session (the page is public; nobody needs to be logged in). */
export function getPublicProgress(token: string, timeZone: string): Promise<PublicProgress> {
  const query = new URLSearchParams({ tz: timeZone });
  return request("GET", `/v1/public/progress/${encodeURIComponent(token)}?${query}`, { anonymous: true, noSessionEnd: true });
}
