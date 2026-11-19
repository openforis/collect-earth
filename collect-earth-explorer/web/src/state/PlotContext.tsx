import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlotParams } from "../lib/urlParams";
import { yearRange, type ChartEntry, type LayerEntry, type resolveConfig } from "../lib/config";
import { writePref } from "../lib/prefs";
import type { Status } from "../hooks/useApi";
import type { Summary } from "../lib/seriesStats";
import { storedView, viewKey, type View } from "./view";

/** The position of an entry in `layers`, or the implicit scene layer. */
export type LayerId = number | "scene";
/** A Sentinel-2 entry's year when it shows the last 12 months (the API's default composite) rather than a calendar year. */
export const LAST_12_MONTHS = "last-12-months";
export type Year = number | typeof LAST_12_MONTHS;

export interface Scene {
  sensor: "landsat" | "sentinel2";
  timeStart: number;
  label: string;
}

export interface PlotState extends PlotParams {
  layers: LayerEntry[];
  charts: ChartEntry[];
  notices: string[];
  activeLayer: LayerId;
  setActiveLayer: (l: LayerId) => void;
  /** The year of Landsat or Sentinel-2 entry `i`; undefined for a Sentinel-2 entry with a fixed window. */
  yearOf: (i: number) => Year | undefined;
  setYear: (i: number, y: Year) => void;
  /** Sets the year of entry `i` and makes it the active layer in one update. */
  selectYear: (i: number, y: Year) => void;
  /** The band combination of entry `i`. */
  bandsOf: (i: number) => string;
  setBands: (i: number, b: string) => void;
  scene?: Scene;
  setScene: (s: Scene) => void;
  compare: boolean;
  setCompare: (c: boolean) => void;
  compareLayer: LayerId;
  setCompareLayer: (l: LayerId) => void;
  /** The year the right-hand side shows instead of its row's year; set by `compareAround`, cleared by the Compare controls. */
  compareYear?: number;
  /** Whether a `type` entry with a year slider exists for `compareAround`. */
  canCompareAround: (type: LayerEntry["type"]) => boolean;
  /** Compares that entry's composite of the year before `year` (left) with the year after it (right). */
  compareAround: (type: LayerEntry["type"], year: number) => void;
  /** The scene the right-hand side shows instead of the selected one; set by `compareScenes`, cleared like `compareYear`. */
  compareScene?: Scene;
  /** Compares two scenes: `before` becomes the selected scene (left), `after` the right-hand one. */
  compareScenes: (before: Scene, after: Scene) => void;
  /** While comparing: one map of the NDVI change from the left side to the right instead of the swipe. */
  difference: boolean;
  setDifference: (d: boolean) => void;
  /** What each open Landsat/Sentinel-2 series card publishes for the summary above the charts, by chart position. */
  summaries: Record<number, SeriesSummary | undefined>;
  setSummary: (i: number, s: SeriesSummary | undefined) => void;
}

export interface SeriesSummary {
  status: Status;
  /** Set once the series is loaded. */
  result?: Summary;
}

const Ctx = createContext<PlotState | null>(null);

/**
 * Its `year`, else (Landsat) the last of its `years`, else the year before the plot's end, clamped into `years`;
 * a Sentinel-2 entry without `year` starts at the last 12 months, one with a fixed window has none.
 */
export function initialYear(entry: LayerEntry, end: string): Year | undefined {
  if (entry.type === "sentinel2" && entry.params.start !== undefined) return undefined;
  if (entry.type === "sentinel2" && entry.params.year === undefined) return LAST_12_MONTHS;
  const [min, max] = yearRange(entry, end);
  const y = (entry.params.year as number | undefined) ?? (entry.params.years as [number, number] | undefined)?.[1] ?? new Date(end).getUTCFullYear() - 1;
  return Math.min(Math.max(y, min), max);
}

