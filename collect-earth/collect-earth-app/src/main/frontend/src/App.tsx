import { useEffect, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import GlobalStyles from "@mui/material/GlobalStyles";
import type { MapController } from "./controller";
import { FormPanel } from "./components/FormPanel";
import { MapArea } from "./components/MapArea";
import { PlotSidebar } from "./components/PlotSidebar";

export function App({ controller }: { controller: MapController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useShortcuts(controller);

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden", bgcolor: "background.default" }}>
      <GlobalStyles styles={{
        ".leaflet-container": { fontFamily: "inherit" },
        ".leaflet-tooltip.plot-tooltip": {
          background: "var(--mui-palette-background-paper)", color: "var(--mui-palette-text-primary)",
          border: 0, borderRadius: 6, boxShadow: "var(--mui-shadows-2)", fontWeight: 600, padding: "3px 8px",
        },
        ".leaflet-tooltip.plot-tooltip::before": { display: "none" },
      }} />
      <PlotSidebar controller={controller} state={state} />
      <MapArea controller={controller} state={state} />
      {state.formUrl && <FormPanel controller={controller} state={state} />}
    </Box>
  );
}

/** "/" search, "N" next unfinished, "Esc" close the form (ignored while typing). */
function useShortcuts(controller: MapController) {
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
        controller.setSidebarCollapsed(false);
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
  }, [controller]);
}
