import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
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
import PublicIcon from "@mui/icons-material/Public";
import RemoveIcon from "@mui/icons-material/Remove";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import type { MapController, UiState } from "../controller";

export function MapArea({ controller, state }: { controller: MapController; state: UiState }) {
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
    <Box component="main" sx={{ position: "relative", flex: 1, minWidth: 0 }}>
      <Box ref={mapRef} data-testid="map" sx={{ position: "absolute", inset: 0, bgcolor: "#1b2026" }} />

      {!state.loaded && !state.banner && (
        <CircularProgress aria-label="Loading plots" sx={{ position: "absolute", top: "50%", left: "50%", mt: -2.5, ml: -2.5, zIndex: 1000 }} />
      )}

      {state.banner && (
        <Alert severity={state.banner.severity} variant="filled" role="status" data-testid="banner"
          onClose={state.banner.dismissible ? controller.dismissBanner : undefined}
          sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
            width: "max-content", maxWidth: "min(640px, calc(100% - 140px))", boxShadow: 3 }}>
          {state.banner.text}
        </Alert>
      )}

      <Paper elevation={3} sx={{ position: "absolute", top: 12, right: 12, zIndex: 1000, display: "flex", flexDirection: "column" }}>
        <MapButton title="Zoom in" onClick={() => controller.zoomBy(1)}><AddIcon /></MapButton>
        <MapButton title="Zoom out" onClick={() => controller.zoomBy(-1)}><RemoveIcon /></MapButton>
        <Divider />
        <MapButton title="Show all plots" onClick={controller.fitAll} testId="fit-all"><ZoomOutMapIcon /></MapButton>
        <MapButton title="Center on the selected plot" onClick={controller.centerActive} disabled={!state.activeId} testId="center-active"><MyLocationIcon /></MapButton>
        <Divider />
        <MapButton title="Map layers" onClick={(e) => setLayersAnchor(e.currentTarget)} testId="layers"><LayersOutlinedIcon /></MapButton>
      </Paper>
      <Menu anchorEl={layersAnchor} open={!!layersAnchor} onClose={() => setLayersAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        {state.baseLayers.map((name) => (
          <MenuItem key={name} selected={name === state.baseLayer}
            onClick={() => { controller.setBaseLayer(name); setLayersAnchor(null); }}>
            <ListItemIcon>{name === state.baseLayer && <CheckIcon fontSize="small" />}</ListItemIcon>
            {name}
          </MenuItem>
        ))}
      </Menu>

      {state.viewerType === "google_earth_web" && (
        <Chip icon={<PublicIcon />} label="Google Earth Web follows the selected plot" data-testid="gew-badge"
          sx={{ position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
            bgcolor: "background.paper", boxShadow: 3, "& .MuiChip-icon": { color: "primary.main" } }} />
      )}
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
