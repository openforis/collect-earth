import { useState, type ReactElement } from "react";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FlipToFrontIcon from "@mui/icons-material/FlipToFront";
import PublicIcon from "@mui/icons-material/Public";
import PublicOffIcon from "@mui/icons-material/PublicOff";
import SyncIcon from "@mui/icons-material/Sync";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import type { MapController, UiState } from "../controller";
import { isMessageKey, useT, type Translate } from "../i18n";

/**
 * Live state of the Google Earth Web window ("Plots map + Google Earth Web" viewer), with
 * the actions a user needs when it is out of step: reopen / re-sync it, arrange windows.
 */
export function GewChip({ controller, state }: { controller: MapController; state: UiState }) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const gew = state.gew;
  const active = state.activeId;
  const { label, icon, color, attention } = describe(gew, active, t);

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
          <ListItemText primary={active ? t("gew.show", { id: active }) : t("gew.selectFirst")}
            secondary={gew?.state === "CLOSED" ? t("gew.reopens") : undefined} />
        </MenuItem>
        <MenuItem data-testid="gew-arrange" disabled={!gew || gew.state === "CLOSED"}
          onClick={() => { controller.arrangeWindows(); setAnchor(null); }}>
          <ListItemIcon><ViewQuiltIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("gew.arrange")} secondary={t("gew.arrangeHint")} />
        </MenuItem>
        <MenuItem data-testid="gew-show-all" disabled={!gew || gew.state === "CLOSED"}
          onClick={() => { controller.showAllWindows(); setAnchor(null); }}>
          <ListItemIcon><FlipToFrontIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("gew.showAll")} secondary={t("gew.showAllHint")} />
        </MenuItem>
      </Menu>
    </>
  );
}

function describe(gew: UiState["gew"], activeId: string | null, t: Translate): {
  label: string; icon: ReactElement; color: "default" | "warning" | "error"; attention: boolean;
} {
  const busy = <CircularProgress size={14} sx={{ ml: "8px !important" }} />;
  if (!gew) return { label: t("gew.title"), icon: <PublicIcon />, color: "default", attention: false };
  switch (gew.state) {
    case "OPENING":
      return { label: t("gew.opening"), icon: busy, color: "default", attention: false };
    case "MOVING":
      return { label: gew.plotId ? t("gew.moving", { id: gew.plotId }) : t("gew.movingNoPlot"), icon: busy, color: "default", attention: false };
    case "WAITING":
      return { label: t("gew.waiting"), icon: <PublicOffIcon />, color: "warning", attention: true };
    case "ERROR": {
      // the server sends a message code (see GoogleEarthWebService); unknown codes are shown as is
      const code = "gew.msg." + (gew.message ?? "open_failed");
      return { label: t("gew.error", { message: isMessageKey(code) ? t(code) : gew.message ?? "" }), icon: <ErrorOutlineIcon />, color: "error", attention: true };
    }
    case "CLOSED":
      return activeId
        ? { label: t("gew.closed"), icon: <PublicOffIcon />, color: "warning", attention: true }
        : { label: t("gew.opensOnSelect"), icon: <PublicIcon />, color: "default", attention: false };
    case "READY":
    default:
      if (!gew.plotId) return { label: t("gew.readyNoPlot"), icon: <PublicIcon />, color: "default", attention: false };
      if (activeId && gew.plotId !== activeId) {
        return { label: t("gew.otherPlot", { shown: gew.plotId, active: activeId }), icon: <SyncIcon />, color: "warning", attention: true };
      }
      return { label: t("gew.plot", { id: gew.plotId }), icon: <PublicIcon />, color: "default", attention: false };
  }
}
