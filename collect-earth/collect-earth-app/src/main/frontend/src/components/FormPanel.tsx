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
import MenuIcon from "@mui/icons-material/Menu";
import type { MapController, UiState } from "../controller";
import { useT } from "../i18n";
import { useUiScale } from "../uiScale";
import type { PlotStatus } from "../types";

const STATUS_CHIP: Record<PlotStatus, "error" | "warning" | "success"> = { empty: "error", partial: "warning", saved: "success" };
const MIN_WIDTH = 380;

/**
 * {@code fill}: the form takes all the room left (the one-pane layout of App), without a resize handle.
 * {@code hidden}: kept mounted, so the form keeps what was typed while the plot list is shown instead.
 * {@code onShowList}: a button to show the plot list, in the header (the one-pane layout has no list rail).
 */
export function FormPanel({ controller, state, fill, hidden, onShowList }: {
  controller: MapController; state: UiState; fill?: boolean; hidden?: boolean; onShowList?: () => void;
}) {
  const t = useT();
  const minWidth = Math.round(MIN_WIDTH * useUiScale());
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
      width = Math.max(minWidth, Math.min(Math.round(window.innerWidth - ev.clientX), Math.round(window.innerWidth * 0.75)));
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
    <Paper square elevation={0} component="section" aria-label={t("form.label")} data-testid="form-panel" sx={{
      position: "relative", zIndex: 1100, borderLeft: 1, borderColor: "divider",
      display: hidden ? "none" : "flex", flexDirection: "column",
      ...(fill ? { flex: 1, minWidth: 0 } : { width: state.formWidth, minWidth, maxWidth: "75%" }),
    }}>
      {!fill && <Box onMouseDown={startResize} title={t("form.resize")} data-testid="resize-handle" sx={{
        position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1,
        "&:hover, .ce-resizing &": { bgcolor: "primary.main", opacity: 0.35 },
      }} />}
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", p: fill ? 0.5 : 1, borderBottom: 1, borderColor: "divider" }}>
        {onShowList && (
          <Tooltip title={t("showList")}>
            <IconButton onClick={onShowList} aria-label={t("showList")} data-testid="show-list"><MenuIcon /></IconButton>
          </Tooltip>
        )}
        <Tooltip title={t("form.prev")}>
          <span><IconButton onClick={() => controller.step(-1)} disabled={!prev} aria-label={t("form.prev")} data-testid="form-prev"><ChevronLeftIcon /></IconButton></span>
        </Tooltip>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: 1, minWidth: 0, px: 0.5 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }} data-testid="form-title">{t("form.title", { id })}</Typography>
          <Chip size="small" variant="outlined" color={STATUS_CHIP[status]} label={t(`status.${status}`)} data-testid="form-status" />
        </Stack>
        <Tooltip title={t("form.next")}>
          <span><IconButton onClick={() => controller.step(1)} disabled={!next} aria-label={t("form.next")} data-testid="form-next"><ChevronRightIcon /></IconButton></span>
        </Tooltip>
        <Tooltip title={t("form.close")}>
          <IconButton onClick={controller.closeForm} aria-label={t("form.close")} data-testid="form-close"><CloseIcon /></IconButton>
        </Tooltip>
      </Stack>
      {/* key: a fresh iframe per plot, so a stale form can never post into the next one */}
      <Box component="iframe" key={state.formUrl} src={state.formUrl!} title={t("form.frame")} data-testid="form-frame"
        sx={{ flex: 1, border: 0, bgcolor: "background.paper", ".ce-resizing &": { pointerEvents: "none" } }} />
    </Paper>
  );
}
