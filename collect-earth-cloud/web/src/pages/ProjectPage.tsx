import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import Forest from "@mui/icons-material/Forest";
import { lazy, Suspense, useEffect, useRef } from "react";
import { ApiError, getProject } from "../api";
import { useLocalMode } from "../appContext";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { PlotSearchBox } from "../components/PlotSearchBox";
import { useT } from "../i18n";
import { AttentionBell } from "../components/AttentionBell";
import { FileTab } from "../project/FileTab";
import { OverviewTab } from "../project/OverviewTab";
import { PlotsTab } from "../project/PlotsTab";
import { SettingsTab } from "../project/SettingsTab";
import { projectTabs } from "../localMode";
import { linkProps, navigate, pathFor, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";

// Each tab is loaded when first opened (the map and the charts are most of the code).
const TrainingFigures = lazy(() => import("../components/TrainingFigures").then((m) => ({ default: m.TrainingFigures })));
const TrainingTab = lazy(() => import("../project/TrainingTab").then((m) => ({ default: m.TrainingTab })));
const ActivityTab = lazy(() => import("../project/ActivityTab").then((m) => ({ default: m.ActivityTab })));
const DataTab = lazy(() => import("../project/DataTab").then((m) => ({ default: m.DataTab })));
const MapTab = lazy(() => import("../project/MapTab").then((m) => ({ default: m.MapTab })));
const PeopleTab = lazy(() => import("../project/PeopleTab").then((m) => ({ default: m.PeopleTab })));
const PersonPage = lazy(() => import("./PersonPage").then((m) => ({ default: m.PersonPage })));
const PlotPage = lazy(() => import("./PlotPage").then((m) => ({ default: m.PlotPage })));
const PlotFilePage = lazy(() => import("../project/PlotFilePage").then((m) => ({ default: m.PlotFilePage })));
const ProgressTab = lazy(() => import("../project/ProgressTab").then((m) => ({ default: m.ProgressTab })));
const QualityAnswers = lazy(() => import("../project/QualityAnswers").then((m) => ({ default: m.QualityAnswers })));
const QualityFlags = lazy(() => import("../project/QualityFlags").then((m) => ({ default: m.QualityFlags })));
const QualitySurvey = lazy(() => import("../project/QualitySurvey").then((m) => ({ default: m.QualitySurvey })));
const QualityReference = lazy(() => import("../project/QualityReference").then((m) => ({ default: m.QualityReference })));
const QualityTab = lazy(() => import("../project/QualityTab").then((m) => ({ default: m.QualityTab })));
const ReviewQueue = lazy(() => import("../project/ReviewQueue").then((m) => ({ default: m.ReviewQueue })));

const TAB_LABELS = {
  progress: "tab.progress",
  setup: "tab.setup",
  file: "tab.file",
  people: "tab.people",
  plots: "tab.plots",
  map: "tab.map",
  data: "tab.data",
  quality: "tab.quality",
  training: "tab.training",
  activity: "tab.activity",
  settings: "tab.settings",
} as const;

/** The tabs a reviewer has. */
const REVIEWER_TABS = ["progress", "map", "quality", "training"] as const satisfies readonly ProjectTab[];

/** The project's name, with the plot search beside it (coordinators and reviewers), and the bell (coordinators). */
function Header({ projectId, name, bell = false }: { projectId: string; name: string; bell?: boolean }) {
  return (
    <Box sx={{ mb: 1, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
      <Typography
        variant="h1"
        title={name}
        // On a phone a long name takes at most two lines, a little smaller.
        sx={{
          wordBreak: "break-word",
          minWidth: 0,
          fontSize: { xs: "1.5rem", sm: undefined },
          display: { xs: "-webkit-box", sm: "block" },
          WebkitLineClamp: { xs: 2, sm: "unset" },
          WebkitBoxOrient: "vertical",
          overflow: { xs: "hidden", sm: "visible" },
        }}
      >
        {name}
      </Typography>
      {/* On a phone the bell and the search field take a row of their own, the field all its width. */}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", minWidth: 0, flex: { xs: "1 1 100%", sm: "0 1 auto" }, "& > :last-child": { flex: { xs: 1, sm: "0 1 auto" }, minWidth: 0 } }}>
        {bell && <AttentionBell projectId={projectId} />}
        <PlotSearchBox projectId={projectId} />
      </Box>
    </Box>
  );
}

/**
 * fileId: one plot file's page, shown under the Plot files tab; personId: one person's page, under
 * the People tab; plot: one plot's page (plot search), under the Quality tab.
 */
export function ProjectPage({ projectId, tab, fileId, personId, plot }: { projectId: string; tab: ProjectTab; fileId?: string; personId?: string; plot?: string }) {
  const t = useT();
  // The local mode (one person, on their own computer): no People, Plot files, Setup or project
  // file tabs, no bell (its cards are about other people) and no plot files' pages.
  const local = useLocalMode();
  const project = useLoad(() => getProject(projectId), [projectId]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const loaded = project.data !== null && project.data !== undefined;
  // The selected tab in sight: a scrollable row of tabs shows only its first ones on a phone,
  // and MUI does not scroll to a tab selected before the row had its width.
  useEffect(() => {
    const row = tabsRef.current;
    const selected = row?.querySelector<HTMLElement>(`#tab-${tab}`);
    const scroller = selected?.closest<HTMLElement>(".MuiTabs-scroller");
    if (!selected || !scroller) return;
    const tabBox = selected.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (tabBox.left < box.left || tabBox.right > box.right) {
      scroller.scrollLeft += tabBox.left - box.left - (box.width - tabBox.width) / 2;
    }
  }, [tab, loaded]);

  if (project.loading && !project.data) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }
  if (project.error || !project.data) {
    const missing = project.error instanceof ApiError && (project.error.status === 404 || project.error.status === 403);
    return (
      <AppShell>
        {missing ? (
          <Paper variant="outlined">
            <EmptyState
              heading
              title={t("project.notFound")}
              action={
                <Button variant="contained" {...linkProps("/")}>
                  {t("notFound.home")}
                </Button>
              }
            />
          </Paper>
        ) : (
          <ErrorAlert error={project.error} onRetry={project.reload} />
        )}
      </AppShell>
    );
  }

  const info = project.data;
  const go = (next: ProjectTab) => navigate(pathFor({ name: "project", projectId, tab: next }));
  // A reviewer follows the progress (without the cards that name people), the map (without who
  // holds each plot) and the answers per person (the Quality tab's Answers section); the other
  // tabs are the coordinators'.
  if (info.role === "reviewer" && (REVIEWER_TABS as readonly ProjectTab[]).includes(tab)) {
    return (
      <AppShell>
        <Header projectId={projectId} name={info.name} />
        <Box sx={{ mb: 3, display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="outlined" {...linkProps(pathFor({ name: "myWork", projectId }))}>
            {t("myWork.link")}
          </Button>
          <Button variant="outlined" {...linkProps(pathFor({ name: "myQuality", projectId }))}>
            {t("myQuality.link")}
          </Button>
        </Box>
        <Tabs value={tab} onChange={(_, value: ProjectTab) => go(value)} aria-label={t("project.sections")} sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}>
          {REVIEWER_TABS.map((id) => (
            <Tab key={id} value={id} label={t(TAB_LABELS[id])} id={`tab-${id}`} aria-controls={`panel-${id}`} onClick={plot && id === tab ? () => go(id) : undefined} />
          ))}
        </Tabs>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "progress" ? (
            <ProgressTab projectId={projectId} onGo={go} />
          ) : tab === "map" ? (
            <MapTab projectId={projectId} coordinator={false} />
          ) : tab === "training" ? (
            <TrainingFigures projectId={projectId} />
          ) : plot ? (
            <PlotPage key={plot} projectId={projectId} plot={plot} canOpenFiles={false} />
          ) : (
            <Stack spacing={2}>
              <Typography color="text.secondary">{t("quality.reviewerNote")}</Typography>
              <ReviewQueue projectId={projectId} canBulk={false} />
              <QualityFlags projectId={projectId} canEdit={false} />
              <QualityAnswers projectId={projectId} teamOnly />
              <QualitySurvey projectId={projectId} />
              <QualityReference projectId={projectId} canEdit={false} />
            </Stack>
          )}
        </div>
      </AppShell>
    );
  }
  if (info.role !== "admin") {
    return (
      <AppShell>
        <Paper variant="outlined">
          <EmptyState icon={<Forest color="primary" />} title={info.name}>
            <span style={{ display: "block", marginBottom: 12 }}>{t("member.text", { role: t(`role.${info.role}`) })}</span>
            <span style={{ display: "block" }}>{t("member.notThere")}</span>
          </EmptyState>
          <Box sx={{ pb: 4, display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
            <Button variant="contained" {...linkProps(pathFor({ name: "myWork", projectId }))}>
              {t("myWork.link")}
            </Button>
            <Button variant="outlined" {...linkProps(pathFor({ name: "myQuality", projectId }))}>
              {t("myQuality.link")}
            </Button>
          </Box>
        </Paper>
      </AppShell>
    );
  }

  const content = {
    progress: <ProgressTab projectId={projectId} onGo={go} />,
    setup: <OverviewTab projectId={projectId} onGo={go} />,
    file: <FileTab projectId={projectId} />,
    people: personId ? <PersonPage key={personId} projectId={projectId} userId={personId} onGo={go} /> : <PeopleTab projectId={projectId} />,
    plots: fileId ? <PlotFilePage key={fileId} projectId={projectId} fileId={fileId} onGo={go} /> : <PlotsTab projectId={projectId} onGo={go} />,
    map: <MapTab projectId={projectId} coordinator={!local} />,
    data: <DataTab projectId={projectId} onGo={go} />,
    quality: plot ? <PlotPage key={plot} projectId={projectId} plot={plot} canOpenFiles={!local} /> : <QualityTab projectId={projectId} />,
    training: <TrainingTab projectId={projectId} />,
    activity: <ActivityTab projectId={projectId} />,
    settings: <SettingsTab projectId={projectId} name={info.name} onRenamed={(name) => project.setData({ ...info, name })} />,
  }[tab];

  return (
    <AppShell wide>
      <Header projectId={projectId} name={info.name} bell={!local} />
      <Tabs
        ref={tabsRef}
        value={tab}
        onChange={(_, value: ProjectTab) => go(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label={t("project.sections")}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        {projectTabs(local).map((id) => (
          <Tab
            key={id}
            value={id}
            label={t(TAB_LABELS[id])}
            id={`tab-${id}`}
            aria-controls={`panel-${id}`}
            // On a plot file's page the Plot files tab is already selected: clicking it goes back to the list.
            onClick={(fileId || personId || plot) && id === tab ? () => go(id) : undefined}
          />
        ))}
      </Tabs>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <Suspense fallback={<Loading />}>{content}</Suspense>
      </div>
    </AppShell>
  );
}
