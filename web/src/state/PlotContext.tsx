import { createContext, useContext, useState, type ReactNode } from "react";
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
  const setScene = (s: Scene) => {
    setSceneState(s);
    setActiveLayer("scene");
  };
  const value: PlotState = {
    ...params,
    activeLayer,
    setActiveLayer,
    landsatYear,
    setLandsatYear,
    scene,
    setScene,
    compare,
    setCompare,
    compareLayer,
    setCompareLayer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlot(): PlotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlot outside PlotProvider");
  return v;
}
