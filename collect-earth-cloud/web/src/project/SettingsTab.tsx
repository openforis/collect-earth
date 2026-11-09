import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteForever from "@mui/icons-material/DeleteForever";
import { useState, type FormEvent } from "react";
import {
  copyProject,
  deleteProject,
  getProgressSettings,
  getProjectAi,
  renameProject,
  saveProgressSettings,
  setProjectAi,
  setProjectStatus,
  STATUS_MOVES,
  type ProgressSettings,
  type ProjectStatus,
} from "../api";
import { useApp, useLocalMode } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { settingsCards } from "../localMode";
import { progressDraftOf, readProgressDraft, type ProgressDraft, type ProgressProblems } from "../progressView";
import { linkProps, navigate, pathFor } from "../router";
import { useLoad } from "../useLoad";
import type { MessageKey } from "../i18n";
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
          // As the server takes it (1-200 characters).
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        {done && (
          <Alert severity="success" role="status">
            {t("settings.renamed")}
          </Alert>
        )}
        <ErrorAlert error={error} />
        <Box>
          <Button type="submit" variant="contained" disabled={busy || value.trim() === name || value.trim() === ""}>
            {t("common.save")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

/** Whether a deadline (YYYY-MM-DD) is a day before today, here. */
function deadlinePassed(deadline: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return deadline < today;
}

/** The Progress tab's settings: an optional deadline and target, and when someone counts as quiet. */
function ProgressSettingsForm({ projectId, saved, onSaved }: { projectId: string; saved: ProgressSettings; onSaved: (s: ProgressSettings) => void }) {
  const t = useT();
  // The local mode (one person): the target is the plots you plan to do, and nobody can go quiet (no quiet days).
  const local = useLocalMode();
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
        helperText={problems.deadline ? t(problems.deadline) : deadlinePassed(draft.deadline) ? t("progressSettings.deadlinePast") : t("progressSettings.deadlineHelp")}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label={t("progressSettings.target")}
        value={draft.targetPlots}
        onChange={(e) => change("targetPlots")(e.target.value)}
        error={problems.targetPlots !== undefined}
        helperText={problems.targetPlots ? t(problems.targetPlots) : t(local ? "progressSettings.targetHelpLocal" : "progressSettings.targetHelp")}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
      />
      {/* Who has gone quiet is about a team: working alone, nothing uses it */}
      {!local && <TextField
        label={t("progressSettings.quietDays")}
        value={draft.quietDays}
        onChange={(e) => change("quietDays")(e.target.value)}
        error={problems.quietDays !== undefined}
        helperText={problems.quietDays ? t(problems.quietDays) : t("progressSettings.quietDaysHelp")}
        slotProps={{ htmlInput: { inputMode: "numeric" } }}
      />}
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
  const local = useLocalMode();
  const settings = useLoad(() => getProgressSettings(projectId), [projectId]);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="settings-progress">
      <Stack spacing={2}>
        <Typography variant="h2" id="settings-progress">
          {t("progressSettings.title")}
        </Typography>
        <Typography>{t(local ? "progressSettings.introLocal" : "progressSettings.intro")}</Typography>
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
  // Switching on is confirmed: what is sent, to whom and where, checked against the project's agreements
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const toggle = async (enabled: boolean) => {
    setConfirming(false);
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
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAgreed(false);
                      setConfirming(true);
                    } else void toggle(false);
                  }}
                />
              }
              label={t("settings.aiSwitch")}
            />
            {!ai.data.available && <Alert severity="info">{t("settings.aiNotAvailable")}</Alert>}
            {ai.data.where && (
              <Typography variant="body2" color="text.secondary">
                {t(ai.data.where.region === "global" ? "settings.aiWhereGlobal" : "settings.aiWhere", ai.data.where)}
              </Typography>
            )}
            <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth="sm" fullWidth>
              <DialogTitle>{t("settings.aiConfirmTitle")}</DialogTitle>
              <DialogContent>
                <Stack spacing={2}>
                  <Typography>{t("settings.aiSent")}</Typography>
                  <Typography>{t("settings.aiSentViews")}</Typography>
                  {ai.data.where && <Typography>{t(ai.data.where.region === "global" ? "settings.aiWhereGlobal" : "settings.aiWhere", ai.data.where)}</Typography>}
                  <Typography>{t("settings.aiConfirmTerms")}</Typography>
                  <FormControlLabel control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />} label={t("settings.aiConfirmCheck")} />
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
                <Button variant="contained" disabled={!agreed || busy} onClick={() => void toggle(true)}>
                  {t("settings.aiConfirmOn")}
                </Button>
              </DialogActions>
            </Dialog>
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

