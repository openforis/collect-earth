import { useMemo } from "react";
import { PlotProvider, usePlot } from "./state/PlotContext";
import MapView from "./components/MapView";
import CompareMap from "./components/CompareMap";
import LayersPanel from "./components/LayersPanel";
import CcdcCard from "./components/charts/CcdcCard";
import LandsatNdviCard from "./components/charts/LandsatNdviCard";
import Sentinel2NdviCard from "./components/charts/Sentinel2NdviCard";
import ModisCard from "./components/charts/ModisCard";
import { useLayerTiles } from "./components/LayerSources";
import type { ApiState } from "./hooks/useApi";
import type { TileResponse } from "./lib/api";
import { parsePlotUrl, type PlotParams } from "./lib/urlParams";

/** One line of the map status box: loading / error (with Retry) / the layer label. */
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
      {tiles.status === "error" && <button onClick={tiles.retry}>Retry</button>}
    </div>
  );
}

function Viewer() {
  const { plot, plotId, start, end, activeLayer, compare, compareLayer } = usePlot();
  const tiles = useLayerTiles(activeLayer);
  // Always mounted (hooks cannot be conditional); the server caches tile URLs,
  // so the extra request while compare is off is cheap.
  const right = useLayerTiles(compareLayer);
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
        <CcdcCard />
        <LandsatNdviCard />
        <Sentinel2NdviCard />
        <ModisCard />
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
