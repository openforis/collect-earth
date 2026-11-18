import { useApi, type ApiOptions } from "../hooks/useApi";
import { postApi, type PlotBody, type TileResponse } from "../lib/api";
import { nonDefault, type LayerEntry } from "../lib/config";
import { usePlot, type LayerId, type PlotState, type Scene, type Year } from "../state/PlotContext";

/**
 * The request fields for an entry's non-default parameters; the standard entries send none.
 * A Sentinel-2 entry's dates are its composite window, sent apart from the plot's own start/end;
 * at a year its window is that calendar year, at the last 12 months it sends none (the API's default).
 */
function layerFields(entry: LayerEntry, year: Year | undefined): Record<string, unknown> {
  if (entry.type === "landsat") return nonDefault(entry, ["bands", "maxCloud"]);
  if (entry.type === "sentinel1") return nonDefault(entry, ["bands"]);
  const { start, end, ...rest } = nonDefault(entry, ["bands", "maxCloud", "start", "end"]);
  if (start !== undefined) return { ...rest, compositeStart: start, compositeEnd: end };
  return typeof year === "number" ? { ...rest, compositeStart: `${year}-01-01`, compositeEnd: `${year + 1}-01-01` } : rest;
}

/** An imagery entry's tile endpoint and its request fields besides the plot's. */
function layerSide(entry: LayerEntry, year: Year | undefined): TileSide {
  const fields = layerFields(entry, year);
  if (entry.type === "sentinel2") return { path: "tiles/sentinel2", ...fields };
  return { path: `tiles/${entry.type}`, year, ...fields };
}

/** The API path and body of an imagery entry's tile request for a plot (the map and the next-plot warm-up share it). */
export function layerRequest(entry: LayerEntry, year: Year | undefined, p: PlotBody): { path: string; body: PlotBody & Record<string, unknown> } {
  const { path, ...fields } = layerSide(entry, year);
  return { path, body: { ...p, ...fields } };
}

/** A tile request without the plot: the endpoint and its own fields (one side of `tiles/difference`). */
export type TileSide = { path: string } & Record<string, unknown>;
type Override = { year?: number; scene?: Scene };

/**
 * The tile request of `layer` (an entry, with its row's year and bands, or the selected scene), `override`
 * replacing the year or the scene; undefined for the scene layer with no scene.
 */
export function tileSide(p: Pick<PlotState, "layers" | "yearOf" | "bandsOf" | "scene">, layer: LayerId, override: Override = {}): TileSide | undefined {
  if (layer === "scene") {
    const scene = override.scene ?? p.scene;
    return scene && { path: "tiles/scene", sensor: scene.sensor, timeStart: scene.timeStart };
  }
  // The row's band selector overrides the entry's bands.
  const entry = { ...p.layers[layer], params: { ...p.layers[layer].params, bands: p.bandsOf(layer) } };
  return layerSide(entry, override.year ?? p.yearOf(layer));
}

/**
 * Fetches the tile URL for one imagery layer; refetches when its inputs change.
 * Pass `{ enabled: false }` to hold the request (see `ApiOptions.enabled`).
 * `override` replaces the entry's own year or the selected scene (the right-hand side of a before/after comparison).
 */
export function useLayerTiles(layer: LayerId, options?: ApiOptions, override: Override = {}) {
  const p = usePlot();
  const { plot, start, end } = p;
  const side = tileSide(p, layer, override);
  return useApi<TileResponse>(
    (signal) => {
      if (!side) return Promise.reject(new Error("no scene selected"));
      const { path, ...fields } = side;
      return postApi(path, { plot, start, end, ...fields }, signal);
    },
    [layer, JSON.stringify(side), plot],
    options,
  );
}

/** Why the NDVI difference cannot be shown for the current comparison, or undefined when it can. */
export function differenceBlocked(p: Pick<PlotState, "layers" | "activeLayer" | "compareLayer" | "compareYear" | "compareScene">): string | undefined {
  const radar = (l: LayerId) => l !== "scene" && p.layers[l].type === "sentinel1";
  if (radar(p.activeLayer) || radar(p.compareLayer)) return "Not available for radar";
  if (p.activeLayer === p.compareLayer && p.compareYear === undefined && !p.compareScene) return "Both sides show the same image";
}

/** Fetches the NDVI change from the left side (`activeLayer`) to the right (`compareLayer` and its override). */
export function useDifferenceTiles(options?: ApiOptions) {
  const p = usePlot();
  const { plot, start, end } = p;
  const left = tileSide(p, p.activeLayer);
  const right = tileSide(p, p.compareLayer, { year: p.compareYear, scene: p.compareScene });
  return useApi<TileResponse>(
    (signal) => {
      if (!left || !right) return Promise.reject(new Error("no scene selected"));
      return postApi("tiles/difference", { plot, start, end, left, right }, signal);
    },
    [JSON.stringify([left, right]), plot],
    options,
  );
}
