import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { getMapPlots, type AnalysisModel, type MapPlots } from "../../api";
import { mapPlotsSql } from "../../analysisInsights";
import type { Filter } from "../../analysisQuestion";
import { valueColour } from "../../analysisColors";
import type { Cube } from "../../analysisView";
import { useApp } from "../../appContext";
import { formatNumber } from "../../format";
import { useT } from "../../i18n";
import { attributionHtml, CLUSTER_FROM } from "../../mapView";
import { clusterIcon, loadLeaflet, type LeafletModule } from "../../project/leaflet";
import { navigate, pathFor } from "../../router";
import { ErrorAlert } from "../ErrorAlert";

/** Values in the legend at most; the others are still drawn in their colours. */
const LEGEND = 8;

/**
 * The plots behind the view on a map, each a dot in the colour of its value of the view's first row field (the
 * chart's colours), a popup with the plot and a link to its page. The places come from the project's map
 * (GET /map/plots); the plots from DuckDB, with the view's filters.
 */
export function AnalysisMap({
  projectId,
  model,
  cube,
  filters,
  colour,
  query,
  plotLinks,
}: {
  projectId: string;
  model: AnalysisModel;
  cube: Cube;
  filters: Filter[];
  colour: string | null;
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  plotLinks: boolean;
}) {
  const t = useT();
  const { info, language } = useApp();
  const element = useRef<HTMLDivElement>(null);
  const leaflet = useRef<{ L: LeafletModule; map: Leaflet.Map; layer: Leaflet.LayerGroup; renderer: Leaflet.Renderer } | null>(null);
  const [places, setPlaces] = useState<MapPlots | null>(null);
  const [rows, setRows] = useState<{ plot: string; value: string | null }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const filtersKey = JSON.stringify(filters);
  const tiles = info.mapTiles;

  // the plots' places, once
  useEffect(() => {
    let stopped = false;
    getMapPlots(projectId, {}, undefined, () => stopped).then(
      (m) => !stopped && setPlaces(m),
      (e: unknown) => !stopped && setError(e),
    );
    return () => {
      stopped = true;
    };
  }, [projectId]);

  // the plots of the view
  useEffect(() => {
    const sql = mapPlotsSql(cube, colour, filters);
    if (!sql) return;
    let live = true;
    query(sql).then(
      (r) => live && setRows(r.map((x) => ({ plot: String(x.plot), value: x.value === null || x.value === undefined ? null : String(x.value) }))),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube, colour, filtersKey, query]);

  // the map
  useEffect(() => {
    let gone = false;
    loadLeaflet().then(
      (L) => {
        if (gone || !element.current) return;
        const renderer = L.canvas({ padding: 0.5 });
        const map = L.map(element.current, { preferCanvas: true, renderer, worldCopyJump: true, minZoom: 1, maxZoom: tiles.maxZoom, zoomControl: true });
        map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
        L.tileLayer(tiles.url, { attribution: attributionHtml(tiles), maxZoom: tiles.maxZoom, referrerPolicy: "strict-origin-when-cross-origin", keepBuffer: 1 }).addTo(map);
        map.setView([0, 0], 2);
        leaflet.current = { L, map, renderer, layer: L.layerGroup().addTo(map) };
        setReady(true);
      },
      (e: unknown) => !gone && setError(e),
    );
    return () => {
      gone = true;
      leaflet.current?.map.remove();
      leaflet.current = null;
      setReady(false);
    };
  }, [tiles]);

  const byName = useMemo(() => new Map(cube.columns.map((c) => [c.name, c])), [cube]);
  const field = colour ? byName.get(colour) : undefined;
  const indexOf = useMemo(() => new Map((places?.plots ?? []).map((p, i) => [p, i])), [places]);
  const placed = useMemo(() => (rows ?? []).map((r) => ({ ...r, i: indexOf.get(r.plot) })).filter((r): r is typeof r & { i: number } => r.i !== undefined), [rows, indexOf]);

  // the dots
  useEffect(() => {
    const lf = leaflet.current;
    if (!ready || !lf || !places || !rows) return;
    lf.layer.clearLayers();
    const bounds: [number, number][] = [];
    const dots = placed.map((r) => {
      const at: [number, number] = [places.lat[r.i], places.lon[r.i]];
      bounds.push(at);
      const fill = valueColour(field, r.value, model);
      const dot = lf.L.circleMarker(at, { renderer: lf.renderer, radius: 6, weight: 1.5, color: "#ffffff", fillColor: fill, fillOpacity: 0.9 });
      return dot.bindPopup(() => popup(r.plot, places.names?.[r.i] || r.plot, colour, r.value));
    });
    // Many plots are grouped, as on the project's map, and placed a little at a time so the page keeps answering
    if (dots.length >= CLUSTER_FROM) {
      lf.L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: 16,
        maxClusterRadius: 60,
        iconCreateFunction: (cluster) => clusterIcon(lf.L, cluster, language, t),
      })
        .addTo(lf.layer)
        .addLayers(dots);
    } else {
      for (const dot of dots) lf.layer.addLayer(dot);
    }
    if (bounds.length) lf.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places, placed]);

  const popup = (plot: string, label: string, field: string | null, value: string | null) => {
    const root = document.createElement("div");
    root.style.font = "14px/1.4 Roboto, sans-serif";
    const title = document.createElement("strong");
    title.textContent = t("map.popupPlot", { plot: label });
    root.appendChild(title);
    if (field) {
      const line = document.createElement("div");
      line.textContent = `${field}: ${value ?? t("analysis.noAnswer")}`;
      root.appendChild(line);
    }
    if (plotLinks) {
      const link = document.createElement("a");
      const path = pathFor({ name: "plot", projectId, plot });
      link.href = path;
      link.textContent = t("map.openPlot");
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(path);
      });
      root.appendChild(link);
    }
    return root;
  };

  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of placed) counts.set(r.value ?? "", (counts.get(r.value ?? "") ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, LEGEND);
  }, [placed]);

  return (
    <Box sx={{ position: "relative", height: "100%", minHeight: 320 }}>
      <Box ref={element} sx={{ position: "absolute", inset: 0 }} aria-label={t("analysis.map.label")} role="region" />
      {(!places || !rows) && !error && <LinearProgress sx={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1000 }} />}
      {error ? (
        <Box sx={{ position: "absolute", inset: 0, p: 2, zIndex: 1000, bgcolor: "background.paper" }}>
          <ErrorAlert error={error} />
        </Box>
      ) : null}
      {places && rows && (
        <Box
          sx={{
            position: "absolute",
            left: 10,
            bottom: 24,
            zIndex: 1000,
            bgcolor: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(4px)",
            borderRadius: 2,
            boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
            px: 1.5,
            py: 1,
            maxWidth: 260,
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
            {placed.length ? t("analysis.map.count", { count: formatNumber(placed.length, language) }) : t("analysis.map.none")}
          </Typography>
          {field &&
            legend.map(([value, n]) => (
              <Box key={value} sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 12 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: valueColour(field, value || null, model), flexShrink: 0 }} />
                <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{value || t("analysis.noAnswer")}</Box>
                <Box sx={{ color: "text.secondary" }}>{formatNumber(n, language)}</Box>
              </Box>
            ))}
        </Box>
      )}
    </Box>
  );
}
