import { useMemo } from "react";
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
import FilterListIcon from "@mui/icons-material/FilterList";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import SearchIcon from "@mui/icons-material/Search";
import type { MapController, UiState } from "../controller";
import { countStatuses, plotLabel } from "../plots";
import { useT } from "../i18n";
import { HANDS_FOCUS } from "../shortcuts";
import { ImageryBar } from "./ImageryBar";
import type { PlotStatus } from "../types";

const STATUS_CHIP: Record<PlotStatus, "error" | "warning" | "success"> = { empty: "error", partial: "warning", saved: "success" };

/**
 * The form of the plot open, over the whole panel (the one-pane layout of App).
 * {@code hidden}: kept mounted, so the form keeps what was typed while the plot list is shown instead.
 * {@code onShowList}: shows the plot list, from a button in the header.
 */
export function FormPanel({ controller, state, hidden, onShowList }: {
  controller: MapController; state: UiState; hidden?: boolean; onShowList: () => void;
}) {
  const t = useT();
  const id = state.activeId!;
  const status = state.statuses[id] ?? "empty";
  const prev = controller.neighbourOf(id, -1);
  const next = controller.neighbourOf(id, 1);
  // The work done, otherwise only in the list, which is hidden while the form is shown
  const counts = useMemo(() => countStatuses(state.order, state.statuses), [state.order, state.statuses]);
  const pct = counts.total ? Math.round((counts.saved * 100) / counts.total) : 0;
  // The arrows go through the list as filtered, which is remembered from one session to the next: shown, and undone here
  const filterLabel = state.filter !== "all" ? t(`filter.${state.filter}`) : null;
  // and so does the search, which stays when the list is hidden and a plot opened from it
  const query = state.query.trim();

  return (
    <Paper square elevation={0} component="section" aria-label={t("form.label")} data-testid="form-panel" sx={{
      position: "relative", zIndex: 1100, borderLeft: 1, borderColor: "divider",
      display: hidden ? "none" : "flex", flexDirection: "column", flex: 1, minWidth: 0,
    }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", p: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <Tooltip title={t("showList")}>
          <IconButton size="small" onClick={onShowList} aria-label={t("showList")} data-testid="show-list"><FormatListBulletedIcon /></IconButton>
        </Tooltip>
        <Tooltip title={t("form.prev")}>
          <span><IconButton size="small" onClick={() => controller.step(-1)} disabled={!prev} aria-label={t("form.prev")} data-testid="form-prev" {...{ [HANDS_FOCUS]: true }}><ChevronLeftIcon /></IconButton></span>
        </Tooltip>
        {/* The plot on its line, never squeezed by the rest (the panel may be 380 px wide), which goes on a line below */}
        <Stack sx={{ flex: 1, minWidth: 0, px: 0.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, lineHeight: 1.4 }} data-testid="form-title">{t("form.title", { id: plotLabel(state.labels, id) })}</Typography>
            <Chip size="small" variant="outlined" color={STATUS_CHIP[status]} label={t(`status.${status}`)} data-testid="form-status" />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, minHeight: 20 }}>
            <Tooltip title={t("progress", { saved: counts.saved, total: counts.total, pct })}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: "none", lineHeight: 1.4 }} data-testid="form-progress">
                {counts.saved}/{counts.total}
              </Typography>
            </Tooltip>
            {filterLabel && (
              <Tooltip title={t("form.filtered", { filter: filterLabel })}>
                <Chip size="small" color="primary" variant="outlined" icon={<FilterListIcon />} label={filterLabel}
                  onDelete={() => controller.setFilter("all")} data-testid="form-filter"
                  sx={{ minWidth: 0, height: 20, fontSize: "0.75rem", "& .MuiChip-icon, & .MuiChip-deleteIcon": { fontSize: 14 } }} />
              </Tooltip>
            )}
            {query && (
              <Tooltip title={t("form.searched", { query })}>
                <Chip size="small" color="primary" variant="outlined" icon={<SearchIcon />} label={query}
                  onDelete={() => controller.setQuery("")} data-testid="form-search"
                  sx={{ minWidth: 0, height: 20, fontSize: "0.75rem", "& .MuiChip-icon, & .MuiChip-deleteIcon": { fontSize: 14 } }} />
              </Tooltip>
            )}
          </Stack>
        </Stack>
        <Tooltip title={t("form.next")}>
          <span><IconButton size="small" onClick={() => controller.step(1)} disabled={!next} aria-label={t("form.next")} data-testid="form-next" {...{ [HANDS_FOCUS]: true }}><ChevronRightIcon /></IconButton></span>
        </Tooltip>
        <Tooltip title={t("form.close")}>
          <IconButton size="small" onClick={controller.closeForm} aria-label={t("form.close")} data-testid="form-close"><CloseIcon /></IconButton>
        </Tooltip>
      </Stack>
      <ImageryBar controller={controller} state={state} />
      {/* key: a fresh iframe per plot, so a stale form can never post into the next one */}
      <Box component="iframe" key={state.formUrl} src={state.formUrl!} title={t("form.frame")} data-testid="form-frame"
        sx={{ flex: 1, border: 0, bgcolor: "background.paper" }} />
    </Paper>
  );
}
