import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
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
import { PlotsTab } from "../project/PlotsTab";
import { SettingsTab } from "../project/SettingsTab";
import { linkProps, navigate, pathFor, PROJECT_TABS, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";

const TAB_LABELS = {
  overview: "tab.overview",
  file: "tab.file",
  people: "tab.people",
  plots: "tab.plots",
  data: "tab.data",
  settings: "tab.settings",
} as const;

export function ProjectPage({ projectId, tab }: { projectId: string; tab: ProjectTab }) {
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
  if (info.role !== "admin") {
    return (
      <AppShell>
        <Paper variant="outlined">
          <EmptyState icon={<Forest color="primary" />} title={info.name}>
            <span style={{ display: "block", marginBottom: 12 }}>{t("member.text", { role: t(`role.${info.role}`) })}</span>
            <span style={{ display: "block" }}>{t("member.notThere")}</span>
          </EmptyState>
        </Paper>
      </AppShell>
    );
  }

  const go = (next: ProjectTab) => navigate(pathFor({ name: "project", projectId, tab: next }));
  const content = {
    overview: <OverviewTab projectId={projectId} onGo={go} />,
    file: <FileTab projectId={projectId} />,
    people: <PeopleTab projectId={projectId} />,
    plots: <PlotsTab projectId={projectId} onGo={go} />,
    data: <DataTab projectId={projectId} />,
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
          <Tab key={id} value={id} label={t(TAB_LABELS[id])} id={`tab-${id}`} aria-controls={`panel-${id}`} />
        ))}
      </Tabs>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {content}
      </div>
    </AppShell>
  );
}
