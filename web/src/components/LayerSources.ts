import { useApi } from "../hooks/useApi";
import { postApi, type TileResponse } from "../lib/api";
import { usePlot, type LayerId } from "../state/PlotContext";

/** Fetches the tile URL for one imagery layer; refetches when its inputs change. */
export function useLayerTiles(layer: LayerId) {
  const { plot, start, end, landsatYear, scene } = usePlot();
  const key =
    layer === "landsat"
      ? landsatYear
      : layer === "scene"
        ? scene && `${scene.sensor}:${scene.timeStart}`
        : "fixed";
  return useApi<TileResponse>(
    (signal) => {
      if (layer === "sentinel2") return postApi("tiles/sentinel2", { plot, start, end }, signal);
      if (layer === "landsat") return postApi("tiles/landsat", { plot, start, end, year: landsatYear }, signal);
      if (!scene) return Promise.reject(new Error("no scene selected"));
      return postApi("tiles/scene", { plot, start, end, sensor: scene.sensor, timeStart: scene.timeStart }, signal);
    },
    [layer, key, plot],
  );
}
