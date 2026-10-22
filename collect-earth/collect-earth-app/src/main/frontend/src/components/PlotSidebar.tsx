import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemButton from "@mui/material/ListItemButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import type { MapController, UiState } from "../controller";
import { countStatuses, visibleIds } from "../plots";
import { useT } from "../i18n";
import type { ListFilter, PlotStatus } from "../types";
import { Kbd, StatusDot } from "./common";
import { useUiScale } from "../uiScale";

export const SIDEBAR_WIDTH = 300;
export const RAIL_WIDTH = 56;
const ROW_HEIGHT = 40;

/**
 * The plot list, or a rail with a button to show it. {@code collapsed} / {@code onCollapsedChange} override the
 * remembered choice (with {@code collapsed} alone the list cannot be hidden) and {@code fill} makes the list take the
 * whole window (the one-pane layout of App).
 */
export function PlotSidebar({ controller, state, collapsed, onCollapsedChange, fill }: {
  controller: MapController; state: UiState;
  collapsed?: boolean; onCollapsedChange?: (collapsed: boolean) => void; fill?: boolean;
}) {
  const t = useT();
  const scale = useUiScale();
  const { order, statuses, filter, query, activeId, loaded } = state;
  const sidebarCollapsed = collapsed ?? state.sidebarCollapsed;
  const setCollapsed = onCollapsedChange ?? controller.setSidebarCollapsed;
  const canCollapse = collapsed === undefined || onCollapsedChange !== undefined;
  const counts = useMemo(() => countStatuses(order, statuses), [order, statuses]);
  const visible = useMemo(() => visibleIds(order, statuses, filter, query), [order, statuses, filter, query]);

  // Debounced search: typing stays responsive with thousands of plots
  const [text, setText] = useState(query);
  useEffect(() => {
    const t = window.setTimeout(() => controller.setQuery(text), 120);
    return () => window.clearTimeout(t);
  }, [text, controller]);

  if (sidebarCollapsed) {
    return (
      <Paper square elevation={0} sx={{ width: RAIL_WIDTH * scale, flexShrink: 0, borderRight: 1, borderColor: "divider", pt: 1, textAlign: "center", zIndex: 1100 }}>
        <Tooltip title={t("showList")} placement="right">
          <IconButton onClick={() => setCollapsed(false)} aria-label={t("showList")} data-testid="show-list"><MenuIcon /></IconButton>
        </Tooltip>
      </Paper>
    );
  }

  const pct = counts.total ? Math.round((counts.saved * 100) / counts.total) : 0;
  return (
    <Paper square elevation={0} component="aside" aria-label={t("plots")} sx={{
      width: fill ? "auto" : SIDEBAR_WIDTH * scale, flex: fill ? 1 : undefined, flexShrink: 0, display: "flex", flexDirection: "column",
      borderRight: 1, borderColor: "divider", zIndex: 1100,
    }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1, pt: 1.5, pb: 1 }}>
        {canCollapse && (
          <Tooltip title={t("hideList")}>
            <IconButton onClick={() => setCollapsed(true)} aria-label={t("hideList")} data-testid="hide-list"><MenuOpenIcon /></IconButton>
          </Tooltip>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h1" sx={{ lineHeight: 1.2 }}>{t("plots")}</Typography>
          <Typography variant="caption" color="text.secondary" data-testid="progress-text">
            {!loaded ? t("loading") : counts.total ? t("progress", { saved: counts.saved, total: counts.total, pct }) : t("noPlots")}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={1.5} sx={{ px: 2, pb: 1.5 }}>
        <LinearProgress variant="buffer" aria-label={t("completedPlots")}
          value={counts.total ? (counts.saved * 100) / counts.total : 0}
          valueBuffer={counts.total ? ((counts.saved + counts.partial) * 100) / counts.total : 0}
          sx={{
            height: 6, borderRadius: 3, bgcolor: "action.hover",
            "& .MuiLinearProgress-dashed": { display: "none" },
            "& .MuiLinearProgress-bar1": { bgcolor: "success.main" },
            "& .MuiLinearProgress-bar2": { bgcolor: "warning.light" },
          }} />

        <TextField id="plot-search" size="small" placeholder={t("search")} value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && visible.length) controller.selectPlot(visible[0]);
          }}
          slotProps={{
            htmlInput: { "aria-label": t("search"), autoComplete: "off", spellCheck: false },
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              endAdornment: <InputAdornment position="end"><Kbd>/</Kbd></InputAdornment>,
            },
          }} />

        <ToggleButtonGroup exclusive fullWidth size="small" value={filter} aria-label={t("filter.label")}
          onChange={(_, value: ListFilter | null) => value && controller.setFilter(value)}>
          <ToggleButton value="all" data-filter="all">{t("filter.all")}&nbsp;<Count n={counts.total} /></ToggleButton>
          <ToggleButton value="pending" data-filter="pending">{t("filter.pending")}&nbsp;<Count n={counts.pending} /></ToggleButton>
          <ToggleButton value="saved" data-filter="saved">{t("filter.saved")}&nbsp;<Count n={counts.saved} /></ToggleButton>
        </ToggleButtonGroup>

        <Button variant="contained" disableElevation fullWidth startIcon={<SkipNextIcon />}
          endIcon={<Kbd>N</Kbd>} onClick={controller.goToNextUnfinished} disabled={!counts.total}
          data-testid="next-unfinished">
          {t("nextUnfinished")}
        </Button>
      </Stack>

      <Divider />
      <PlotList ids={visible} statuses={statuses} activeId={activeId} onSelect={controller.selectPlot} />
      {loaded && order.length > 0 && visible.length === 0 && (
        <Typography color="text.secondary" align="center" sx={{ p: 2 }} data-testid="list-empty">{t("noMatch")}</Typography>
      )}

      <Divider />
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", px: 2, py: 1 }}>
        {(["empty", "partial", "saved"] as PlotStatus[]).map((s) => (
          <Stack key={s} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <StatusDot status={s} size={8} />
            <Typography variant="caption" color="text.secondary">{t(`status.${s}`)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function Count({ n }: { n: number }) {
  return <Typography component="span" variant="caption" sx={{ opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>{n}</Typography>;
}

/** Virtualized list: only the rows in view are rendered, so large grids stay fast. */
function PlotList({ ids, statuses, activeId, onSelect }: {
  ids: string[]; statuses: Record<string, PlotStatus>; activeId: string | null; onSelect: (id: string) => void;
}) {
  const t = useT();
  const rowHeight = Math.round(ROW_HEIGHT * useUiScale());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const virtualizer = useVirtualizer({
    count: ids.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowHeight, overscan: 10,
  });

  // Keep the active plot in view when it changes (e.g. "next unfinished")
  const activeIndex = activeId ? ids.indexOf(activeId) : -1;
  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "auto" });
    setCursor(null);
  }, [activeId]); // only when the selection changes, not on every filter change

  const onKeyDown = (e: KeyboardEvent) => {
    if (!ids.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const from = cursor ?? (activeIndex >= 0 ? activeIndex : -1);
      const next = Math.max(0, Math.min(ids.length - 1, from + (e.key === "ArrowDown" ? 1 : -1)));
      setCursor(next);
      virtualizer.scrollToIndex(next, { align: "auto" });
    } else if (e.key === "Enter" && cursor != null) {
      onSelect(ids[cursor]);
    }
  };

  return (
    <Box ref={scrollRef} role="listbox" aria-label={t("plotList")} tabIndex={0} onKeyDown={onKeyDown}
      data-testid="plot-list" sx={{ flex: 1, minHeight: 0, overflowY: "auto", outline: "none" }}>
      <Box sx={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const id = ids[row.index];
          const status = statuses[id] ?? "empty";
          const active = id === activeId;
          return (
            <ListItemButton key={id} role="option" aria-selected={active} selected={active}
              data-id={id} data-status={status} data-active={active || undefined} onClick={() => onSelect(id)}
              sx={{
                position: "absolute", top: 0, left: 0, right: 0, height: rowHeight,
                transform: `translateY(${row.start}px)`, gap: 1.5, pl: 2,
                borderLeft: 3, borderColor: active ? "info.main" : "transparent",
                outline: row.index === cursor ? "1px solid" : "none", outlineColor: "primary.main", outlineOffset: -1,
              }}>
              <StatusDot status={status} />
              <Typography noWrap sx={{ flex: 1, fontWeight: active ? 600 : 400, fontVariantNumeric: "tabular-nums" }} title={id}>{id}</Typography>
              <Typography variant="caption" color="text.secondary" data-testid="plot-status">{t(`status.${status}`)}</Typography>
            </ListItemButton>
          );
        })}
      </Box>
    </Box>
  );
}
