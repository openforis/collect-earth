import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import GlobalStyles from "@mui/material/GlobalStyles";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import type { MapController } from "./controller";
import { I18nContext, translator } from "./i18n";
import { FormPanel } from "./components/FormPanel";
import { MapArea } from "./components/MapArea";
import { PlotSidebar, RAIL_WIDTH, SIDEBAR_WIDTH } from "./components/PlotSidebar";
import { useUiScale } from "./uiScale";
import { gewFollowFormWindow } from "./api";
import { IN_PANEL } from "./panel";
import { useAppInfo } from "./appInfo";
import { AppBar } from "./components/AppBar";
import { useServerTexts } from "./serverTexts";
import { IN_HOME } from "./home";
import { HomePage } from "./components/HomePage";

/**
 * Narrower than this, the map is not worth its room next to the form or the list: the window shows one pane at a
 * time, the form or the plot list, each over the whole width. That is how it opens next to Google Earth Web on a
 * single screen (GoogleEarthWebService.formWindowWidth), leaving the imagery the rest of the screen.
 */
const MIN_MAP_WIDTH = 360;
/** Narrower than this, the menus of the app bar go under one button: their labels would not fit side by side. */
const COMPACT_BAR_WIDTH = 760;
/** How long the toast of a submitted plot stays. */
const TOAST_MILLIS = 3000;

export function App({ controller }: { controller: MapController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const width = useWindowWidth();
  const scale = useUiScale();
  const formOpen = state.formUrl != null;
  // In Google Earth Web's panel there is no map: the list or the form, whatever the width
  const onePane = IN_PANEL
    || width - (formOpen ? RAIL_WIDTH * scale + state.formWidth : SIDEBAR_WIDTH * scale) < MIN_MAP_WIDTH * scale;
  // One pane: the form, or the plot list when there is no form or the user asked for it until a plot is chosen
  const [listShown, setListShown] = useState(false);
  useEffect(() => setListShown(false), [state.activeId, onePane]);
  const listPane = onePane && (!formOpen || listShown);
  // The home page is no window next to Google Earth Web, and has no list or form for the shortcuts to act on
  useFollowedByGoogleEarthWeb(!IN_PANEL && !IN_HOME);
  // With no map, nothing else starts the controller (MapArea does, once its container is there): the home page needs it
  // for the statuses, which it polls from then on
  useEffect(() => { if (IN_PANEL || IN_HOME) controller.start(null); }, [controller]);
  useShortcuts(controller, onePane ? () => setListShown(true) : () => controller.setSidebarCollapsed(false), !IN_HOME);
  const t = useMemo(() => translator(state.language), [state.language]);
  useEffect(() => { document.documentElement.lang = state.language; }, [state.language]);
  const [info, reloadInfo] = useAppInfo();
  const texts = useServerTexts(state.language);

  return (
    <I18nContext.Provider value={t}>
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
    {/* Once /api/app and the texts are read: until then the bar would have no project or operator, and no labels */}
    {info && texts && <AppBar info={info} texts={texts} reload={reloadInfo} compact={IN_PANEL || width < COMPACT_BAR_WIDTH * scale} />}
    <Box sx={{ flex: 1, minHeight: 0 }}>
    {IN_HOME ? <HomePage info={info} state={state} /> : (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
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
      {!IN_PANEL && <MapArea controller={controller} state={state} hidden={onePane} />}
      {formOpen && <FormPanel controller={controller} state={state} fill={onePane} hidden={listPane}
        onShowList={onePane ? () => setListShown(true) : undefined} />}
      {state.submitted && (
        <Snackbar key={state.submitted.key} open autoHideDuration={TOAST_MILLIS} onClose={(_, reason) => {
          if (reason !== "clickaway") controller.dismissSubmitted();
        }} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
          <Alert severity="success" variant="filled" onClose={controller.dismissSubmitted} data-testid="submitted-toast"
            sx={{ position: "relative", overflow: "hidden" }}>
            {state.submitted.next
              ? t("toast.submitted", { id: state.submitted.plotId, next: state.submitted.next })
              : t("toast.submittedLast", { id: state.submitted.plotId })}
            {/* The time left before it goes, shrinking to nothing */}
            <Box aria-hidden sx={{
              position: "absolute", left: 0, bottom: 0, height: 3, width: "100%", bgcolor: "common.white", opacity: 0.7,
              transformOrigin: "left", "@keyframes ce-toast-time": { from: { transform: "scaleX(1)" }, to: { transform: "scaleX(0)" } },
              animation: `ce-toast-time ${TOAST_MILLIS}ms linear forwards`,
            }} />
          </Alert>
        </Snackbar>
      )}
    </Box>
    )}
    </Box>
    </Box>
    </I18nContext.Provider>
  );
}

/** "/" search, "N" next unfinished, "Esc" close the form (ignored while typing). */
function useShortcuts(controller: MapController, showList: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Nor in a dialog of the app bar, whose keys are its own
      if (target?.closest?.("[role=\"dialog\"]")) return;
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
  }, [controller, showList, enabled]);
}

/**
 * Tells the server when the user resized or moved this window, once they stop: next to Google Earth Web on one screen,
 * Google Earth Web is then fitted into the room left. Moves fire no event, so the position is checked every second.
 */
function useFollowedByGoogleEarthWeb(enabled: boolean) {
  useEffect(() => {
    // A panel resized in Google Earth Web's page is no window of its own
    if (!enabled) return;
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
  }, [enabled]);
}

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToResize, () => window.innerWidth);
}
