import { useEffect, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { usePlot } from "../state/PlotContext";
import { shapeProblem, toPolygon, type ShapeProblem } from "../lib/urlParams";
import { t } from "../lib/i18n";

const DRAFT = "redraw";

/** The corners as dots, joined by a line that closes back to the first once there are three. */
function draft(corners: number[][]) {
  const line = corners.length >= 3 ? [...corners, corners[0]] : corners;
  return {
    type: "FeatureCollection" as const,
    features: [
      ...corners.map((c) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: c }, properties: {} })),
      ...(line.length >= 2 ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: line }, properties: {} }] : []),
    ],
  };
}

/** "Redraw polygon" on the map: click corners (or one place for a point) to analyse that shape instead of the plot. */
export default function RedrawControl({ map }: { map: MlMap }) {
  const { redrawn, setPlot } = usePlot();
  // null while not drawing.
  const [corners, setCorners] = useState<number[][] | null>(null);
  const [problem, setProblem] = useState<ShapeProblem>();
  const drawing = corners !== null;

  useEffect(() => {
    if (!drawing) return;
    const click = (e: MapMouseEvent) => {
      setCorners((c) => [...(c ?? []), [e.lngLat.lng, e.lngLat.lat]]);
      setProblem(undefined);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setCorners(null);
    map.on("click", click);
    window.addEventListener("keydown", key);
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = "crosshair";
    map.addSource(DRAFT, { type: "geojson", data: draft([]) });
    map.addLayer({ id: DRAFT + "-line", type: "line", source: DRAFT, filter: ["==", "$type", "LineString"], paint: { "line-color": "#4a9cd5", "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({ id: DRAFT + "-dot", type: "circle", source: DRAFT, filter: ["==", "$type", "Point"], paint: { "circle-radius": 4, "circle-color": "#4a9cd5", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    return () => {
      window.removeEventListener("keydown", key);
      setProblem(undefined);
      // Ticking Compare while drawing removes the map in the same commit, possibly first.
      try {
        map.off("click", click);
        map.doubleClickZoom.enable();
        map.getCanvas().style.cursor = "";
        map.removeLayer(DRAFT + "-dot");
        map.removeLayer(DRAFT + "-line");
        map.removeSource(DRAFT);
      } catch {
        // The map is gone, and its draft with it.
      }
    };
  }, [drawing, map]);

  useEffect(() => {
    if (corners) map.getSource<GeoJSONSource>(DRAFT)?.setData(draft(corners));
  }, [corners, map]);

  const done = () => {
    if (!corners) return;
    // The same path as a plot from the address: a Point becomes its ~55 m square.
    const plot = toPolygon(corners.length === 1 ? { type: "Point", coordinates: corners[0] } : { type: "Polygon", coordinates: [[...corners, corners[0]]] });
    const p = shapeProblem(plot);
    if (p) return setProblem(p);
    setPlot(plot);
    setCorners(null);
  };

  return (
    <div className="redraw">
      {drawing ? (
        <>
          <div className="redraw-buttons">
            <button onClick={done} disabled={corners.length === 0 || corners.length === 2}>
              {t("redraw.done")}
            </button>
            <button onClick={() => setCorners(null)}>{t("redraw.cancel")}</button>
          </div>
          <p role="status">{t("redraw.hint")}</p>
          {problem && <p role="alert" className="redraw-error">{t(`redraw.${problem}`)}</p>}
        </>
      ) : (
        <div className="redraw-buttons">
          <button onClick={() => setCorners([])}>{t("redraw.start")}</button>
          {redrawn && <button onClick={() => setPlot()}>{t("redraw.original")}</button>}
        </div>
      )}
    </div>
  );
}
