import { useState, type ReactElement } from "react";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import PublicIcon from "@mui/icons-material/Public";
import PublicOffIcon from "@mui/icons-material/PublicOff";
import SyncIcon from "@mui/icons-material/Sync";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import type { MapController, UiState } from "../controller";

/**
 * Live state of the Google Earth Web window ("Plots map + Google Earth Web" viewer), with
 * the actions a user needs when it is out of step: reopen / re-sync it, arrange windows.
 */
export function GewChip({ controller, state }: { controller: MapController; state: UiState }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const gew = state.gew;
  const active = state.activeId;
  const { label, icon, color, attention } = describe(gew, active);

  return (
    <>
      <Chip icon={icon} label={label} color={color} data-testid="gew-badge" data-state={gew?.state ?? "UNKNOWN"}
        onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu"
        sx={{
          position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
          maxWidth: "calc(100% - 140px)", boxShadow: 3,
          ...(color === "default" ? { bgcolor: "background.paper", "& .MuiChip-icon": { color: "primary.main" } } : {}),
          ...(attention ? { animation: "ce-pulse 1.6s ease-in-out 2" } : {}),
          "@keyframes ce-pulse": { "50%": { transform: "translateX(-50%) scale(1.06)" } },
        }} />
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }} transformOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <MenuItem disabled={!active} data-testid="gew-show"
          onClick={() => { controller.showActiveInGoogleEarthWeb(); setAnchor(null); }}>
          <ListItemIcon><SyncIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={active ? `Show plot ${active} in Google Earth Web` : "Select a plot first"}
            secondary={gew?.state === "CLOSED" ? "Reopens the window" : undefined} />
        </MenuItem>
        <MenuItem data-testid="gew-arrange" disabled={!gew || gew.state === "CLOSED"}
          onClick={() => { controller.arrangeWindows(); setAnchor(null); }}>
          <ListItemIcon><ViewQuiltIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Arrange windows" secondary="Side by side, or on a second screen" />
        </MenuItem>
      </Menu>
    </>
  );
}

function describe(gew: UiState["gew"], activeId: string | null): {
  label: string; icon: ReactElement; color: "default" | "warning" | "error"; attention: boolean;
} {
  const busy = <CircularProgress size={14} sx={{ ml: "8px !important" }} />;
  if (!gew) return { label: "Google Earth Web", icon: <PublicIcon />, color: "default", attention: false };
  switch (gew.state) {
    case "OPENING":
      return { label: "Opening Google Earth Web…", icon: busy, color: "default", attention: false };
    case "MOVING":
      return { label: gew.plotId ? `Google Earth Web: moving to plot ${gew.plotId}…` : "Google Earth Web: moving…", icon: busy, color: "default", attention: false };
    case "ERROR":
      return { label: "Google Earth Web: " + (gew.message ?? "error") + " - click to retry", icon: <ErrorOutlineIcon />, color: "error", attention: true };
    case "CLOSED":
      return activeId
        ? { label: "Google Earth Web window is closed - click to reopen", icon: <PublicOffIcon />, color: "warning", attention: true }
        : { label: "Google Earth Web opens when you select a plot", icon: <PublicIcon />, color: "default", attention: false };
    case "READY":
    default:
      if (!gew.plotId) return { label: "Google Earth Web ready - select a plot", icon: <PublicIcon />, color: "default", attention: false };
      if (activeId && gew.plotId !== activeId) {
        return { label: `Google Earth Web shows plot ${gew.plotId} - click to show ${activeId}`, icon: <SyncIcon />, color: "warning", attention: true };
      }
      return { label: `Google Earth Web: plot ${gew.plotId}`, icon: <PublicIcon />, color: "default", attention: false };
  }
}
