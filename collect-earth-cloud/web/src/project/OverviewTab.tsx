import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowForward from "@mui/icons-material/ArrowForward";
import CheckCircle from "@mui/icons-material/CheckCircle";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import {
  getAreas,
  getImagery,
  getOverview,
  getProgressSettings,
  getSampling,
  listAssignments,
  listCsvFiles,
  listInvites,
  listShareLinks,
  type Overview,
  type ProjectStatus,
} from "../api";
import { useApp } from "../appContext";
import { checklist, doneCount, STEP_PLACE, type StepId } from "../checklist";
import { ErrorAlert } from "../components/ErrorAlert";
import { MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { storageLevel, storagePercent, storageText, storageWarningKey } from "../storageUse";
import { useLoad } from "../useLoad";
import { shownImagery } from "./imageryView";
import { setupLines } from "./setupOverviewView";

async function loadOverview(projectId: string) {
  const [overview, invites, assignments, files] = await Promise.all([
    getOverview(projectId),
    // Older servers have no invite list: the checklist then counts only people.
    listInvites(projectId).catch(() => []),
    listAssignments(projectId).catch(() => []),
    listCsvFiles(projectId).catch(() => []),
  ]);
  const dividedFiles = files.filter((file) => file.divided && (file.dividedPeople ?? 0) > 0).length;
  return { overview, openInvites: invites.length, assignments: assignments.length, dividedFiles };
}

/** The steps that need more than their one line: how to do them and what happens after. */
const STEP_MORE: Partial<Record<StepId, MessageKey>> = {
  projectFile: "step.projectFile.help.more",
  invite: "step.invite.help.more",
  assign: "step.assign.help.more",
};

/** "Space used: 12 MB of 200 MB", a bar when there is a limit, and a warning when nearly full or over. */
function StorageUse({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number | null }) {
  const t = useT();
  const { language } = useApp();
  const level = storageLevel(usedBytes, limitBytes);
  const percent = storagePercent(usedBytes, limitBytes);
  const warning = storageWarningKey(level);
  const text = storageText(usedBytes, limitBytes, t, language);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography sx={{ fontWeight: 500 }}>{text}</Typography>
      {percent !== null && (
        <LinearProgress
          variant="determinate"
          value={percent}
          color={level === "over" ? "error" : level === "nearlyFull" ? "warning" : "primary"}
          sx={{ my: 1, height: 8, borderRadius: 4 }}
          aria-label={text}
        />
      )}
      <Typography variant="body2" color="text.secondary">
        {t("storage.explain")}
        <MoreInfo text={t("storage.explain.more")} />
      </Typography>
      {warning && (
        <Alert severity={level === "over" ? "error" : "warning"} sx={{ mt: 2 }}>
          {t(warning)}
        </Alert>
      )}
    </Paper>
  );
}

/** "Space used: 12 MB of 200 MB" on one line, with a warning when nearly full or over (Setup's overview once set up). */
function StorageLine({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number | null }) {
  const t = useT();
  const { language } = useApp();
  const level = storageLevel(usedBytes, limitBytes);
  const warning = storageWarningKey(level);
  return (
    <>
      <Typography variant="body2" color="text.secondary">
        {storageText(usedBytes, limitBytes, t, language)}
        <MoreInfo text={`${t("storage.explain")}\n\n${t("storage.explain.more")}`} />
      </Typography>
      {warning && (
        <Alert severity={level === "over" ? "error" : "warning"} sx={{ mt: 1 }}>
          {t(warning)}
        </Alert>
      )}
    </>
  );
}

/**
 * Once every step is done: each Setup section with a line on where it stands and a link to it. Its figures come from
 * the loads the sections make themselves (the same cache keys), so opening a section after shows it at once.
 */
