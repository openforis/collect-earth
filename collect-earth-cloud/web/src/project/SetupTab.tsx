import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getOverview, getQualitySettings } from "../api";
import { useLocalMode } from "../appContext";
import { CardFrame, OpenCards } from "../components/FoldingCard";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { ViewTabs } from "../components/ViewTabs";
import { useT, type MessageKey } from "../i18n";
import { setupSections } from "../localMode";
import { linkProps, navigate, pathFor, type ProjectTab, type ProjectView } from "../router";
import { useLoad } from "../useLoad";
import { FileTab } from "./FileTab";
import { ImageryCard } from "./ImageryCard";
import { OverviewTab } from "./OverviewTab";
import { PlotFilePage } from "./PlotFilePage";
import { PlotLayoutCard } from "./PlotLayoutCard";
import { PlotsTab } from "./PlotsTab";
import { QualityChecks } from "./QualityChecks";
import { FastSecondsField } from "./QualityFlags";
import { RepeatCard } from "./RepeatSurvey";
import { CopyCard, AiCard, DeleteCard, ProgressCard, RenameCard, StatusCard } from "./SettingsTab";
import { ShareLinksCard } from "./ShareLinks";
import { StrataAreas } from "./StrataAreas";

// Setup: the project's configuration, one section at a time (router.ts PROJECT_VIEWS.setup), out of the tabs used day
// to day. Each section is made of the cards that were spread over the Project file, Plot files, Quality and Settings
// tabs. On a wide screen the sections are listed under Setup in the sidebar (ProjectNav); on a smaller one, as tabs.

/** The "very fast" threshold (the pattern flags) on its own card. */
function FastSecondsCard({ projectId }: { projectId: string }) {
  const t = useT();
  const settings = useLoad(["project", projectId, "getQualitySettings"], () => getQualitySettings(projectId));
  return (
    <CardFrame title={t("setup.fastTitle")}>
      {settings.loading && !settings.data ? (
        <Loading />
      ) : settings.error || !settings.data ? (
        <ErrorAlert error={settings.error} onRetry={settings.reload} />
      ) : (
        <FastSecondsField
          projectId={projectId}
          fastSeconds={settings.data.fastSeconds}
          onSaved={(fastSeconds) => settings.setData((prev) => ({ ...prev, fastSeconds }))}
        />
      )}
    </CardFrame>
  );
}

/** How the plots look in Google Earth and the imagery collectors get: both read from the project file. */
function LayoutSection({ projectId }: { projectId: string }) {
  const t = useT();
  const overview = useLoad(["project", projectId, "getOverview"], () => getOverview(projectId));
  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error || !overview.data) return <ErrorAlert error={overview.error} onRetry={overview.reload} />;
  if (!overview.data.cep) {
    return (
      <Paper variant="outlined">
        <EmptyState
          title={t("setup.layoutNoFile")}
          action={
            <Button variant="contained" {...linkProps(pathFor({ name: "project", projectId, tab: "setup", view: "survey" }))}>
              {t("view.setup.survey")}
            </Button>
          }
        />
      </Paper>
    );
  }
  return (
    <Stack spacing={3}>
      <PlotLayoutCard projectId={projectId} />
      <ImageryCard projectId={projectId} />
    </Stack>
  );
}

export function SetupTab({ projectId, name, status, section, fileId, onGo }: {
  projectId: string;
  name: string;
  status: Parameters<typeof StatusCard>[0]["status"];
  section: ProjectView<"setup">;
  /** One plot file's page, in the Plots section */
  fileId?: string;
  onGo: (tab: ProjectTab, view?: string) => void;
}) {
  const t = useT();
  const local = useLocalMode();
  const body = {
    overview: <OverviewTab projectId={projectId} status={status} onGo={onGo} />,
    survey: <OpenCards><FileTab projectId={projectId} /></OpenCards>,
    plots: fileId ? <PlotFilePage key={fileId} projectId={projectId} fileId={fileId} onGo={onGo} /> : <PlotsTab projectId={projectId} onGo={onGo} />,
    areas: <OpenCards><StrataAreas projectId={projectId} defaultOpen /></OpenCards>,
    layout: <OpenCards><LayoutSection projectId={projectId} /></OpenCards>,
    quality: (
      <Stack spacing={3}>
        {!local && <QualityChecks projectId={projectId} />}
        <FastSecondsCard projectId={projectId} />
        {!local && (
          <Typography component="div" variant="body2" color="text.secondary">
            <Explain variant="body2" text={t("setup.marginsNote.short")} more={t("setup.marginsNote")} />
          </Typography>
        )}
      </Stack>
    ),
    schedule: <ProgressCard projectId={projectId} />,
    sharing: (
      <OpenCards>
        <Stack spacing={3}>
          <ShareLinksCard projectId={projectId} />
          <AiCard projectId={projectId} />
        </Stack>
      </OpenCards>
    ),
    next: (
      <OpenCards>
        <Stack spacing={3}>
          <RepeatCard projectId={projectId} name={name} />
          <CopyCard projectId={projectId} name={name} />
        </Stack>
      </OpenCards>
    ),
    project: (
      <Stack spacing={3}>
        <RenameCard projectId={projectId} name={name} />
        <StatusCard projectId={projectId} status={status} />
        <DeleteCard projectId={projectId} name={name} />
      </Stack>
    ),
  }[section];
  return (
    <Stack spacing={3}>
      {/* Tablets: the sections as tabs; phones: as a list to choose from, not a second row of tabs that scrolls
          sideways under the project's; a wide screen lists them in the sidebar */}
      <Box sx={{ display: { xs: "none", sm: "block", md: "none" } }}>
        <ViewTabs projectId={projectId} tab="setup" current={section} views={setupSections(local)} label={t("setup.sections")} />
      </Box>
      <TextField
        select
        size="small"
        label={t("setup.sections")}
        value={section}
        onChange={(e) => navigate(pathFor({ name: "project", projectId, tab: "setup", view: e.target.value }))}
        sx={{ display: { sm: "none" } }}
      >
        {setupSections(local).map((view) => (
          <MenuItem key={view} value={view}>
            {t(`view.setup.${view}` as MessageKey)}
          </MenuItem>
        ))}
      </TextField>
      {body}
    </Stack>
  );
}
