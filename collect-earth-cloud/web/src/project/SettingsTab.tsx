import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteForever from "@mui/icons-material/DeleteForever";
import { useState, type FormEvent } from "react";
import { deleteProject, getProgressSettings, getProjectAi, renameProject, saveProgressSettings, setProjectAi, type ProgressSettings } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { progressDraftOf, readProgressDraft, type ProgressDraft, type ProgressProblems } from "../progressView";
import { linkProps, navigate, pathFor } from "../router";
import { useLoad } from "../useLoad";
import { ShareLinksCard } from "./ShareLinks";

function RenameCard({ projectId, name, onRenamed }: { projectId: string; name: string; onRenamed: (name: string) => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [value, setValue] = useState(name);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    const next = value.trim();
    if (!next) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    try {
      await renameProject(projectId, next);
      onRenamed(next);
      setDone(true);
      void refreshMe();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack component="form" spacing={2} onSubmit={submit} noValidate>
        <Typography variant="h2">{t("settings.title")}</Typography>
        <TextField
          label={t("settings.nameLabel")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setEmpty(false);
            setDone(false);
          }}
          error={empty}
          helperText={empty ? t("error.required") : t("settings.nameHelp")}
          required
        />
        {done && (
          <Alert severity="success" role="status">
            {t("settings.renamed")}
          </Alert>
        )}
        <ErrorAlert error={error} />
        <Box>
          <Button type="submit" variant="contained" disabled={busy || value.trim() === name}>
            {t("common.save")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

/** The Progress tab's settings: an optional deadline and target, and when someone counts as quiet. */
function ProgressSettingsForm({ projectId, saved, onSaved }: { projectId: string; saved: ProgressSettings; onSaved: (s: ProgressSettings) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<ProgressDraft>(() => progressDraftOf(saved));
  const [problems, setProblems] = useState<ProgressProblems>({});
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = (field: "deadline" | "targetPlots" | "quietDays") => (value: string, unfinished = false) => {
    setDraft((d) => ({ ...d, [field]: value, ...(field === "deadline" ? { deadlineUnfinished: unfinished } : {}) }));
    setProblems((p) => ({ ...p, [field]: undefined }));
    setDone(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    const read = readProgressDraft(draft);
    setProblems(read.problems);
    if (Object.keys(read.problems).length > 0) return;
    setBusy(true);
    try {
      const next = await saveProgressSettings(projectId, read.settings);
      onSaved(next);
      setDraft(progressDraftOf(next));
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <TextField
        type="date"
        label={t("progressSettings.deadline")}
        value={draft.deadline}
        // A date typed only in part reads as "" (badInput): said, not saved as no deadline.
        onChange={(e) => change("deadline")(e.target.value, e.target.validity?.badInput === true)}
        error={problems.deadline !== undefined}
        helperText={problems.deadline ? t(problems.deadline) : t("progressSettings.deadlineHelp")}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label={t("progressSettings.target")}
        value={draft.targetPlots}
        onChange={(e) => change("targetPlots")(e.target.value)}
        error={problems.targetPlots !== undefined}
        helperText={problems.targetPlots ? t(problems.targetPlots) : t("progressSettings.targetHelp")}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
      />
      <TextField
        label={t("progressSettings.quietDays")}
        value={draft.quietDays}
        onChange={(e) => change("quietDays")(e.target.value)}
        error={problems.quietDays !== undefined}
        helperText={problems.quietDays ? t(problems.quietDays) : t("progressSettings.quietDaysHelp")}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
      />
      {done && (
        <Alert severity="success" role="status">
          {t("progressSettings.saved")}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Box>
        <Button type="submit" variant="contained" disabled={busy}>
          {t("common.save")}
        </Button>
      </Box>
    </Stack>
  );
}

function ProgressCard({ projectId }: { projectId: string }) {
  const t = useT();
  const settings = useLoad(() => getProgressSettings(projectId), [projectId]);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="settings-progress">
      <Stack spacing={2}>
        <Typography variant="h2" id="settings-progress">
          {t("progressSettings.title")}
        </Typography>
        <Typography>{t("progressSettings.intro")}</Typography>
        {settings.loading && !settings.data ? (
          <Loading />
        ) : settings.error || !settings.data ? (
          <ErrorAlert error={settings.error} onRetry={settings.reload} />
        ) : (
          <ProgressSettingsForm projectId={projectId} saved={settings.data} onSaved={settings.setData} />
        )}
      </Stack>
    </Paper>
  );
}

/**
 * The AI assistant's switch for this project, off by default, with what it sends. It can
 * be switched on only while the server owner has it set up and allowed; off always.
 */
function AiCard({ projectId }: { projectId: string }) {
  const t = useT();
  const ai = useLoad(() => getProjectAi(projectId), [projectId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [changed, setChanged] = useState(false);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    setChanged(false);
    try {
      ai.setData(await setProjectAi(projectId, enabled));
      setChanged(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="settings-ai">
      <Stack spacing={2}>
        <Typography variant="h2" id="settings-ai">
          {t("settings.aiTitle")}
        </Typography>
        <Typography>{t("settings.aiIntro")}</Typography>
        <Typography>{t("settings.aiSent")}</Typography>
        {ai.loading && !ai.data ? (
          <Loading />
        ) : ai.error || !ai.data ? (
          <ErrorAlert error={ai.error} onRetry={ai.reload} />
        ) : (
          <>
            <FormControlLabel
              control={
                <Switch
                  checked={ai.data.enabled}
                  // Off is always allowed; on only while the server has the assistant.
                  disabled={busy || (!ai.data.available && !ai.data.enabled)}
                  onChange={(e) => void toggle(e.target.checked)}
                />
              }
              label={t("settings.aiSwitch")}
            />
            {!ai.data.available && <Alert severity="info">{t("settings.aiNotAvailable")}</Alert>}
            {changed && (
              <Alert severity="success" role="status">
                {ai.data.enabled ? t("settings.aiOn") : t("settings.aiOff")}
              </Alert>
            )}
          </>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Paper>
  );
}

/** The danger zone: deleting the project, confirmed by typing its name. */
function DeleteCard({ projectId, name }: { projectId: string; name: string }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setError(null);
    setBusy(true);
    try {
      await deleteProject(projectId, typed.trim());
      await refreshMe();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderColor: "error.main" }}>
      <Stack component="form" spacing={2} onSubmit={submit} noValidate>
        <Typography variant="h2" color="error">
          {t("settings.deleteTitle")}
        </Typography>
        <Typography>{t("settings.deleteText")}</Typography>
        <Alert severity="warning">
          {t("settings.deleteDataFirst")} <Link {...linkProps(pathFor({ name: "project", projectId, tab: "data" }))}>{t("settings.deleteGoData")}</Link>
        </Alert>
        <TextField
          label={t("settings.deleteConfirm", { name })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          slotProps={{ htmlInput: { spellCheck: false } }}
        />
        <ErrorAlert error={error} />
        <Box>
          <Button type="submit" variant="contained" color="error" startIcon={<DeleteForever />} disabled={busy || !matches}>
            {t("settings.deleteSubmit")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

export function SettingsTab({ projectId, name, onRenamed }: { projectId: string; name: string; onRenamed: (name: string) => void }) {
  return (
    <Stack spacing={3}>
      <RenameCard projectId={projectId} name={name} onRenamed={onRenamed} />
      <ProgressCard projectId={projectId} />
      <ShareLinksCard projectId={projectId} />
      <AiCard projectId={projectId} />
      <DeleteCard projectId={projectId} name={name} />
    </Stack>
  );
}
