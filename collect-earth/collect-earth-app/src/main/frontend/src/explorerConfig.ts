import { formatText } from "./settings";

/**
 * The Explorer window's layers and charts (explorer_config): its summary, and the Explorer's editor page, which shows
 * the editor and a preview and posts the document to store to the page that frames it.
 */

/** The key of the setting (EarthProperty.EXPLORER_CONFIG) */
export const EXPLORER_CONFIG = "explorer_config";

const DEFAULT_EXPLORER = "https://explorer.collectearth.org";
const LANGUAGES = ["en", "es", "fr", "pt", "tr"];

/** The origin of the Explorer that opens the plots (gee_app_url), so a self-hosted one is used; else the public one. */
export function explorerOrigin(geeAppUrl: string | null | undefined): string {
  try {
    const url = new URL((geeAppUrl ?? "").trim());
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch { /* blank or not an address */ }
  return DEFAULT_EXPLORER;
}

/** The editor page: the stored document (none when empty), a plot to preview (latitude, longitude) and the language. */
export function configureUrl(origin: string, config: string, point: [number, number] | null | undefined, language: string): string {
  const params: string[] = [];
  if (config.trim()) params.push("config=" + encodeURIComponent(config));
  if (point && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180) {
    params.push("geoJson=" + encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [point[1], point[0]] })));
  }
  const primary = language.toLowerCase().split(/[-_]/)[0];
  params.push("lang=" + (LANGUAGES.includes(primary) ? primary : "en"));
  return origin + "/configure?" + params.join("&");
}

export interface ExplorerMessage { config: string; valid: boolean }

/**
 * The document the editor page posted, or null for any other message: only from the Explorer's origin, from the frame
 * of the editor, and of the agreed shape.
 */
export function explorerMessage(event: Pick<MessageEvent, "origin" | "source" | "data">, origin: string,
  frame: Window | null | undefined): ExplorerMessage | null {
  if (event.origin !== origin || !frame || event.source !== frame) return null;
  const d = event.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || d.source !== "collect-earth-explorer" || d.type !== "config"
    || typeof d.config !== "string" || typeof d.valid !== "boolean") return null;
  return { config: d.config, valid: d.valid };
}

/**
 * One line saying what the window shows: the standard one when empty, else the number of layers and of charts (a half
 * left out, or not a list, is the standard one, as the Explorer reads it), or that it cannot be read.
 */
export function explorerSummary(config: string, s: (key: string) => string): string {
  if (!config.trim()) return s("SettingsPage.explorerConfig.standard");
  let doc: unknown;
  try {
    doc = JSON.parse(config);
  } catch {
    doc = null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return s("SettingsPage.explorerConfig.unreadable");
  const count = (half: unknown) => (Array.isArray(half) ? half.length : s("SettingsPage.explorerConfig.standardPart"));
  const { layers, charts } = doc as Record<string, unknown>;
  return formatText(s("SettingsPage.explorerConfig.custom"), count(layers), count(charts));
}
