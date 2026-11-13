import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import { alpha } from "@mui/material/styles";
import FactCheck from "@mui/icons-material/FactCheckOutlined";
import Groups from "@mui/icons-material/GroupsOutlined";
import History from "@mui/icons-material/History";
import Insights from "@mui/icons-material/Insights";
import Map from "@mui/icons-material/MapOutlined";
import School from "@mui/icons-material/SchoolOutlined";
import TableChart from "@mui/icons-material/TableChartOutlined";
import Tune from "@mui/icons-material/Tune";
import CheckCircle from "@mui/icons-material/CheckCircle";
import { Fragment, type ReactElement } from "react";
import { useLocalMode } from "../appContext";
import { STEP_PLACE } from "../checklist";
import { setupSectionOf, setupSections } from "../localMode";
import { stepsOf, useSetupOverview } from "../project/OverviewTab";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";

/** The sections of a project, grouped as a coordinator works through them. */
const GROUPS: { label: MessageKey; tabs: ProjectTab[] }[] = [
  { label: "nav.group.monitor", tabs: ["progress", "map", "quality", "activity"] },
  { label: "nav.group.team", tabs: ["people", "training"] },
  { label: "nav.group.results", tabs: ["data"] },
  { label: "nav.group.project", tabs: ["setup"] },
];

const ICONS: Record<ProjectTab, ReactElement> = {
  progress: <Insights />,
  map: <Map />,
  quality: <FactCheck />,
  activity: <History />,
  people: <Groups />,
  training: <School />,
  data: <TableChart />,
  setup: <Tune />,
};

/** Setup's sections done once their checklist steps are (the others have no step). */
function useDoneSections(projectId: string): Set<string> {
  const overview = useSetupOverview(projectId);
  const done = new Set<string>();
  if (!overview.data) return done;
  const steps = stepsOf(overview.data);
  for (const section of new Set(steps.map((s) => STEP_PLACE[s.id].view).filter((v): v is string => !!v))) {
    if (steps.every((s) => STEP_PLACE[s.id].view !== section || s.done)) done.add(section);
  }
  return done;
}

/** In the cloud: with a tick on the sections whose getting-started steps are done. */
function CloudSetupSections({ projectId, view }: { projectId: string; view: string | undefined }) {
  return <SetupSections projectId={projectId} view={view} local={false} done={useDoneSections(projectId)} />;
}

/** Setup's sections, under Setup while it is open. */
function SetupSections({ projectId, view, local, done }: { projectId: string; view: string | undefined; local: boolean; done: Set<string> }) {
  const t = useT();
  const current = setupSectionOf(view, local);
  return (
    <List dense disablePadding aria-label={t("setup.sections")} sx={{ ml: 2.5, pl: 1, borderLeft: 1, borderColor: "divider", mb: 0.5 }}>
      {setupSections(local).map((section) => {
        const selected = section === current;
        return (
          <ListItemButton
            key={section}
            component="a"
            {...linkProps(pathFor({ name: "project", projectId, tab: "setup", view: section }))}
            selected={selected}
            aria-current={selected ? "page" : undefined}
            sx={{
              borderRadius: 2,
              px: 1.25,
              py: 0.25,
              color: "text.primary",
              "&.Mui-selected, &.Mui-selected:hover": { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.09), color: "primary.main", fontWeight: 600 },
            }}
          >
            <ListItemText primary={t(`view.setup.${section}` as MessageKey)} slotProps={{ primary: { sx: { fontWeight: "inherit", fontSize: "0.85rem" } } }} />
            {done.has(section) && <CheckCircle color="success" sx={{ fontSize: 16 }} aria-label={t("step.done")} />}
          </ListItemButton>
        );
      })}
    </List>
  );
}

/**
 * A project's sections as a sidebar, on screens wide enough for one (ProjectPage keeps the row of tabs on smaller
 * ones). `tabs`: the sections this person has, in any order; `labels`: their names.
 */
export function ProjectNav({ projectId, tab, view, tabs, labels }: {
  projectId: string;
  tab: ProjectTab;
  view?: string;
  tabs: readonly ProjectTab[];
  labels: Record<ProjectTab, MessageKey>;
}) {
  const t = useT();
  const local = useLocalMode();
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((id) => tabs.includes(id)) })).filter((g) => g.tabs.length > 0);
  return (
    <Box
      component="nav"
      aria-label={t("project.sections")}
      className="no-print"
      sx={{ display: { xs: "none", md: "block" }, width: 216, flexShrink: 0, position: "sticky", top: 72, alignSelf: "flex-start" }}
    >
      {groups.map((group) => (
        <List
          key={group.label}
          dense
          disablePadding
          sx={{ mb: 1.5 }}
          subheader={
            <ListSubheader disableSticky sx={{ bgcolor: "transparent", lineHeight: 2.5, px: 1.5, fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {t(group.label)}
            </ListSubheader>
          }
        >
          {group.tabs.map((id) => {
            const selected = id === tab;
            return (
              <Fragment key={id}>
              <ListItemButton
                component="a"
                {...linkProps(pathFor({ name: "project", projectId, tab: id }))}
                selected={selected}
                aria-current={selected ? "page" : undefined}
                sx={{
                  borderRadius: 2,
                  px: 1.5,
                  py: 0.5,
                  mb: 0.25,
                  color: "text.primary",
                  "& .MuiListItemIcon-root": { minWidth: 34, color: selected ? "primary.main" : "text.secondary" },
                  // the selected section in a light tint of Collect Earth's blue, as a hover is
                  "&.Mui-selected, &.Mui-selected:hover": { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.09), color: "primary.main", fontWeight: 600 },
                }}
              >
                <ListItemIcon>{ICONS[id]}</ListItemIcon>
                <ListItemText primary={t(labels[id])} slotProps={{ primary: { sx: { fontWeight: "inherit", fontSize: "0.9rem" } } }} />
              </ListItemButton>
              {id === "setup" && selected && (local ? <SetupSections projectId={projectId} view={view} local done={new Set()} /> : <CloudSetupSections projectId={projectId} view={view} />)}
              </Fragment>
            );
          })}
        </List>
      ))}
    </Box>
  );
}
