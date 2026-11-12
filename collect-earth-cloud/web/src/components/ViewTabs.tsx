import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import type { ReactNode } from "react";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor, PROJECT_VIEWS, type ProjectView, type ViewTab } from "../router";

/**
 * The views of a project tab split into views (router.ts, PROJECT_VIEWS), as tabs that are links: each view has its own
 * address, so the browser's back button and a shared link land on it. `extra` sits at the row's end (wide screens).
 */
export function ViewTabs<T extends ViewTab>({ projectId, tab, current, label, extra }: {
  projectId: string;
  tab: T;
  current: ProjectView<T>;
  label: string;
  extra?: ReactNode;
}) {
  const t = useT();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", borderBottom: 1, borderColor: "divider" }}>
      <Tabs value={current} variant="scrollable" allowScrollButtonsMobile aria-label={label} sx={{ flex: "1 1 auto", minWidth: 0 }}>
        {(PROJECT_VIEWS[tab] as readonly string[]).map((view) => (
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
