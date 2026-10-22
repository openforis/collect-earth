import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import GlobalStyles from "@mui/material/GlobalStyles";
import type { MapController } from "./controller";
import { I18nContext, translator } from "./i18n";
import { FormPanel } from "./components/FormPanel";
import { MapArea } from "./components/MapArea";
import { PlotSidebar, RAIL_WIDTH, SIDEBAR_WIDTH } from "./components/PlotSidebar";
import { useUiScale } from "./uiScale";
import { gewFollowFormWindow } from "./api";

/**
 * Narrower than this, the map is not worth its room next to the form or the list: the window shows one pane at a
 * time, the form or the plot list, each over the whole width. That is how it opens next to Google Earth Web on a
 * single screen (GoogleEarthWebService.formWindowWidth), leaving the imagery the rest of the screen.
 */
const MIN_MAP_WIDTH = 360;

export function App({ controller }: { controller: MapController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const width = useWindowWidth();
  const scale = useUiScale();
  const formOpen = state.formUrl != null;
  const onePane = width - (formOpen ? RAIL_WIDTH * scale + state.formWidth : SIDEBAR_WIDTH * scale) < MIN_MAP_WIDTH * scale;
  // One pane: the form, or the plot list when there is no form or the user asked for it until a plot is chosen
  const [listShown, setListShown] = useState(false);
  useEffect(() => setListShown(false), [state.activeId, onePane]);
  const listPane = onePane && (!formOpen || listShown);
  useFollowedByGoogleEarthWeb();
  useShortcuts(controller, onePane ? () => setListShown(true) : () => controller.setSidebarCollapsed(false));
  const t = useMemo(() => translator(state.language), [state.language]);
  useEffect(() => { document.documentElement.lang = state.language; }, [state.language]);

  return (
    <I18nContext.Provider value={t}>
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden", bgcolor: "background.default" }}>
      <GlobalStyles styles={{
        ".leaflet-container": { fontFamily: "inherit" },
        ".leaflet-tooltip.plot-tooltip": {
          background: "var(--mui-palette-background-paper)", color: "var(--mui-palette-text-primary)",
          border: 0, borderRadius: 6, boxShadow: "var(--mui-shadows-2)", fontWeight: 600, padding: "3px 8px",
        },
        ".leaflet-tooltip.plot-tooltip::before": { display: "none" },
      }} />
      {onePane
        ? listPane && <PlotSidebar controller={controller} state={state} collapsed={false} fill
            onCollapsedChange={formOpen ? () => setListShown(false) : undefined} />
        : <PlotSidebar controller={controller} state={state} />}
      <MapArea controller={controller} state={state} hidden={onePane} />
      {formOpen && <FormPanel controller={controller} state={state} fill={onePane} hidden={listPane}
        onShowList={onePane ? () => setListShown(true) : undefined} />}
    </Box>
    </I18nContext.Provider>
  );
}

/** "/" search, "N" next unfinished, "Esc" close the form (ignored while typing). */
function useShortcuts(controller: MapController, showList: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        if (e.key === "Escape") target.blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        showList();
        // the search field may only now be mounted
        requestAnimationFrame(() => (document.getElementById("plot-search") as HTMLInputElement | null)?.focus());
      } else if (e.key === "n" || e.key === "N") {
        controller.goToNextUnfinished();
      } else if (e.key === "Escape") {
        controller.closeForm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [controller, showList]);
}

/**
 * Tells the server when the user resized or moved this window, once they stop: next to Google Earth Web on one screen,
 * Google Earth Web is then fitted into the room left. Moves fire no event, so the position is checked every second.
 */
function useFollowedByGoogleEarthWeb() {
  useEffect(() => {
    let timer = 0;
    let last = "";
    const changed = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(gewFollowFormWindow, 400);
    };
    const checkPosition = () => {
      const now = `${window.screenX},${window.screenY}`;
      if (last && now !== last) changed();
      last = now;
    };
    window.addEventListener("resize", changed);
    const interval = window.setInterval(checkPosition, 1000);
    return () => { window.removeEventListener("resize", changed); window.clearInterval(interval); window.clearTimeout(timer); };
  }, []);
}

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToResize, () => window.innerWidth);
}
