// The review queue's pure parts (Task 7): its keys, moving through it, and the Earth Map link.
import type { PlotOutline } from "./api";

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
  /** The key is held down (the browser repeats it). */
  repeat: boolean;
  /** An input method is composing (IME): the key is part of what is typed. */
  composing: boolean;
  /** The key was pressed inside the queue's own page area (not in a dialog shown in a portal). */
  inside: boolean;
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
 * which leaves the field), nor with Ctrl, Cmd or Alt, nor while an input method composes, nor
 * for a key pressed outside the queue (React sends a portal's keys, a dialog's, up its tree). A
 * held key moves on (J/K) but decides only once: 1/2/3 and C are not repeated.
 */
export function queueKeyAction(e: QueueKey): QueueAction | null {
  if (!e.inside || e.composing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTyping(e.target)) return e.key === "Escape" ? "leave" : null;
  if (e.repeat && !["j", "J", "k", "K"].includes(e.key)) return null;
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
/** Half the side of the marker square drawn when only the place is known, in metres. */
const MARKER_HALF_SIDE_M = 50;

/** Degrees per metre north and east at a latitude, on the WGS84 ellipsoid (as Collect Earth's geodetic offsets, locally). */
function degreesPerMetre(lat: number): { north: number; east: number } {
  const a = 6378137;
  const e2 = 0.00669437999014;
  const phi = (lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const m = (a * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5);
  const n = a / Math.sqrt(1 - e2 * s * s);
  return { north: 180 / (Math.PI * m), east: 180 / (Math.PI * n * Math.max(Math.cos(phi), 1e-6)) };
}

/**
 * The plot's outline as [longitude, latitude] points, closed, as Collect Earth draws it
 * (AbstractPolygonKmlGenerator.fillExternalLine): a square of the plot's side from its top-left
 * corner clockwise (SquareKmlGenerator), or the circle's (hexagon's) vertices at the radius, each
 * offset rounded to whole metres (CircleKmlGenerator). Only the place known: a 100 m marker square.
 */
export function outlineRing(lat: number, lon: number, outline: PlotOutline): [number, number][] {
  const per = degreesPerMetre(lat);
  const at = (east: number, north: number): [number, number] => [Number((lon + east * per.east).toFixed(7)), Number((lat + north * per.north).toFixed(7))];
  if (outline.kind === "circle") {
    const ring: [number, number][] = [];
    const arc = 360 / outline.vertices;
    for (let i = 0; i <= outline.vertices; i++) {
      const t = ((i % outline.vertices) * arc * Math.PI) / 180;
      ring.push(at(Math.round(outline.radiusMeters * Math.cos(t)), Math.round(outline.radiusMeters * Math.sin(t))));
    }
    return ring;
  }
  const half = outline.kind === "square" ? outline.sideMeters / 2 : MARKER_HALF_SIDE_M;
  const topLeft = at(-half, half);
  return [topLeft, at(half, half), at(half, -half), at(-half, -half), topLeft];
}

/**
 * Opens a plot in Earth Map as Collect Earth does (BrowserService.earthMapUrl): the plot as a
 * GeoJSON polygon feature named by the id the collector sees, every area of interest
 * ("global"), embedded (no sign-in).
 */
export function earthMapUrl(name: string, lat: number, lon: number, outline: PlotOutline): string {
  const feature = { type: "Feature", properties: { name }, geometry: { type: "Polygon", coordinates: [outlineRing(lat, lon, outline)] } };
  return `${EARTH_MAP}?polygon=${encodeURIComponent(JSON.stringify(feature))}&aoi=global&embed=true`;
}
