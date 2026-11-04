import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import GlobalStyles from "@mui/material/GlobalStyles";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import type { MapController } from "./controller";
import { plotLabel } from "./plots";
import { I18nContext, translator } from "./i18n";
import { FormPanel } from "./components/FormPanel";
import { MapArea } from "./components/MapArea";
import { PlotSidebar, RAIL_WIDTH, SIDEBAR_WIDTH } from "./components/PlotSidebar";
import { currentScale, useUiScale } from "./uiScale";
import { gewFollowFormWindow } from "./api";
import { IN_PANEL } from "./panel";
import { expandForDialogs, frozenLayout, subscribeFrozenLayout } from "./panelDialogs";
import { useAppInfo } from "./appInfo";
import { windowTitle } from "./appBar";
import { serverText } from "./serverTexts";
import { AppBar } from "./components/AppBar";
import { useServerTexts } from "./serverTexts";
import { IN_HOME } from "./home";
import { HomePage } from "./components/HomePage";
import { formWindow, imageryKey, imageryNumber, isFormMessage, keyOfMessage, type PanelKey } from "./shortcuts";
import { SettingsPage } from "./components/settings/SettingsPage";

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
/** How long the notice of a plot left no longer submitted stays: it has a button, and a decision to make */
const UNSUBMITTED_MILLIS = 10000;

