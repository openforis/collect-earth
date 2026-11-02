import { useMemo } from "react";
import { PlotProvider, usePlot } from "./state/PlotContext";
import MapView from "./components/MapView";
import LayersPanel from "./components/LayersPanel";
import CcdcCard from "./components/charts/CcdcCard";
import LandsatNdviCard from "./components/charts/LandsatNdviCard";
import Sentinel2NdviCard from "./components/charts/Sentinel2NdviCard";
import ModisCard from "./components/charts/ModisCard";
import { useLayerTiles } from "./components/LayerSources";
import { parsePlotUrl, type PlotParams } from "./lib/urlParams";

function Viewer() {
  const { plot, plotId, start, end, activeLayer } = usePlot();
  const tiles = useLayerTiles(activeLayer);
  const status =
    tiles.status === "loading"
      ? "Loading imagery…"
      : tiles.status === "error"
        ? `Imagery failed: ${tiles.error?.message}`
        : tiles.data?.label;
  return (
    <div className="viewer">
      <div className="map-pane">
        <MapView plot={plot} tileUrl={tiles.data?.tileUrl} />
        <LayersPanel />
        <div className="map-status">
          {status}
          {tiles.status === "error" && <button onClick={tiles.retry}>Retry</button>}
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
