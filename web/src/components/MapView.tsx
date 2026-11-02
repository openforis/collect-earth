import { useEffect, useRef } from "react";
import { Map as MlMap, NavigationControl, ScaleControl, type MapOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { polygonBounds, type Polygon } from "../lib/urlParams";

// maplibre-gl 6 does not re-export StyleSpecification; derive it from MapOptions.
type StyleSpecification = Exclude<MapOptions["style"], string | undefined>;

export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
      maxzoom: 19,
    },
  },
  layers: [{ id: "esri", type: "raster", source: "esri" }],
};

export const IMAGERY_SOURCE = "imagery";
const OUTLINE_LAYER = "plot-outline";

/** Replaces the imagery raster layer with a new tile URL, keeping the plot outline on top. */
export function setImagery(map: MlMap, tileUrl: string | undefined) {
  if (map.getLayer(IMAGERY_SOURCE)) map.removeLayer(IMAGERY_SOURCE);
  if (map.getSource(IMAGERY_SOURCE)) map.removeSource(IMAGERY_SOURCE);
  if (!tileUrl) return;
  map.addSource(IMAGERY_SOURCE, { type: "raster", tiles: [tileUrl], tileSize: 256 });
  map.addLayer({ id: IMAGERY_SOURCE, type: "raster", source: IMAGERY_SOURCE }, OUTLINE_LAYER);
}

export function addPlotOutline(map: MlMap, plot: Polygon) {
  map.addSource("plot", { type: "geojson", data: { type: "Feature", geometry: plot, properties: {} } });
  map.addLayer({
    id: OUTLINE_LAYER,
    type: "line",
    source: "plot",
    paint: { "line-color": "#ffeb3b", "line-width": 2 },
  });
}

interface Props {
  plot: Polygon;
  tileUrl?: string;
  onMap?: (m: MlMap) => void;
}

export default function MapView({ plot, tileUrl, onMap }: Props) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  // Latest tileUrl, read by the "load" handler so the first imagery layer is
  // whatever is current when the style finishes loading.
  const tileUrlRef = useRef(tileUrl);
  tileUrlRef.current = tileUrl;

  // The map is created once per mount; `plot` and `onMap` are fixed for the
  // lifetime of the viewer (they come from the URL), so they are read once here.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const map = new MlMap({
      container: el.current!,
      style: BASE_STYLE,
      bounds: polygonBounds(plot),
      fitBoundsOptions: { padding: 80, maxZoom: 16 },
    });
    map.addControl(new NavigationControl(), "top-right");
    map.addControl(new ScaleControl(), "bottom-right");
    map.on("load", () => {
      addPlotOutline(map, plot);
      mapRef.current = map;
      onMap?.(map);
      setImagery(map, tileUrlRef.current);
    });
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) setImagery(map, tileUrl);
  }, [tileUrl]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