export function PlotProvider({
  params,
  config,
  children,
}: {
  params: PlotParams;
  config: ReturnType<typeof resolveConfig>;
  children: ReactNode;
}) {
  const [view] = useState(() => storedView(config.layers, params.end));
  const [activeLayer, setActiveLayer] = useState<LayerId>(view.active);
  const [years, setYears] = useState(view.years);
  const [bands, setBandsState] = useState(view.bands);
  const [scene, setSceneState] = useState<Scene>();
  const [compare, setCompareState] = useState(view.compare);
  const [compareLayer, setCompareLayerState] = useState<LayerId>(view.compareLayer);
  const [compareYear, setCompareYear] = useState<number>();
  const [compareScene, setCompareScene] = useState<Scene>();
  const [difference, setDifference] = useState(view.difference);
  const [summaries, setSummaries] = useState<Record<number, SeriesSummary | undefined>>({});
  const setSummary = useCallback((i: number, s: SeriesSummary | undefined) => setSummaries((all) => ({ ...all, [i]: s })), []);
  // Remembers the view for the next plot; a scene is this plot's own, so the last entry layer is stored instead.
  const lastEntry = useRef({ active: view.active, compareLayer: view.compareLayer });
  useEffect(() => {
    if (activeLayer !== "scene") lastEntry.current.active = activeLayer;
    if (compareLayer !== "scene") lastEntry.current.compareLayer = compareLayer;
    const stored: View = { ...lastEntry.current, years, bands, compare, difference };
    writePref(viewKey(config.layers), JSON.stringify(stored));
  }, [config.layers, activeLayer, years, bands, compare, compareLayer, difference]);
  // Choosing what to compare by hand drops the right-hand override.
  const setCompare = useCallback((c: boolean) => {
    setCompareState(c);
    setCompareYear(undefined);
    setCompareScene(undefined);
    if (!c) setDifference(false);
  }, []);
  const setCompareLayer = useCallback((l: LayerId) => {
    setCompareLayerState(l);
    setCompareYear(undefined);
    setCompareScene(undefined);
  }, []);
  const compareScenes = useCallback((before: Scene, after: Scene) => {
    setSceneState(before);
    setActiveLayer("scene");
    setCompareLayerState("scene");
    setCompareYear(undefined);
    setCompareScene(after);
    setCompareState(true);
  }, []);
  // The first entry of the type whose year can change (not a Sentinel-2 one with a fixed window).
  const yearEntry = useCallback(
    (type: LayerEntry["type"]) => config.layers.findIndex((e) => e.type === type && e.params.start === undefined),
    [config.layers],
  );
  const canCompareAround = useCallback((type: LayerEntry["type"]) => yearEntry(type) >= 0, [yearEntry]);
  const compareAround = useCallback(
    (type: LayerEntry["type"], year: number) => {
      const i = yearEntry(type);
      if (i < 0) return;
      const [min, max] = yearRange(config.layers[i], params.end);
      const clamp = (y: number) => Math.min(Math.max(y, min), max);
      setYears((ys) => ({ ...ys, [i]: clamp(year - 1) }));
      setActiveLayer(i);
      setCompareLayerState(i);
      setCompareYear(clamp(year + 1));
      setCompareScene(undefined);
      setCompareState(true);
    },
    [yearEntry, config.layers, params.end],
  );
  // React batches the two state updates below into a single render.
  const setScene = useCallback((s: Scene) => {
    setSceneState(s);
    setActiveLayer("scene");
  }, []);
  const yearOf = useCallback((i: number) => years[i], [years]);
  const setYear = useCallback((i: number, y: Year) => setYears((ys) => ({ ...ys, [i]: y })), []);
  const bandsOf = useCallback((i: number) => bands[i], [bands]);
  const setBands = useCallback((i: number, b: string) => setBandsState((bs) => ({ ...bs, [i]: b })), []);
  const selectYear = useCallback(
    (i: number, y: Year) => {
      setYear(i, y);
      setActiveLayer(i);
    },
    [setYear],
  );
  const value = useMemo<PlotState>(
    () => ({
      ...params,
      ...config,
      activeLayer,
      setActiveLayer,
      yearOf,
      setYear,
      selectYear,
      bandsOf,
      setBands,
      scene,
      setScene,
      compare,
      setCompare,
      compareLayer,
      setCompareLayer,
      compareYear,
      canCompareAround,
      compareAround,
      compareScene,
      compareScenes,
      difference,
      setDifference,
      summaries,
      setSummary,
    }),
    [params, config, activeLayer, yearOf, setYear, selectYear, bandsOf, setBands, scene, setScene, compare, setCompare, compareLayer, setCompareLayer, compareYear, canCompareAround, compareAround, compareScene, compareScenes, difference, summaries, setSummary],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlot(): PlotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlot outside PlotProvider");
  return v;
}
