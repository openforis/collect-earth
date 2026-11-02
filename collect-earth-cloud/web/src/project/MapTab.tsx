import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Refresh from "@mui/icons-material/Refresh";
import type * as Leaflet from "leaflet";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getMapPlots, MAP_STATUSES, type MapPlots, type MapStatus, type MapTiles } from "../api";
import { useApp } from "../appContext";
import { AsOf } from "../components/PeopleCharts";
import { ErrorAlert } from "../components/ErrorAlert";
import { formatDate, formatNumber } from "../format";
import { useT, type Translate } from "../i18n";
import { attributionHtml, boundsOf, CLUSTER_FROM, filesOffMap, plotPopup, shownIndexes, STATUS_STYLE, statusDrawnKey, statusLabelKey, symbolSvg } from "../mapView";
import { navigate, pathFor } from "../router";
import { loadLeaflet, type LeafletModule } from "./leaflet";

/** A circle marker that knows which plot it is. */
type PlotMarker = Leaflet.CircleMarker & { plotIndex: number };

/** The legend's symbol, drawn as on the map (an SVG made from the constant styles only, no data). */
function Symbol({ status }: { status: MapStatus }) {
  return <Box component="span" sx={{ display: "inline-flex", verticalAlign: "middle" }} dangerouslySetInnerHTML={{ __html: symbolSvg(status) }} />;
}

/** A plot's popup, built as DOM (no HTML from data): its id, status, people (coordinators) and a link to its page. */
function popupElement(t: Translate, map: MapPlots, index: number, projectId: string): HTMLElement {
  const popup = plotPopup(map, index, projectId);
  const root = document.createElement("div");
  root.style.font = "14px/1.4 Roboto, sans-serif";
  const title = document.createElement("strong");
  title.textContent = t("map.popupPlot", { plot: popup.plot });
  root.appendChild(title);
  const status = document.createElement("div");
  status.style.display = "flex";
  status.style.alignItems = "center";
  status.style.gap = "4px";
  const symbol = document.createElement("span");
  symbol.innerHTML = symbolSvg(popup.status, 16);
  status.append(symbol, document.createTextNode(t(statusLabelKey(popup.status))));
  root.appendChild(status);
  if (popup.people !== null) {
    const people = document.createElement("div");
    people.textContent = popup.people.length > 0 ? t("map.popupPeople", { people: popup.people.join(", ") }) : t("map.popupNobody");
    root.appendChild(people);
  }
  const link = document.createElement("a");
  link.href = popup.path;
  link.textContent = t("map.openPlot");
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(popup.path);
  });
  root.appendChild(link);
  return root;
}

