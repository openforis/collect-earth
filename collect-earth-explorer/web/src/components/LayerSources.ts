import { useApi, type ApiOptions } from "../hooks/useApi";
import { postApi, type TileResponse } from "../lib/api";
import { usePlot, type LayerId } from "../state/PlotContext";

/**
 * Fetches the tile URL for one imagery layer; refetches when its inputs change.
 * Pass `{ enabled: false }` to hold the request (see `ApiOptions.enabled`).
 */
export function useLayerTiles(layer: LayerId, options?: ApiOptions) {
  const { plot, start, end, layers, yearOf, scene } = usePlot();
  const year = layer !== "scene" && layers[layer].type === "landsat" ? yearOf(layer) : undefined;
  const key = layer === "scene" ? scene && `${scene.sensor}:${scene.timeStart}` : (year ?? "fixed");
  return useApi<TileResponse>(
    (signal) => {
      if (layer !== "scene") {
        if (layers[layer].type === "landsat") return postApi("tiles/landsat", { plot, start, end, year }, signal);
        return postApi("tiles/sentinel2", { plot, start, end }, signal);
      }
      if (!scene) return Promise.reject(new Error("no scene selected"));
      return postApi("tiles/scene", { plot, start, end, sensor: scene.sensor, timeStart: scene.timeStart }, signal);
    },
    [layer, key, plot],
    options,
  );
}