function SetupGlance({ projectId, overview, status }: { projectId: string; overview: Overview; status: ProjectStatus }) {
  const t = useT();
  const { language } = useApp();
  const areas = useLoad(["project", projectId, "getAreas", null], () => getAreas(projectId));
  const imagery = useLoad(["project", projectId, "getImagery"], () => getImagery(projectId));
  const sampling = useLoad(["project", projectId, "getSampling"], () => getSampling(projectId));
  const schedule = useLoad(["project", projectId, "getProgressSettings"], () => getProgressSettings(projectId));
  const links = useLoad(["project", projectId, "listShareLinks"], () => listShareLinks(projectId));
  const shown = imagery.data ? shownImagery(imagery.data.imagery) : null;
  const lines = setupLines(
    {
      cepUpdatedAt: overview.cep?.updatedAt ?? null,
      plotFiles: overview.csvFiles,
      plots: overview.plots,
      areasSet: areas.data ? areas.data.source !== null : null,
      imagery: shown
        ? (["open_gee_app", "open_earth_map", "open_esri_wayback"] as const).filter((k) => shown[k] === "true").map((k) => t(`file.imagery.${k}` as MessageKey))
        : null,
      checksOn: sampling.data ? sampling.data.active : null,
      deadline: schedule.data ? (schedule.data.deadline ?? "") : null,
      shareLinks: links.data ? links.data.length : null,
      status,
    },
    t,
    language,
  );
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="setup-glance-title">
      <Typography variant="h2" id="setup-glance-title" gutterBottom>
        {t("summary.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        {t("overview.allDone")}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mb: 2 }}>
        {lines.map((line) => (
          <Box component="li" key={line.view} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
            <Link {...linkProps(pathFor({ name: "project", projectId, tab: "setup", view: line.view }))} sx={{ fontWeight: 500 }}>
              {t(`view.setup.${line.view}`)}
            </Link>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word", minHeight: "1.43em" }}>
              {line.text ?? ""}
            </Typography>
          </Box>
        ))}
      </Box>
      <StorageLine usedBytes={overview.storage.usedBytes} limitBytes={overview.storage.limitBytes} />
    </Paper>
  );
}

/** The project's getting-started checklist (Setup's overview, and the marks of Setup's sections): one load for both. */
export function useSetupOverview(projectId: string) {
  return useLoad(["project", projectId, "loadOverview"], () => loadOverview(projectId));
}

export function stepsOf({ overview, openInvites, assignments, dividedFiles }: Awaited<ReturnType<typeof loadOverview>>) {
  return checklist({
    hasProjectFile: overview.cep !== null,
    plotFileCount: overview.csvFiles,
    memberCount: overview.members,
    openInviteCount: openInvites,
    assignmentCount: assignments,
    dividedFileCount: dividedFiles,
    recordCount: overview.records.total,
  });
}

export function OverviewTab({ projectId, status, onGo }: { projectId: string; status: ProjectStatus; onGo: (tab: ProjectTab, view?: string) => void }) {
  const t = useT();
  const state = useSetupOverview(projectId);

  if (state.loading && !state.data) return <Loading />;
  if (state.error || !state.data) return <ErrorAlert error={state.error} onRetry={state.reload} />;

  const { overview } = state.data;
  const steps = stepsOf(state.data);
  const done = doneCount(steps);

  const allDone = done === steps.length;
  const progressBar = (
    <>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        {t("overview.stepsDone", { done, total: steps.length })}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={(done / steps.length) * 100}
        sx={{ mb: 2, height: 8, borderRadius: 4 }}
        aria-label={t("overview.stepsDone", { done, total: steps.length })}
      />
    </>
  );
  const list = (
      <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0 }}>
        {steps.map((step, index) => (
          <Box
            component="li"
            key={step.id}
            sx={{
              display: "flex",
              gap: 2,
              alignItems: { xs: "flex-start", sm: "center" },
              flexDirection: { xs: "column", sm: "row" },
              py: 1.5,
              px: 1.5,
              borderRadius: 2,
              bgcolor: step.current ? "action.selected" : "transparent",
            }}
            aria-current={step.current ? "step" : undefined}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start", flex: 1 }}>
              {step.done ? (
                <CheckCircle color="success" aria-label={t("step.done")} />
              ) : (
                <RadioButtonUnchecked color={step.current ? "primary" : "disabled"} aria-label={t("step.todo")} />
              )}
              <Box>
                <Typography sx={{ fontWeight: step.current ? 600 : 400 }}>
                  {index + 1}. {t(`step.${step.id}.title`)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(`step.${step.id}.help`)}
                  {STEP_MORE[step.id] && <MoreInfo text={t(STEP_MORE[step.id]!)} />}
                </Typography>
              </Box>
            </Stack>
            {step.done ? (
              <Chip label={t("step.done")} color="success" variant="outlined" size="small" sx={{ ml: { xs: 4.5, sm: 0 } }} />
            ) : (
              <Button
                variant={step.current ? "contained" : "outlined"}
                endIcon={<ArrowForward />}
                onClick={() => onGo(STEP_PLACE[step.id].tab, STEP_PLACE[step.id].view)}
                sx={{ ml: { xs: 4.5, sm: 0 }, flexShrink: 0 }}
              >
                {t(`step.${step.id}.action`)}
              </Button>
            )}
          </Box>
        ))}
      </Box>
  );

  // Once every step is done, the checklist gives way to where each section stands
  if (allDone) return <SetupGlance projectId={projectId} overview={overview} status={status} />;
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("overview.checklistTitle")}
        </Typography>
        {progressBar}
        {list}
      </Paper>
      <StorageUse usedBytes={overview.storage.usedBytes} limitBytes={overview.storage.limitBytes} />
    </Stack>
  );
}
