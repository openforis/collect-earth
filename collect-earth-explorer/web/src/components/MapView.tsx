import { useEffect, useRef } from "react";
import {
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  type StyleSpecification,
  type RasterTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { polygonBounds, type Polygon } from "../lib/urlParams";

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
export const IMAGERY_ATTRIBUTION = "Google Earth Engine, Copernicus Sentinel-2, USGS Landsat";
const OUTLINE_LAYER = "plot-outline";

/**
 * Points the imagery raster layer at `tileUrl`, keeping the plot outline on top.
 * An existing source is updated in place (so the old tiles stay visible until the
 * new ones arrive); it is only removed when `tileUrl` is undefined and only added
 * when missing.
 */
export function setImagery(map: MlMap, tileUrl: string | undefined) {
  const existing = map.getSource<RasterTileSource>(IMAGERY_SOURCE);
  if (!tileUrl) {
    if (map.getLayer(IMAGERY_SOURCE)) map.removeLayer(IMAGERY_SOURCE);
    if (existing) map.removeSource(IMAGERY_SOURCE);
    return;
  }
  if (existing) {
    existing.setTiles([tileUrl]);
    return;
  }
  map.addSource(IMAGERY_SOURCE, {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    attribution: IMAGERY_ATTRIBUTION,
  });
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
    let disposed = false;
    const map = new MlMap({
      container: el.current!,
      style: BASE_STYLE,
      bounds: polygonBounds(plot),
      fitBoundsOptions: { padding: 80, maxZoom: 16 },
    });
    map.addControl(new NavigationControl(), "top-right");
    map.addControl(new ScaleControl(), "bottom-right");
    map.on("load", () => {
      // Under StrictMode the first map is removed before its style loads; a
      // late "load" must not touch the removed map or steal mapRef.
      if (disposed) return;
      addPlotOutline(map, plot);
      mapRef.current = map;
      onMap?.(map);
      setImagery(map, tileUrlRef.current);
    });
    return () => {
      disposed = true;
      mapRef.current = null;
      map.remove();
    };
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  // mapRef is only set from the "load" handler, so a non-null map always has
  // its style loaded. Do not gate on isStyleLoaded(): in maplibre 6 it is false
  // whenever any source is still fetching tiles, which would drop the swap.
  useEffect(() => {
    if (mapRef.current) setImagery(mapRef.current, tileUrl);
  }, [tileUrl]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