/** The map itself: OpenStreetMap (or the server's) tiles, a circle per plot on a canvas, grouped from CLUSTER_FROM plots. */
function PlotMap({
  projectId,
  data,
  shown,
  tiles,
  label,
  onProgress,
}: {
  projectId: string;
  data: MapPlots;
  shown: ReadonlySet<MapStatus>;
  tiles: MapTiles;
  label: string;
  /** The plots shown, whether grouped, and how many are placed so far (null once all are). */
  onProgress: (shown: number, clustered: boolean, placed: number | null) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const element = useRef<HTMLDivElement | null>(null);
  const leaflet = useRef<{ L: LeafletModule; map: Leaflet.Map; renderer: Leaflet.Canvas } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  // The latest translation and language for popups and cluster labels made later.
  const latest = useRef({ t, language });
  latest.current = { t, language };
  // The map is fitted to the plots when they are loaded, not when a status is hidden or shown.
  const fitted = useRef<MapPlots | null>(null);

  useEffect(() => {
    let gone = false;
    loadLeaflet().then(
      (L) => {
        if (gone || !element.current) return;
        const renderer = L.canvas({ padding: 0.5 });
        const map = L.map(element.current, { preferCanvas: true, renderer, worldCopyJump: true, minZoom: 1, maxZoom: tiles.maxZoom });
        map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
        // OpenStreetMap's tile usage policy: its attribution shown, the browser's referrer sent, no tiles fetched ahead.
        L.tileLayer(tiles.url, { attribution: attributionHtml(tiles), maxZoom: tiles.maxZoom, referrerPolicy: "strict-origin-when-cross-origin", keepBuffer: 1 }).addTo(map);
        map.setView([0, 0], 2);
        leaflet.current = { L, map, renderer };
        setReady(true);
      },
      (error: unknown) => !gone && setFailed(error),
    );
    return () => {
      gone = true;
      leaflet.current?.map.remove();
      leaflet.current = null;
    };
  }, [tiles]);

  useEffect(() => {
    const current = leaflet.current;
    if (!ready || !current) return;
    const { L, map, renderer } = current;
    const indexes = shownIndexes(data, shown);
    // One options object per status, shared by its markers.
    const options = MAP_STATUSES.map((status): Leaflet.CircleMarkerOptions => {
      const s = STATUS_STYLE[status];
      return { renderer, radius: s.radius, color: s.color, weight: s.weight, fillColor: s.color, fillOpacity: s.fillOpacity, dashArray: s.dashArray, opacity: 1 };
    });
    const markers: PlotMarker[] = new Array(indexes.length);
    for (let k = 0; k < indexes.length; k++) {
      const i = indexes[k];
      const marker = L.circleMarker([data.lat[i], data.lon[i]], options[data.status[i]]) as PlotMarker;
      marker.plotIndex = i;
      markers[k] = marker;
    }
    const clustered = indexes.length >= CLUSTER_FROM;
    let gone = false;
    if (fitted.current !== data) {
      fitted.current = data;
      const bounds = boundsOf(data, shownIndexes(data, new Set(MAP_STATUSES)));
      if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false });
      else map.setView([0, 0], 2);
    }
    let layer: Leaflet.FeatureGroup;
    let group: Leaflet.MarkerClusterGroup | null = null;
    if (clustered) {
      group = L.markerClusterGroup({
        // On the map, the plots are grouped a little at a time, so the page keeps answering.
        chunkedLoading: true,
        chunkProgress: (processed, total) => {
          if (!gone) onProgress(indexes.length, clustered, processed >= total ? null : processed);
        },
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: 16,
        maxClusterRadius: 60,
        // Grey, not a status colour: a group holds plots of any status.
        iconCreateFunction: (cluster) => {
          const n = cluster.getChildCount();
          const size = n < 100 ? 32 : n < 1000 ? 38 : n < 10000 ? 44 : 50;
          let text = String(n);
          try {
            text = new Intl.NumberFormat(latest.current.language, { notation: "compact" }).format(n);
          } catch {
            // the plain number
          }
          return L.divIcon({
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(33,33,33,0.8);border:2px solid #fff;color:#fff;font:600 12px/1 Roboto,sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box">${text}</div>`,
            className: "",
            iconSize: L.point(size, size),
          });
        },
      });
      layer = group;
    } else {
      layer = L.featureGroup(markers);
    }
    layer.on("click", (event: Leaflet.LeafletMouseEvent & { propagatedFrom?: PlotMarker }) => {
      const marker = (event.propagatedFrom ?? (event as unknown as { layer?: PlotMarker }).layer) as PlotMarker | undefined;
      if (!marker || typeof marker.plotIndex !== "number") return;
      L.popup({ maxWidth: 280 }).setLatLng(marker.getLatLng()).setContent(popupElement(latest.current.t, data, marker.plotIndex, projectId)).openOn(map);
    });
    layer.addTo(map);
    if (group) {
      onProgress(indexes.length, clustered, 0);
      group.addLayers(markers);
    } else {
      onProgress(indexes.length, clustered, null);
    }
    return () => {
      gone = true;
      map.closePopup();
      layer.remove();
    };
    // onProgress is the parent's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, shown, projectId]);

  if (failed) return <ErrorAlert error={failed} />;
  return (
    <Box
      ref={element}
      role="region"
      aria-label={label}
      sx={{ height: { xs: 380, md: "62vh" }, minHeight: 320, width: 1, borderRadius: 1, border: 1, borderColor: "divider", zIndex: 0, "& .leaflet-container": { fontFamily: "inherit" } }}
    />
  );
}

/**
 * The map of progress (coordinators and reviewers): every plot of the plot files at its latitude and
 * longitude, drawn by its status, with filters by plot file and (coordinators) by person. Everything
 * the map shows is also in the table under it, and one plot is found with the search box at the top.
 */
export function MapTab({ projectId, coordinator }: { projectId: string; coordinator: boolean }) {
  const t = useT();
  const { info, language } = useApp();
  const headingId = useId();
  const tableId = useId();
  const [file, setFile] = useState("");
  const [person, setPerson] = useState("");
  const [shown, setShown] = useState<ReadonlySet<MapStatus>>(() => new Set(MAP_STATUSES));
  const [data, setData] = useState<MapPlots | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<{ loaded: number; total: number } | null>({ loaded: 0, total: 0 });
  const [reload, setReload] = useState(0);
  const [drawn, setDrawn] = useState<{ shown: number; clustered: boolean; placed: number | null } | null>(null);
  // The menus keep the whole lists of the first answer (an answer for one person lists everyone too).
  const [menus, setMenus] = useState<{ files: MapPlots["files"]; people: string[] | null } | null>(null);

  useEffect(() => {
    let stopped = false;
    setLoading({ loaded: 0, total: 0 });
    setError(null);
    getMapPlots(projectId, { file, person }, (loaded, total) => !stopped && setLoading({ loaded, total }), () => stopped).then(
      (map) => {
        if (stopped) return;
        setData(map);
        setMenus({ files: map.files, people: map.people });
        setLoading(null);
      },
      (e: unknown) => {
        if (stopped) return;
        setError(e);
        setLoading(null);
      },
    );
    return () => {
      stopped = true;
    };
  }, [projectId, file, person, reload]);

  const offMap = useMemo(() => (data ? filesOffMap(data) : []), [data]);
  const toggle = (status: MapStatus) =>
    setShown((was) => {
      const next = new Set(was);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  const n = (value: number) => formatNumber(value, language);
  const totalPlots = data ? MAP_STATUSES.reduce((sum, s) => sum + data.counts[s], 0) : 0;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" component="section" aria-labelledby={headingId} sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" id={headingId} gutterBottom>
          {t("map.heading")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("map.intro")}
        </Typography>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start", mb: 2 }}>
          <TextField
            select
            size="small"
            label={t("map.file")}
            name="file"
            value={file}
            onChange={(e) => setFile(e.target.value)}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ width: { xs: 1, sm: 280 } }}
          >
            <MenuItem value="">{t("map.allFiles")}</MenuItem>
            {(menus?.files ?? []).map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.filename}
              </MenuItem>
            ))}
          </TextField>
          {coordinator && (
            <TextField
              select
              size="small"
              label={t("map.person")}
              name="person"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              helperText={t("map.personHelp")}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              sx={{ width: { xs: 1, sm: 280 } }}
            >
              <MenuItem value="">{t("map.everyone")}</MenuItem>
              {(menus?.people ?? []).map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button startIcon={<Refresh />} onClick={() => setReload((r) => r + 1)} disabled={loading !== null}>
            {t("map.reload")}
          </Button>
        </Box>

        {loading !== null && (
          <Box sx={{ mb: 2 }} role="status">
            <Typography variant="body2" color="text.secondary">
              {loading.total > 0 ? t("map.loading", { loaded: n(loading.loaded), total: n(loading.total) }) : t("map.loadingStart")}
            </Typography>
            <LinearProgress variant={loading.total > 0 ? "determinate" : "indeterminate"} value={loading.total > 0 ? (100 * loading.loaded) / loading.total : undefined} />
          </Box>
        )}
        {error !== null && <ErrorAlert error={error} onRetry={() => setReload((r) => r + 1)} />}

        {data && (
          <Stack spacing={1.5}>
            <AsOf asOf={data.asOf} />
            {data.unsupportedSrs !== null && <Alert severity="info">{t("map.unsupportedSrs", { srs: data.unsupportedSrs })}</Alert>}
            {data.figures === null ? (
              <Alert severity="info">{t("map.noFigures")}</Alert>
            ) : data.figures.stale && data.figures.computedAt !== null ? (
              <Typography variant="body2" color="text.secondary">
                {t("map.staleFigures", { time: formatDate(data.figures.computedAt, language) })}
              </Typography>
            ) : null}
            {data.total === 0 && data.unsupportedSrs === null && <Alert severity="info">{t("map.noPlots")}</Alert>}
            {data.total > 0 && (
              <>
                <PlotMap projectId={projectId} data={data} shown={shown} tiles={info.mapTiles} label={t("map.label")} onProgress={(count, clustered, placed) => setDrawn({ shown: count, clustered, placed })} />
                {drawn && (
                  <Typography variant="body2" color="text.secondary" role="status">
                    {drawn.placed !== null
                      ? t("map.placing", { placed: n(drawn.placed), total: n(drawn.shown) })
                      : `${t("map.shown", { shown: n(drawn.shown), total: n(data.total) })}${drawn.clustered ? ` ${t("map.clustered")}` : ""}`}
                  </Typography>
                )}
              </>
            )}
          </Stack>
        )}
      </Paper>

      {data && (
        <Paper variant="outlined" component="section" aria-labelledby={tableId} sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h2" id={tableId} gutterBottom>
            {t("map.legend")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("map.legendHelp")}
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">{t("map.col.show")}</TableCell>
                  <TableCell>{t("map.col.status")}</TableCell>
                  <TableCell>{t("map.col.drawn")}</TableCell>
                  <TableCell align="right">{t("map.col.plots")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {MAP_STATUSES.map((status) => (
                  <TableRow key={status}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={shown.has(status)}
                        onChange={() => toggle(status)}
                        slotProps={{ input: { "aria-label": t("map.showStatus", { status: t(statusLabelKey(status)) }) } }}
                      />
                    </TableCell>
                    <TableCell component="th" scope="row">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Symbol status={status} />
                        {t(statusLabelKey(status))}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>{t(statusDrawnKey(status))}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {n(data.counts[status])}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell />
                  <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                    {t("map.total")}
                  </TableCell>
                  <TableCell />
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    {n(totalPlots)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          {data.notOnMap > 0 && (
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              {t("map.notOnMap", { n: n(data.notOnMap) })}
            </Typography>
          )}
          {data.unsupportedSrs === null && offMap.length > 0 && (
            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
              {offMap.map((f) => (
                <li key={f.id}>
                  <Typography variant="body2">
                    {coordinator ? (
                      <a href={pathFor({ name: "plotFile", projectId, fileId: f.id })} onClick={(e) => { if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); navigate(pathFor({ name: "plotFile", projectId, fileId: f.id })); } }}>
                        {f.filename}
                      </a>
                    ) : (
                      f.filename
                    )}
                    {": "}
                    {t("map.offMapFile", { n: n(f.plots - f.onMap), total: n(f.plots) })}
                  </Typography>
                </li>
              ))}
            </Box>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {t("map.findOne")}
          </Typography>
        </Paper>
      )}
    </Stack>
  );
}
