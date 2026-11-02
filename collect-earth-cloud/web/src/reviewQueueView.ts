// The review queue's pure parts (Task 7): its keys, moving through it, and the Earth Map link.

/** What a key does in the review queue. */
export type QueueAction = "first" | "check" | "recheck" | "next" | "previous" | "comment" | "leave";

/** The element a key was pressed on, as far as the queue needs it. */
export interface KeyTarget {
  tagName: string;
  type?: string;
  isContentEditable: boolean;
  getAttribute(name: string): string | null;
}

export interface QueueKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: KeyTarget | null;
}

/** Inputs whose keys are not text: the queue's keys work on them. */
const NOT_TEXT = new Set(["button", "checkbox", "radio", "submit", "reset", "image", "range", "color", "file"]);
/** Roles of widgets that take typed keys (an MUI select is a combobox, its menu a listbox of options). */
const TYPING_ROLES = new Set(["textbox", "combobox", "listbox", "option", "searchbox", "spinbutton", "menu", "menuitem"]);

/** Whether keys pressed on this element are typing (in a field, a select, an editable area). */
export function isTyping(target: KeyTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXT.has((target.type ?? "text").toLowerCase());
  const role = target.getAttribute("role");
  return role !== null && TYPING_ROLES.has(role);
}

/**
 * What a key press does in the queue: 1 First is right, 2 Check is right, 3 Both need
 * another look, J next, K previous, C the comment. Never while typing (then only Escape,
 * which leaves the field), nor with Ctrl, Cmd or Alt.
 */
export function queueKeyAction(e: QueueKey): QueueAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTyping(e.target)) return e.key === "Escape" ? "leave" : null;
  switch (e.key) {
    case "1":
      return "first";
    case "2":
      return "check";
    case "3":
      return "recheck";
    case "j":
    case "J":
      return "next";
    case "k":
    case "K":
      return "previous";
    case "c":
    case "C":
      return "comment";
    default:
      return null;
  }
}

/** One step through a list, staying within it. */
export function stepIndex(index: number, length: number, step: 1 | -1): number {
  if (length === 0) return 0;
  return Math.min(length - 1, Math.max(0, index + step));
}

/** After a decision: the next plot without a decision made here, else the next one, else the same. */
export function nextUndecided(plots: readonly string[], decided: ReadonlySet<string>, from: number): number {
  for (let i = from + 1; i < plots.length; i++) if (!decided.has(plots[i])) return i;
  return stepIndex(from, plots.length, 1);
}

/** Earth Map's address, as in Collect Earth's settings (earth_map_url). */
export const EARTH_MAP = "https://earthmap.org";
/** Half the side of the square drawn around a plot's centre, in metres (the server knows only the centre). */
const HALF_SIDE_M = 50;

/**
 * Opens a plot in Earth Map as Collect Earth does (BrowserService.earthMapUrl): the plot as a
 * GeoJSON polygon feature named by its id, every area of interest ("global"), embedded (no
 * sign-in). Collect Earth draws the plot's own shape; here only its centre is known, so a
 * square of 100 m around it marks the place.
 */
export function earthMapUrl(plot: string, lat: number, lon: number): string {
  const dLat = HALF_SIDE_M / 111_320;
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const at = (x: number) => Number(x.toFixed(6));
  const ring = [
    [at(lon - dLon), at(lat - dLat)],
    [at(lon + dLon), at(lat - dLat)],
    [at(lon + dLon), at(lat + dLat)],
    [at(lon - dLon), at(lat + dLat)],
    [at(lon - dLon), at(lat - dLat)],
  ];
  const feature = { type: "Feature", properties: { name: plot }, geometry: { type: "Polygon", coordinates: [ring] } };
  return `${EARTH_MAP}?polygon=${encodeURIComponent(JSON.stringify(feature))}&aoi=global&embed=true`;
}
