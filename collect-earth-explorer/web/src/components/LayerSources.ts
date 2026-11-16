import { useApi, type ApiOptions } from "../hooks/useApi";
import { postApi, type TileResponse } from "../lib/api";
import { nonDefault, type LayerEntry } from "../lib/config";
import { usePlot, type LayerId } from "../state/PlotContext";

/**
 * The request fields for an entry's non-default parameters; the standard entries send none.
 * A Sentinel-2 entry's dates are its composite window, sent apart from the plot's own start/end.
 */
function layerFields(entry: LayerEntry): Record<string, unknown> {
  if (entry.type === "landsat") return nonDefault(entry, ["bands", "maxCloud"]);
  const { start, end, ...rest } = nonDefault(entry, ["bands", "maxCloud", "start", "end"]);
  return start === undefined ? rest : { ...rest, compositeStart: start, compositeEnd: end };
}

/**
 * Fetches the tile URL for one imagery layer; refetches when its inputs change.
 * Pass `{ enabled: false }` to hold the request (see `ApiOptions.enabled`).
 */
export function useLayerTiles(layer: LayerId, options?: ApiOptions) {
  const { plot, start, end, layers, yearOf, scene } = usePlot();
  const year = layer !== "scene" && layers[layer].type === "landsat" ? yearOf(layer) : undefined;
  const fields = layer === "scene" ? {} : layerFields(layers[layer]);
  const key = layer === "scene" ? scene && `${scene.sensor}:${scene.timeStart}` : `${year ?? "fixed"}:${JSON.stringify(fields)}`;
  return useApi<TileResponse>(
    (signal) => {
      if (layer !== "scene") {
        if (layers[layer].type === "landsat") return postApi("tiles/landsat", { plot, start, end, year, ...fields }, signal);
        return postApi("tiles/sentinel2", { plot, start, end, ...fields }, signal);
      }
      if (!scene) return Promise.reject(new Error("no scene selected"));
      return postApi("tiles/scene", { plot, start, end, sensor: scene.sensor, timeStart: scene.timeStart }, signal);
    },
    [layer, key, plot],
    options,
  );
}
