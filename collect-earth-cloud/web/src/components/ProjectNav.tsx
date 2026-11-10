import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import { alpha } from "@mui/material/styles";
import Description from "@mui/icons-material/DescriptionOutlined";
import FactCheck from "@mui/icons-material/FactCheckOutlined";
import Groups from "@mui/icons-material/GroupsOutlined";
import History from "@mui/icons-material/History";
import Insights from "@mui/icons-material/Insights";
import Map from "@mui/icons-material/MapOutlined";
import Place from "@mui/icons-material/PlaceOutlined";
import School from "@mui/icons-material/SchoolOutlined";
import Settings from "@mui/icons-material/SettingsOutlined";
import TableChart from "@mui/icons-material/TableChartOutlined";
import Tune from "@mui/icons-material/Tune";
import type { ReactElement } from "react";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";

/** The sections of a project, grouped as a coordinator works through them. */
const GROUPS: { label: MessageKey; tabs: ProjectTab[] }[] = [
  { label: "nav.group.monitor", tabs: ["progress", "map", "quality", "activity"] },
  { label: "nav.group.team", tabs: ["people", "plots", "training"] },
  { label: "nav.group.results", tabs: ["data"] },
  { label: "nav.group.project", tabs: ["setup", "file", "settings"] },
];

const ICONS: Record<ProjectTab, ReactElement> = {
  progress: <Insights />,
  map: <Map />,
  quality: <FactCheck />,
  activity: <History />,
  people: <Groups />,
  plots: <Place />,
  training: <School />,
  data: <TableChart />,
  setup: <Tune />,
  file: <Description />,
  settings: <Settings />,
};

/**
 * A project's sections as a sidebar, on screens wide enough for one (ProjectPage keeps the row of tabs on smaller
 * ones). `tabs`: the sections this person has, in any order; `labels`: their names.
 */
export function ProjectNav({ projectId, tab, tabs, labels }: { projectId: string; tab: ProjectTab; tabs: readonly ProjectTab[]; labels: Record<ProjectTab, MessageKey> }) {
  const t = useT();
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
              <ListItemButton
                key={id}
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
            );
          })}
        </List>
      ))}
    </Box>
  );
}
