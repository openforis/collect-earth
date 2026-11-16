import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PlotParams } from "../lib/urlParams";
import { yearRange, type ChartEntry, type LayerEntry, type resolveConfig } from "../lib/config";

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
}

const Ctx = createContext<PlotState | null>(null);

/**
 * Its `year`, else (Landsat) the last of its `years`, else the year before the plot's end, clamped into `years`;
 * a Sentinel-2 entry without `year` starts at the last 12 months, one with a fixed window has none.
 */
function initialYear(entry: LayerEntry, end: string): Year | undefined {
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
  const [activeLayer, setActiveLayer] = useState<LayerId>(0);
  const [years, setYears] = useState<Record<number, Year | undefined>>(() =>
    Object.fromEntries(config.layers.map((e, i) => [i, initialYear(e, params.end)])),
  );
  const [bands, setBandsState] = useState<Record<number, string>>(() =>
    Object.fromEntries(config.layers.map((e, i) => [i, e.params.bands as string])),
  );
  const [scene, setSceneState] = useState<Scene>();
  const [compare, setCompare] = useState(false);
  const [compareLayer, setCompareLayer] = useState<LayerId>(config.layers.length > 1 ? 1 : 0);
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
    }),
    [params, config, activeLayer, yearOf, setYear, selectYear, bandsOf, setBands, scene, setScene, compare, compareLayer],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlot(): PlotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlot outside PlotProvider");
  return v;
}
