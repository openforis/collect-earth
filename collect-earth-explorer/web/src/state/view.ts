import { layerChoices, yearRange, type LayerEntry } from "../lib/config";
import { hashOf, readPref } from "../lib/prefs";
import { initialYear, LAST_12_MONTHS, type Year } from "./PlotContext";

/** The map view remembered between plots (Collect Earth reloads the page for each one). */
export interface View {
  active: number;
  years: Record<number, Year | undefined>;
  bands: Record<number, string>;
  compare: boolean;
  compareLayer: number;
  difference: boolean;
}

/** Where the view is stored: per list of layers, so another configuration does not get it. */
export const viewKey = (layers: LayerEntry[]) => `explorer.view.${hashOf(layers)}`;

/** A remembered year checked against `entry` on a plot ending `end`: clamped into its range, else its initial year. */
function rememberedYear(entry: LayerEntry, end: string, y: unknown): Year | undefined {
  const start = initialYear(entry, end);
  if (start === undefined) return undefined;
  if (y === LAST_12_MONTHS && entry.type === "sentinel2") return y;
  if (typeof y !== "number" || !Number.isFinite(y)) return start;
  const [min, max] = yearRange(entry, end);
  return Math.min(Math.max(Math.round(y), min), max);
}

/** The view stored for `layers`, each part checked; what is missing, outdated or broken falls back to the defaults. */
export function storedView(layers: LayerEntry[], end: string): View {
  let s: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(readPref(viewKey(layers), "{}"));
    if (v && typeof v === "object") s = v as Record<string, unknown>;
  } catch {
    // corrupt: the defaults
  }
  const entry = (l: unknown, fallback: number) => (typeof l === "number" && Number.isInteger(l) && l >= 0 && l < layers.length ? l : fallback);
  const years = (s.years ?? {}) as Record<number, unknown>;
  const bands = (s.bands ?? {}) as Record<number, unknown>;
  const compare = s.compare === true;
  return {
    active: entry(s.active, 0),
    years: Object.fromEntries(layers.map((e, i) => [i, rememberedYear(e, end, years[i])])),
    bands: Object.fromEntries(
      layers.map((e, i) => [i, layerChoices(e.type, "bands").includes(bands[i] as string) ? (bands[i] as string) : (e.params.bands as string)]),
    ),
    compare,
    compareLayer: entry(s.compareLayer, layers.length > 1 ? 1 : 0),
    difference: compare && s.difference === true,
  };
}
