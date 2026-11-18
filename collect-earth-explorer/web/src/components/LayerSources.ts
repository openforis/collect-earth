import { useApi, type ApiOptions } from "../hooks/useApi";
import { postApi, type PlotBody, type TileResponse } from "../lib/api";
import { nonDefault, type LayerEntry } from "../lib/config";
import { usePlot, type LayerId, type Scene, type Year } from "../state/PlotContext";

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

/** The API path and body of an imagery entry's tile request for a plot (the map and the next-plot warm-up share it). */
export function layerRequest(entry: LayerEntry, year: Year | undefined, p: PlotBody): { path: string; body: PlotBody & Record<string, unknown> } {
  const fields = layerFields(entry, year);
  return entry.type === "landsat" ? { path: "tiles/landsat", body: { ...p, year, ...fields } } : { path: "tiles/sentinel2", body: { ...p, ...fields } };
}

/**
 * Fetches the tile URL for one imagery layer; refetches when its inputs change.
 * Pass `{ enabled: false }` to hold the request (see `ApiOptions.enabled`).
 * `override` replaces the entry's own year or the selected scene (the right-hand side of a before/after comparison).
 */
export function useLayerTiles(layer: LayerId, options?: ApiOptions, override: { year?: number; scene?: Scene } = {}) {
  const { plot, start, end, layers, yearOf, bandsOf, scene: selected } = usePlot();
  const scene = override.scene ?? selected;
  const year = layer === "scene" ? undefined : (override.year ?? yearOf(layer));
  // The row's band selector overrides the entry's bands.
  const entry = layer === "scene" ? undefined : { ...layers[layer], params: { ...layers[layer].params, bands: bandsOf(layer) } };
  const key = entry ? `${year ?? "fixed"}:${JSON.stringify(layerFields(entry, year))}` : scene && `${scene.sensor}:${scene.timeStart}`;
  return useApi<TileResponse>(
    (signal) => {
      if (entry) {
        const { path, body } = layerRequest(entry, year, { plot, start, end });
        return postApi(path, body, signal);
      }
      if (!scene) return Promise.reject(new Error("no scene selected"));
      return postApi("tiles/scene", { plot, start, end, sensor: scene.sensor, timeStart: scene.timeStart }, signal);
    },
    [layer, key, plot],
    options,
  );
}
