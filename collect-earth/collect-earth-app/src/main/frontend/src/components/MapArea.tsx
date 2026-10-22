import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import RemoveIcon from "@mui/icons-material/Remove";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import type { MapController, UiState } from "../controller";
import { GewChip } from "./GewChip";
import { isMessageKey, useT, type Translate } from "../i18n";

/** {@code hidden}: kept mounted, so the map engine survives the one-pane layout of App. */
export function MapArea({ controller, state, hidden }: { controller: MapController; state: UiState; hidden?: boolean }) {
  const t = useT();
  const mapRef = useRef<HTMLDivElement>(null);
  const [layersAnchor, setLayersAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    controller.start(mapRef.current!);
  }, [controller]);

  // Any container size change (window, sidebar, form panel) -> tell the engine, at most
  // once per frame. Changes the controller already handled are no-ops in the engine.
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(controller.resizeMap);
    });
    observer.observe(mapRef.current!);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [controller]);

  return (
    <Box component="main" sx={{ position: "relative", flex: 1, minWidth: 0, display: hidden ? "none" : undefined }}>
      <Box ref={mapRef} data-testid="map" sx={{ position: "absolute", inset: 0, bgcolor: "#1b2026" }} />

      {!state.loaded && !state.banner && (
        <CircularProgress aria-label={t("map.loading")} sx={{ position: "absolute", top: "50%", left: "50%", mt: -2.5, ml: -2.5, zIndex: 1000 }} />
      )}

      {state.banner && (
        <Alert severity={state.banner.severity} variant="filled" role="status" data-testid="banner"
          onClose={state.banner.dismissible ? controller.dismissBanner : undefined}
          sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
            width: "max-content", maxWidth: "min(640px, calc(100% - 140px))", boxShadow: 3 }}>
          {bannerText(state.banner, t)}
        </Alert>
      )}

      <Paper elevation={3} sx={{ position: "absolute", top: 12, right: 12, zIndex: 1000, display: "flex", flexDirection: "column" }}>
        <MapButton title={t("map.zoomIn")} onClick={() => controller.zoomBy(1)}><AddIcon /></MapButton>
        <MapButton title={t("map.zoomOut")} onClick={() => controller.zoomBy(-1)}><RemoveIcon /></MapButton>
        <Divider />
        <MapButton title={t("map.fitAll")} onClick={controller.fitAll} testId="fit-all"><ZoomOutMapIcon /></MapButton>
        <MapButton title={t("map.centerActive")} onClick={controller.centerActive} disabled={!state.activeId} testId="center-active"><MyLocationIcon /></MapButton>
        <Divider />
        <MapButton title={t("map.layers")} onClick={(e) => setLayersAnchor(e.currentTarget)} testId="layers"><LayersOutlinedIcon /></MapButton>
      </Paper>
      <Menu anchorEl={layersAnchor} open={!!layersAnchor} onClose={() => setLayersAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        {state.baseLayers.map((name) => (
          <MenuItem key={name} selected={name === state.baseLayer}
            onClick={() => { controller.setBaseLayer(name); setLayersAnchor(null); }}>
            <ListItemIcon>{name === state.baseLayer && <CheckIcon fontSize="small" />}</ListItemIcon>
            {isMessageKey("layer." + name) ? t(("layer." + name) as Parameters<Translate>[0]) : name}
          </MenuItem>
        ))}
      </Menu>

      {state.viewerType === "google_earth_web" && <GewChip controller={controller} state={state} />}
    </Box>
  );
}

function MapButton({ title, onClick, disabled, testId, children }: {
  title: string; onClick: (e: MouseEvent<HTMLElement>) => void; disabled?: boolean; testId?: string; children: ReactNode;
}) {
  return (
    <Tooltip title={title} placement="left">
      {/* span: tooltips need an enabled wrapper around disabled buttons */}
      <span>
        <IconButton onClick={onClick} disabled={disabled} aria-label={title} data-testid={testId} sx={{ borderRadius: 0 }}>{children}</IconButton>
      </span>
    </Tooltip>
  );
}

/** Banner text: a translated key (params that are keys are translated too), or a server text. */
function bannerText(banner: NonNullable<UiState["banner"]>, t: Translate): string {
  if (!banner.key) return banner.text ?? "";
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(banner.params ?? {})) params[name] = isMessageKey(value) ? t(value) : value;
  return t(banner.key, params);
}
