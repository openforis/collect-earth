import type { MouseEvent as ReactMouseEvent } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import type { MapController, UiState } from "../controller";
import { STATUS_LABELS, type PlotStatus } from "../types";

const STATUS_CHIP: Record<PlotStatus, "error" | "warning" | "success"> = { empty: "error", partial: "warning", saved: "success" };
const MIN_WIDTH = 380;

export function FormPanel({ controller, state }: { controller: MapController; state: UiState }) {
  const id = state.activeId!;
  const status = state.statuses[id] ?? "empty";
  const prev = controller.neighbourOf(id, -1);
  const next = controller.neighbourOf(id, 1);

  // Drag the left edge to resize; the width is remembered per viewer.
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    document.body.classList.add("ce-resizing");
    let width = state.formWidth;
    const onMove = (ev: MouseEvent) => {
      width = Math.max(MIN_WIDTH, Math.min(Math.round(window.innerWidth - ev.clientX), Math.round(window.innerWidth * 0.75)));
      controller.setFormWidth(width, false);
    };
    const onUp = () => {
      document.body.classList.remove("ce-resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      controller.setFormWidth(width, true);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <Paper square elevation={0} component="section" aria-label="Plot form" data-testid="form-panel" sx={{
      position: "relative", width: state.formWidth, minWidth: MIN_WIDTH, maxWidth: "75%",
      display: "flex", flexDirection: "column", borderLeft: 1, borderColor: "divider", zIndex: 1100,
    }}>
      <Box onMouseDown={startResize} title="Drag to resize" data-testid="resize-handle" sx={{
        position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1,
        "&:hover, .ce-resizing &": { bgcolor: "primary.main", opacity: 0.35 },
      }} />
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Tooltip title="Previous plot in the list">
          <span><IconButton onClick={() => controller.step(-1)} disabled={!prev} aria-label="Previous plot" data-testid="form-prev"><ChevronLeftIcon /></IconButton></span>
        </Tooltip>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: 1, minWidth: 0, px: 0.5 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }} data-testid="form-title">Plot {id}</Typography>
          <Chip size="small" variant="outlined" color={STATUS_CHIP[status]} label={STATUS_LABELS[status]} data-testid="form-status" />
        </Stack>
        <Tooltip title="Next plot in the list">
          <span><IconButton onClick={() => controller.step(1)} disabled={!next} aria-label="Next plot" data-testid="form-next"><ChevronRightIcon /></IconButton></span>
        </Tooltip>
        <Tooltip title="Close the form (Esc)">
          <IconButton onClick={controller.closeForm} aria-label="Close the form" data-testid="form-close"><CloseIcon /></IconButton>
        </Tooltip>
      </Stack>
      {/* key: a fresh iframe per plot, so a stale form can never post into the next one */}
      <Box component="iframe" key={state.formUrl} src={state.formUrl!} title="Plot data entry form" data-testid="form-frame"
        sx={{ flex: 1, border: 0, bgcolor: "#fff", ".ce-resizing &": { pointerEvents: "none" } }} />
    </Paper>
  );
}
