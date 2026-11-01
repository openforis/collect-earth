/** The logic of the Project menu's dialogs and of the files dropped on the page. */

export type DroppedKind = "cep" | "plots" | "kml";

/**
 * What a file dropped on the page is for, by its extension, as the Swing window took them (CollectEarthTransferHandler):
 * a project, a plots file, a KML; null for anything else.
 */
export function droppedKind(name: string): DroppedKind | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (extension === "cep") return "cep";
  if (extension === "csv" || extension === "ced") return "plots";
  if (extension === "kml" || extension === "kmz") return "kml";
  return null;
}

/** Whether the text looks like an invitation link (https://server/join/TOKEN), as the server will check it */
export function looksLikeInvitation(url: string): boolean {
  const at = url.trim().indexOf("/join/");
  return at > 0 && url.trim().slice(at + 6).replace(/[/?].*$/, "").length > 0;
}

/** Fills the %s of a Swing text (String.format) in order */
export function formatPercent(text: string, ...args: string[]): string {
  let i = 0;
  return text.replace(/%s/g, () => args[i++] ?? "");
}

/** The label of an HTML anchor text (AboutDialog.5 is written as one), or the text itself */
export function anchorLabel(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

export interface CloudStatus {
  enabled: boolean;
  project: string | null;
  pending?: number;
  failed?: number;
  synced?: number;
  lastSync?: number | null;
  lastError?: string | null;
}

export const CLOUD_STATUS_POLL_MILLIS = 3000;