export function App({ controller }: { controller: MapController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const width = useWindowWidth();
  const scale = useUiScale();
  const formOpen = state.formUrl != null;
  const unsubmittedKey = state.unsubmitted?.key;
  // In Google Earth Web's panel there is no map: the list or the form, whatever the width
  const onePane = IN_PANEL
    || width - (formOpen ? RAIL_WIDTH * scale + state.formWidth : SIDEBAR_WIDTH * scale) < MIN_MAP_WIDTH * scale;
  // One pane: the form, or the plot list when there is no form or the user asked for it until a plot is chosen, the one
  // open included: a click on it in the list brings its form back
  const [listShown, setListShown] = useState(false);
  useEffect(() => setListShown(false), [state.activeId, state.selected, onePane]);
  const listPane = onePane && (!formOpen || listShown);
  // The home page is no window next to Google Earth Web, and has no list or form for the shortcuts to act on
  useFollowedByGoogleEarthWeb(!IN_PANEL && !IN_HOME);
  // In Google Earth Web's panel the dialogs show over the whole page, not squeezed into the panel
  useEffect(() => (IN_PANEL ? expandForDialogs(window, currentScale) : undefined), []);
  // With no map, nothing else starts the controller (MapArea does, once its container is there): the home page needs it
  // for the statuses, which it polls from then on
  useEffect(() => { if (IN_PANEL || IN_HOME) controller.start(null); }, [controller]);
  // The settings page over the map or the home page: the map stays laid out under it, so it needs no resize when it
  // comes back, and the controller keeps its state
  const [page, setPage] = useState<"main" | "settings">("main");
  // the same function from one render to the next, so that the shortcuts' listeners are not added again on every render
  const showList = useCallback(() => (onePane ? setListShown(true) : controller.setSidebarCollapsed(false)), [onePane, controller]);
  useShortcuts(controller, showList, !IN_HOME && page === "main");
  const t = useMemo(() => translator(state.language), [state.language]);
  useEffect(() => { document.documentElement.lang = state.language; }, [state.language]);
  const [info, reloadInfo] = useAppInfo();
  // "Same as previous plot" offers the answers of the plot before to the operator who gave them only
  useEffect(() => { if (info) controller.setOperator(info.operator); }, [info, controller]);
  const texts = useServerTexts(state.language);
  // The title of the window, as the Swing window set it
  useEffect(() => {
    if (!texts) return;
    document.title = windowTitle(info, { app: serverText(texts, "CollectEarthWindow.19"), noSurvey: " - No survey loaded", cloud: serverText(texts, "CollectEarthWindow.cloudTitleSuffix") });
  }, [info, texts]);

  return (
    <I18nContext.Provider value={t}>
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
    {/* Once /api/app and the texts are read: until then the bar would have no project or operator, and no labels */}
    {info && texts && <AppBar info={info} texts={texts} reload={reloadInfo} compact={IN_PANEL || width < COMPACT_BAR_WIDTH * scale}
      onSettings={() => setPage("settings")} />}
    <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
    {page === "settings" && (
      <Box sx={{ position: "absolute", inset: 0, zIndex: 2, bgcolor: "background.default" }}>
        <SettingsPage texts={texts} compact={width < COMPACT_BAR_WIDTH * scale} onClose={() => setPage("main")} onApplied={reloadInfo} />
      </Box>
    )}
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
              ? t("toast.submitted", { id: plotLabel(state.labels, state.submitted.plotId),
                next: plotLabel(state.labels, state.submitted.next) })
              : t("toast.submittedLast", { id: plotLabel(state.labels, state.submitted.plotId) })}
            {/* The time left before it goes, shrinking to nothing */}
            <Box aria-hidden sx={{
              position: "absolute", left: 0, bottom: 0, height: 3, width: "100%", bgcolor: "common.white", opacity: 0.7,
              transformOrigin: "left", "@keyframes ce-toast-time": { from: { transform: "scaleX(1)" }, to: { transform: "scaleX(0)" } },
              animation: `ce-toast-time ${TOAST_MILLIS}ms linear forwards`,
            }} />
          </Alert>
        </Snackbar>
      )}
      {/* After the submitted toast in the page, so that it shows over it; the navigation went on, this only tells */}
      {state.unsubmitted && (
        <Snackbar key={state.unsubmitted.key} open autoHideDuration={UNSUBMITTED_MILLIS} onClose={(_, reason) => {
          // Esc is the plots map's key (it closes the form), not this notice's
          if (reason === "timeout") controller.dismissUnsubmitted(unsubmittedKey);
        }} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
          <Alert severity="warning" variant="filled" data-testid="unsubmitted-notice"
            action={<>
              <Button color="inherit" size="small" onClick={controller.backToUnsubmitted} data-testid="unsubmitted-back">
                {t("toast.backToPlot")}
              </Button>
              <IconButton color="inherit" size="small" aria-label={t("toast.close")} onClick={() => controller.dismissUnsubmitted(unsubmittedKey)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </>}>
            {t("toast.unsubmitted", { id: plotLabel(state.labels, state.unsubmitted.plotId) })}
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

/**
 * "/" search, "N" next unfinished, "Esc" close the form (ignored while typing), Alt+1, Alt+2... the imagery sources.
 * Pressed in the form, which has the focus while a plot is open, they come from it as messages (see panelKey).
 */
function useShortcuts(controller: MapController, showList: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const run = (key: PanelKey) => {
      const source = imageryNumber(key);
      if (source != null) {
        controller.showImageryNumber(source);
      } else if (key === "/") {
        showList();
        // the search field may only now be mounted
        requestAnimationFrame(() => (document.getElementById("plot-search") as HTMLInputElement | null)?.focus());
      } else if (key === "n" || key === "N") {
        controller.goToNextUnfinished();
      } else {
        controller.closeForm();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Nor in a dialog of the app bar, whose keys are its own
      if (target?.closest?.("[role=\"dialog\"]")) return;
      // Alt and a digit, in the plot search too, as it types nothing
      const imagery = imageryKey(e);
      if (imagery) {
        e.preventDefault();
        run(imagery);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        if (e.key === "Escape") target.blur();
        return;
      }
      if (e.key === "/") e.preventDefault();
      if (e.key === "/" || e.key === "n" || e.key === "N" || e.key === "Escape") run(e.key);
    };
    // Messages from the form of the plot open, as the controller takes its others
    const onMessage = (e: MessageEvent) => {
      if (!isFormMessage(e, window.location.origin, formWindow())) return;
      const key = keyOfMessage(e.data, controller.getSnapshot().activeId);
      if (key) run(key);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("message", onMessage); };
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
  const unsubscribe = subscribeFrozenLayout(onChange);
  return () => { window.removeEventListener("resize", onChange); unsubscribe(); };
}

/** The width of the window; while a dialog of Google Earth Web's panel widens its frame, the panel's (panelDialogs.ts). */
function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToResize, () => frozenLayout()?.width ?? window.innerWidth);
}
