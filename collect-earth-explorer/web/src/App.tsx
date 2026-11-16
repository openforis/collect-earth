import { lazy, Suspense, useMemo, type ComponentType } from "react";
import { PlotProvider, usePlot } from "./state/PlotContext";
import MapView from "./components/MapView";
import CompareMap from "./components/CompareMap";
import LayersPanel from "./components/LayersPanel";
import { useLayerTiles } from "./components/LayerSources";
import type { ApiState } from "./hooks/useApi";
import { isRetryable, type TileResponse } from "./lib/api";
import { parsePlotUrl, type PlotParams } from "./lib/urlParams";
import { resolveConfig, type ChartEntry } from "./lib/config";

// The chart cards pull in Plotly (several MB): loaded in a separate chunk after the
// map is up, so the first paint does not wait for it.
// One component per catalogue chart type.
const CARDS: Record<string, ComponentType<{ params: ChartEntry["params"] }>> = {
  ccdc: lazy(() => import("./components/charts/CcdcCard")),
  "landsat-series": lazy(() => import("./components/charts/LandsatNdviCard")),
  "sentinel2-series": lazy(() => import("./components/charts/Sentinel2NdviCard")),
  modis: lazy(() => import("./components/charts/ModisCard")),
};

/** One line of the map status box: loading / error (with Retry when retryable) / the layer label. */
function TileStatus({ side, tiles }: { side?: string; tiles: ApiState<TileResponse> }) {
  const text =
    tiles.status === "loading"
      ? "Loading imagery…"
      : tiles.status === "error"
        ? `Imagery failed: ${tiles.error?.message}`
        : tiles.data?.label;
  return (
    <div>
      {side && `${side}: `}
      {text}
      {tiles.status === "error" && isRetryable(tiles.error) && <button onClick={tiles.retry}>Retry</button>}
    </div>
  );
}

function Viewer() {
  const { plot, plotId, start, end, activeLayer, compare, compareLayer, charts, notices } = usePlot();
  const tiles = useLayerTiles(activeLayer);
  // Comparing a layer with itself (same id, and so the same request key: an
  // entry's year and the scene are shared state) just shows the left tiles twice.
  const sameLayer = compare && activeLayer === compareLayer;
  // Always mounted (hooks cannot be conditional) but only requested while
  // comparing a different layer, so a plain page load costs one tile request, not two.
  const rightOwn = useLayerTiles(compareLayer, { enabled: compare && !sameLayer });
  const right = sameLayer ? tiles : rightOwn;
  return (
    <div className="viewer">
      <div className="map-pane">
        {compare ? (
          <CompareMap key="compare" plot={plot} leftTileUrl={tiles.data?.tileUrl} rightTileUrl={right.data?.tileUrl} />
        ) : (
          <MapView key="single" plot={plot} tileUrl={tiles.data?.tileUrl} />
        )}
        <LayersPanel />
        <div className="map-status">
          <TileStatus side={compare ? "Left" : undefined} tiles={tiles} />
          {compare && <TileStatus side="Right" tiles={right} />}
        </div>
      </div>
      <aside className="side-pane">
        <h2>Plot {plotId || "(no id)"}</h2>
        <p className="dates">
          {start} to {end}
        </p>
        {notices.length > 0 && (
          <p className="config-notice">This survey's Explorer settings were partly ignored: {notices.join(" ")}</p>
        )}
        <Suspense fallback={<div className="chart-placeholder">Loading charts…</div>}>
          {charts.map((c, i) => {
            const Card = CARDS[c.type];
            return Card && <Card key={i} params={c.params} />;
          })}
        </Suspense>
      </aside>
    </div>
  );
}

// Shown when the page is opened without a plot, so the app can be tried without Collect Earth.
const SAMPLE_PLOTS: [name: string, lon: number, lat: number][] = [
  ["Forest, Belize", -88.75, 17.25],
  ["Deforestation frontier, Rondônia, Brazil", -63.0, -10.0],
  ["Farmland, central Kenya", 37.0, -0.4],
];
const sampleHref = (name: string, lon: number, lat: number) =>
  `?geoJson=${encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }))}&plot_id=${encodeURIComponent(name)}`;

// The latest year a configuration may name; read when the page loads (not during render, which must stay pure).
const THIS_YEAR = new Date().getUTCFullYear();

type Parsed =
  | { params: PlotParams; config: ReturnType<typeof resolveConfig>; error?: undefined }
  | { params?: undefined; error: string };

export default function App() {
  const search = window.location.search;
  const hash = window.location.hash;
  // Parsed once per URL: PlotProvider memoises on the params and config objects' identity.
  const parsed = useMemo<Parsed>(() => {
    try {
      const params = parsePlotUrl(search, undefined, hash);
      return { params, config: resolveConfig(params.configText, THIS_YEAR) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [search, hash]);
  if (parsed.error !== undefined) {
    return (
      <div style={{ padding: 16 }}>
        <p>{parsed.error}. Open this page from Collect Earth, or try a sample plot:</p>
        <ul>
          {SAMPLE_PLOTS.map(([name, lon, lat]) => (
            <li key={name}>
              <a href={sampleHref(name, lon, lat)}>{name}</a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <PlotProvider params={parsed.params} config={parsed.config}>
      <Viewer />
    </PlotProvider>
  );
}
