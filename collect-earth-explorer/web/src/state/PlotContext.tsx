import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PlotParams } from "../lib/urlParams";

export type LayerId = "sentinel2" | "landsat" | "scene";
export interface Scene {
  sensor: "landsat" | "sentinel2";
  timeStart: number;
  label: string;
}

export interface PlotState extends PlotParams {
  activeLayer: LayerId;
  setActiveLayer: (l: LayerId) => void;
  landsatYear: number;
  setLandsatYear: (y: number) => void;
  /** Sets the Landsat year and makes Landsat the active layer in one update. */
  selectLandsatYear: (y: number) => void;
  scene?: Scene;
  setScene: (s: Scene) => void;
  compare: boolean;
  setCompare: (c: boolean) => void;
  compareLayer: LayerId;
  setCompareLayer: (l: LayerId) => void;
}

const Ctx = createContext<PlotState | null>(null);

export function PlotProvider({ params, children }: { params: PlotParams; children: ReactNode }) {
  const [activeLayer, setActiveLayer] = useState<LayerId>("sentinel2");
  const [landsatYear, setLandsatYear] = useState(new Date(params.end).getUTCFullYear() - 1);
  const [scene, setSceneState] = useState<Scene>();
  const [compare, setCompare] = useState(false);
  const [compareLayer, setCompareLayer] = useState<LayerId>("landsat");
  // React batches the two state updates below into a single render.
  const setScene = useCallback((s: Scene) => {
    setSceneState(s);
    setActiveLayer("scene");
  }, []);
  const selectLandsatYear = useCallback((y: number) => {
    setLandsatYear(y);
    setActiveLayer("landsat");
  }, []);
  const value = useMemo<PlotState>(
    () => ({
      ...params,
      activeLayer,
      setActiveLayer,
      landsatYear,
      setLandsatYear,
      selectLandsatYear,
      scene,
      setScene,
      compare,
      setCompare,
      compareLayer,
      setCompareLayer,
    }),
    [params, activeLayer, landsatYear, selectLandsatYear, scene, setScene, compare, compareLayer],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlot(): PlotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlot outside PlotProvider");
  return v;
}
