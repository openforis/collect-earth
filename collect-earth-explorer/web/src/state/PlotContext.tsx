import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PlotParams } from "../lib/urlParams";
import type { ChartEntry, LayerEntry, resolveConfig } from "../lib/config";

/** The position of an entry in `layers`, or the implicit scene layer. */
export type LayerId = number | "scene";
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
  /** The year of Landsat entry `i`. */
  yearOf: (i: number) => number;
  setYear: (i: number, y: number) => void;
  /** Sets the year of Landsat entry `i` and makes it the active layer in one update. */
  selectYear: (i: number, y: number) => void;
  scene?: Scene;
  setScene: (s: Scene) => void;
  compare: boolean;
  setCompare: (c: boolean) => void;
  compareLayer: LayerId;
  setCompareLayer: (l: LayerId) => void;
}

const Ctx = createContext<PlotState | null>(null);

/** Its `year`, else the last of its `years`, else the year before the plot's end; clamped into `years`. */
function initialYear(entry: LayerEntry, end: string) {
  const years = entry.params.years as [number, number] | undefined;
  const y = (entry.params.year as number | undefined) ?? years?.[1] ?? new Date(end).getUTCFullYear() - 1;
  return years ? Math.min(Math.max(y, years[0]), years[1]) : y;
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
  const [years, setYears] = useState<Record<number, number>>(() =>
    Object.fromEntries(config.layers.flatMap((e, i) => (e.type === "landsat" ? [[i, initialYear(e, params.end)]] : []))),
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
  const setYear = useCallback((i: number, y: number) => setYears((ys) => ({ ...ys, [i]: y })), []);
  const selectYear = useCallback(
    (i: number, y: number) => {
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
      scene,
      setScene,
      compare,
      setCompare,
      compareLayer,
      setCompareLayer,
    }),
    [params, config, activeLayer, yearOf, setYear, selectYear, scene, setScene, compare, compareLayer],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlot(): PlotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlot outside PlotProvider");
  return v;
}
