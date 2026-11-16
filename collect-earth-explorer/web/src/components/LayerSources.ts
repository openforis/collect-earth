import { useApi, type ApiOptions } from "../hooks/useApi";
import { postApi, type TileResponse } from "../lib/api";
import { nonDefault, type LayerEntry } from "../lib/config";
import { usePlot, type LayerId, type Year } from "../state/PlotContext";

/**
 * The request fields for an entry's non-default parameters; the standard entries send none.
 * A Sentinel-2 entry's dates are its composite window, sent apart from the plot's own start/end;
 * at a year its window is that calendar year, at the last 12 months it sends none (the API's default).
 */
function layerFields(entry: LayerEntry, year: Year | undefined): Record<string, unknown> {
  if (entry.type === "landsat") return nonDefault(entry, ["bands", "maxCloud"]);
  const { start, end, ...rest } = nonDefault(entry, ["bands", "maxCloud", "start", "end"]);
  if (start !== undefined) return { ...rest, compositeStart: start, compositeEnd: end };
  return typeof year === "number" ? { ...rest, compositeStart: `${year}-01-01`, compositeEnd: `${year + 1}-01-01` } : rest;
}

/**
 * Fetches the tile URL for one imagery layer; refetches when its inputs change.
 * Pass `{ enabled: false }` to hold the request (see `ApiOptions.enabled`).
 */
export function useLayerTiles(layer: LayerId, options?: ApiOptions) {
  const { plot, start, end, layers, yearOf, bandsOf, scene } = usePlot();
  const year = layer === "scene" ? undefined : yearOf(layer);
  // The row's band selector overrides the entry's bands.
  const fields = layer === "scene" ? {} : layerFields({ ...layers[layer], params: { ...layers[layer].params, bands: bandsOf(layer) } }, year);
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
