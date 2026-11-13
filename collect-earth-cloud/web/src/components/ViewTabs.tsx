import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useEffect, useRef, type ReactNode } from "react";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor, PROJECT_VIEWS, type ProjectView, type ViewTab } from "../router";

/**
 * The views of a project tab split into views (router.ts, PROJECT_VIEWS), as tabs that are links: each view has its own
 * address, so the browser's back button and a shared link land on it. `extra` sits at the row's end (wide screens).
 */
export function ViewTabs<T extends ViewTab>({ projectId, tab, current, label, extra, views }: {
  projectId: string;
  tab: T;
  current: ProjectView<T>;
  label: string;
  extra?: ReactNode;
  /** The views this person has, when not all of them (Setup in the local mode) */
  views?: readonly ProjectView<T>[];
}) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  // The selected view in sight: on a phone the row shows only some of them, and MUI does not scroll to a view
  // selected before the row had its width.
  useEffect(() => {
    const inSight = () => {
      const selected = row.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const scroller = selected?.closest<HTMLElement>(".MuiTabs-scroller");
      if (!selected || !scroller) return;
      const tab = selected.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      if (tab.left < box.left || tab.right > box.right) scroller.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
    };
    // Once the fonts are in (they widen the tabs) and MUI's own scroll to the selected tab, an animation of about
    // 300 ms toward where the tab was before, has ended: it would undo an earlier correction.
    let timer: number | undefined;
    let live = true;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (live) timer = window.setTimeout(inSight, 450);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [current]);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", borderBottom: 1, borderColor: "divider" }}>
      <Tabs ref={row} value={current} variant="scrollable" allowScrollButtonsMobile aria-label={label} sx={{ flex: "1 1 auto", minWidth: 0 }}>
        {((views ?? PROJECT_VIEWS[tab]) as readonly string[]).map((view) => (
          <Tab
            key={view}
            value={view}
            label={t(`view.${tab}.${view}` as MessageKey)}
            component="a"
            {...linkProps(pathFor({ name: "project", projectId, tab, view }))}
          />
        ))}
      </Tabs>
      {extra && <Box sx={{ display: { xs: "none", sm: "flex" }, gap: 1, pb: 0.5 }}>{extra}</Box>}
    </Box>
  );
}
