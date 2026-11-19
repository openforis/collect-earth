// Warms the server's store for the next plot Collect Earth will open, so its charts and imagery come from the store.
import { postApi, type PlotBody, type TileResponse } from "./api";
import { chartRequest, type LayerEntry, type resolveConfig } from "./config";
import { chartOpen } from "./folds";
import { polygonBounds, type PlotParams, type Polygon } from "./urlParams";
import { differenceBlocked, layerRequest, tileSide } from "../components/LayerSources";
import { storedView, type View } from "../state/view";

type Config = ReturnType<typeof resolveConfig>;

/** The tile requests the map sends on opening with `view`: its layer, and when comparing the other side's or the difference. */
function viewRequests(layers: LayerEntry[], view: View, p: PlotBody) {
  const state = {
    layers,
    yearOf: (i: number) => view.years[i],
    bandsOf: (i: number) => view.bands[i],
    activeLayer: view.active,
    compareLayer: view.compareLayer,
    scene: undefined,
    compareYear: undefined,
    compareScene: undefined,
  };
  if (view.compare && view.difference && !differenceBlocked(state))
    return [{ path: "tiles/difference", body: { ...p, left: tileSide(state, view.active), right: tileSide(state, view.compareLayer) } }];
  const side = (i: number) => layerRequest({ ...layers[i], params: { ...layers[i].params, bands: view.bands[i] } }, view.years[i], p);
  return view.compare && view.compareLayer !== view.active ? [side(view.active), side(view.compareLayer)] : [side(view.active)];
}

/**
 * What the page sends on first load of plot `next` (same dates and configuration as this one): the charts the stored
 * folds leave open and the remembered view's tiles. CCDC goes last: it takes most of a minute, and the interpreter may
 * move on before it ends.
 */
export function warmRequests(next: Polygon, params: PlotParams, config: Config) {
  const p = { plot: next, start: params.start, end: params.end };
  const charts = config.charts.filter((_, i) => chartOpen(config.charts, i));
  return [
    ...charts.filter((c) => c.type !== "ccdc").map((c) => chartRequest(c, p)),
    ...viewRequests(config.layers, storedView(config.layers, params.end), p),
    ...charts.filter((c) => c.type === "ccdc").map((c) => chartRequest(c, p)),
  ];
}

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

/** The imagery tiles `[z, x, y]` on `plot` and one tile around it when MapView opens on it in a `width` × `height` pane, at most 12. */
export function plotTiles(plot: Polygon, width: number, height: number): [number, number, number][] {
  const [[w, s], [e, n]] = polygonBounds(plot);
  // MapView fits the bounds with padding 80 and maxZoom 16 on MapLibre's 512 px world.
  const fit = Math.log2(Math.min((width - 160) / ((mercX(e) - mercX(w)) * 512), (height - 160) / ((mercY(s) - mercY(n)) * 512)));
  // MapLibre loads 256 px raster tiles one level deeper than the map zoom, rounded.
  const z = Math.round(Math.min(16, Number.isFinite(fit) ? fit : 16)) + 1;
  const t = (v: number) => Math.floor(v * 2 ** z);
  const tiles: [number, number, number][] = [];
  for (let y = t(mercY(n)) - 1; y <= t(mercY(s)) + 1; y++) for (let x = t(mercX(w)) - 1; x <= t(mercX(e)) + 1; x++) tiles.push([z, x, y]);
  return tiles.slice(0, 12);
}

/** Sends the warm requests one at a time, downloading the next plot's tiles once their address is known (the browser keeps them an hour). Errors are ignored. */
export async function warm(next: Polygon, params: PlotParams, config: Config, width: number, height: number) {
  for (const { path, body } of warmRequests(next, params, config)) {
    const answer = await postApi<TileResponse>(path, body).catch(() => undefined);
    const url = path.startsWith("tiles/") && answer?.tileUrl;
    if (!url) continue;
    await Promise.all(
      plotTiles(next, width, height).map(([z, x, y]) =>
        fetch(url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)))
          .then((r) => r.blob())
          .catch(() => {}),
      ),
    );
  }
}
