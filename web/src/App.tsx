import { PlotProvider, usePlot } from "./state/PlotContext";
import MapView from "./components/MapView";
import { useLayerTiles } from "./components/LayerSources";
import { parsePlotUrl, type PlotParams } from "./lib/urlParams";

function Viewer() {
  const { plot, plotId, activeLayer } = usePlot();
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
        <div className="map-status">{status}</div>
      </div>
      <aside className="side-pane">
        <h2>Plot {plotId || "(no id)"}</h2>
      </aside>
    </div>
  );
}

export default function App() {
  let params: PlotParams;
  try {
    params = parsePlotUrl(window.location.search);
  } catch (e) {
    return <p style={{ padding: 16 }}>{(e as Error).message}. Open this page from Collect Earth.</p>;
  }
  return (
    <PlotProvider params={params}>
      <Viewer />
    </PlotProvider>
  );
}
