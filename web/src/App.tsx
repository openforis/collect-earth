import { lazy, Suspense, useMemo } from "react";
import { PlotProvider, usePlot } from "./state/PlotContext";
import MapView from "./components/MapView";
import CompareMap from "./components/CompareMap";
import LayersPanel from "./components/LayersPanel";
import { useLayerTiles } from "./components/LayerSources";
import type { ApiState } from "./hooks/useApi";
import { isRetryable, type TileResponse } from "./lib/api";
import { parsePlotUrl, type PlotParams } from "./lib/urlParams";

// The chart cards pull in Plotly (several MB): loaded in a separate chunk after the
// map is up, so the first paint does not wait for it.
const CcdcCard = lazy(() => import("./components/charts/CcdcCard"));
const LandsatNdviCard = lazy(() => import("./components/charts/LandsatNdviCard"));
const Sentinel2NdviCard = lazy(() => import("./components/charts/Sentinel2NdviCard"));
const ModisCard = lazy(() => import("./components/charts/ModisCard"));

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
  const { plot, plotId, start, end, activeLayer, compare, compareLayer } = usePlot();
  const tiles = useLayerTiles(activeLayer);
  // Comparing a layer with itself (same id, and so the same request key: the
  // Landsat year and the scene are shared state) just shows the left tiles twice.
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
        <Suspense fallback={<div className="chart-placeholder">Loading charts…</div>}>
          <CcdcCard />
          <LandsatNdviCard />
          <Sentinel2NdviCard />
          <ModisCard />
        </Suspense>
      </aside>
    </div>
  );
}

type Parsed = { params: PlotParams; error?: undefined } | { params?: undefined; error: string };

export default function App() {
  const search = window.location.search;
  // Parsed once per URL: PlotProvider memoises on the params object's identity.
  const parsed = useMemo<Parsed>(() => {
    try {
      return { params: parsePlotUrl(search) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [search]);
  if (parsed.error !== undefined) {
    return <p style={{ padding: 16 }}>{parsed.error}. Open this page from Collect Earth.</p>;
  }
  return (
    <PlotProvider params={parsed.params}>
      <Viewer />
    </PlotProvider>
  );
}