/** The button of a move from one status to another. */
function moveLabel(from: ProjectStatus, to: ProjectStatus): MessageKey {
  if (to === "active") return from === "draft" ? "status.move.active" : "status.move.reopen";
  if (to === "closed") return from === "archived" ? "status.move.restore" : "status.move.closed";
  return "status.move.archived";
}

/** The project's lifecycle: what its status means, and the moves it can make (publish, close, reopen, archive, restore). */
function StatusCard({ projectId, status, onStatus }: { projectId: string; status: ProjectStatus; onStatus: (status: ProjectStatus) => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const move = async (to: ProjectStatus) => {
    setError(null);
    setBusy(true);
    try {
      onStatus(await setProjectStatus(projectId, to));
      void refreshMe();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="settings-status">
      <Stack spacing={2}>
        <Typography variant="h2" id="settings-status">
          {t("status.title")}: {t(`project.status.${status}`)}
        </Typography>
        <Typography>{t(`status.intro.${status}`)}</Typography>
        <ErrorAlert error={error} />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {STATUS_MOVES[status].map((to, i) => (
            <Button key={to} variant={i === 0 ? "contained" : "outlined"} disabled={busy} onClick={() => void move(to)}>
              {t(moveLabel(status, to))}
            </Button>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}

/** A new project from this one (a template), as a draft: the coordinator lands on its getting-started checklist. */
function CopyCard({ projectId, name }: { projectId: string; name: string }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [value, setValue] = useState(() => t("copy.defaultName", { name }));
  const [members, setMembers] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const copy = await copyProject(projectId, value.trim(), members);
      await refreshMe();
      navigate(pathFor({ name: "project", projectId: copy.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="settings-copy">
      <Stack component="form" spacing={2} onSubmit={submit} noValidate>
        <Typography variant="h2" id="settings-copy">
          {t("copy.title")}
        </Typography>
        <Typography>{t("copy.intro")}</Typography>
        <TextField
          label={t("copy.nameLabel")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={value.trim() === ""}
          helperText={value.trim() === "" ? t("error.required") : undefined}
          required
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        <FormControlLabel control={<Checkbox checked={members} onChange={(e) => setMembers(e.target.checked)} />} label={t("copy.members")} />
        <ErrorAlert error={error} />
        <Box>
          <Button type="submit" variant="contained" disabled={busy || value.trim() === ""}>
            {t("copy.submit")}
          </Button>
        </Box>
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

/** The project's settings; in the local mode (one person), the progress settings only (src/localMode.ts, settingsCards). */
export function SettingsTab({
  projectId,
  name,
  status,
  onRenamed,
  onStatus,
}: {
  projectId: string;
  name: string;
  status: ProjectStatus;
  onRenamed: (name: string) => void;
  onStatus: (status: ProjectStatus) => void;
}) {
  const cards = settingsCards(useLocalMode());
  return (
    <Stack spacing={3}>
      {cards.map((card) =>
        card === "rename" ? (
          <RenameCard key={card} projectId={projectId} name={name} onRenamed={onRenamed} />
        ) : card === "progress" ? (
          <ProgressCard key={card} projectId={projectId} />
        ) : card === "shareLinks" ? (
          <ShareLinksCard key={card} projectId={projectId} />
        ) : card === "ai" ? (
          <AiCard key={card} projectId={projectId} />
        ) : card === "copy" ? (
          <CopyCard key={card} projectId={projectId} name={name} />
        ) : card === "status" ? (
          <StatusCard key={card} projectId={projectId} status={status} onStatus={onStatus} />
        ) : (
          <DeleteCard key={card} projectId={projectId} name={name} />
        ),
      )}
    </Stack>
  );
}
