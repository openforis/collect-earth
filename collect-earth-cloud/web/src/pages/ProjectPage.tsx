import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import Forest from "@mui/icons-material/Forest";
import { ApiError, getProject } from "../api";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { DataTab } from "../project/DataTab";
import { FileTab } from "../project/FileTab";
import { OverviewTab } from "../project/OverviewTab";
import { PeopleTab } from "../project/PeopleTab";
import { PersonPage } from "./PersonPage";
import { PlotFilePage } from "../project/PlotFilePage";
import { PlotsTab } from "../project/PlotsTab";
import { ProgressTab } from "../project/ProgressTab";
import { QualityAnswers } from "../project/QualityAnswers";
import { QualityFlags } from "../project/QualityFlags";
import { QualitySurvey } from "../project/QualitySurvey";
import { QualityTab } from "../project/QualityTab";
import { SettingsTab } from "../project/SettingsTab";
import { linkProps, navigate, pathFor, PROJECT_TABS, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";

const TAB_LABELS = {
  progress: "tab.progress",
  setup: "tab.setup",
  file: "tab.file",
  people: "tab.people",
  plots: "tab.plots",
  data: "tab.data",
  quality: "tab.quality",
  settings: "tab.settings",
} as const;

/** The tabs a reviewer has. */
const REVIEWER_TABS = ["progress", "quality"] as const satisfies readonly ProjectTab[];

/** fileId: one plot file's page, shown under the Plot files tab; personId: one person's page, under the People tab. */
export function ProjectPage({ projectId, tab, fileId, personId }: { projectId: string; tab: ProjectTab; fileId?: string; personId?: string }) {
  const t = useT();
  const project = useLoad(() => getProject(projectId), [projectId]);

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
  // A reviewer follows the progress (without the cards that name people) and the answers per
  // person (the Quality tab's Answers section); the other tabs are the coordinators'.
  if (info.role === "reviewer" && (tab === "progress" || tab === "quality")) {
    return (
      <AppShell>
        <Typography variant="h1" sx={{ mb: 1, wordBreak: "break-word" }}>
          {info.name}
        </Typography>
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
            <Tab key={id} value={id} label={t(TAB_LABELS[id])} id={`tab-${id}`} aria-controls={`panel-${id}`} />
          ))}
        </Tabs>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "progress" ? (
            <ProgressTab projectId={projectId} onGo={go} />
          ) : (
            <Stack spacing={2}>
              <Typography color="text.secondary">{t("quality.reviewerNote")}</Typography>
              <QualityFlags projectId={projectId} canEdit={false} />
              <QualityAnswers projectId={projectId} />
              <QualitySurvey projectId={projectId} />
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
    data: <DataTab projectId={projectId} onGo={go} />,
    quality: <QualityTab projectId={projectId} />,
    settings: <SettingsTab projectId={projectId} name={info.name} onRenamed={(name) => project.setData({ ...info, name })} />,
  }[tab];

  return (
    <AppShell>
      <Typography variant="h1" sx={{ mb: 1, wordBreak: "break-word" }}>
        {info.name}
      </Typography>
      <Tabs
        value={tab}
        onChange={(_, value: ProjectTab) => go(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label={t("project.sections")}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        {PROJECT_TABS.map((id) => (
          <Tab
            key={id}
            value={id}
            label={t(TAB_LABELS[id])}
            id={`tab-${id}`}
            aria-controls={`panel-${id}`}
            // On a plot file's page the Plot files tab is already selected: clicking it goes back to the list.
            onClick={(fileId || personId) && id === tab ? () => go(id) : undefined}
          />
        ))}
      </Tabs>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {content}
      </div>
    </AppShell>
  );
}
