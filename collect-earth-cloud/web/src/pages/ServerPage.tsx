import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Key from "@mui/icons-material/Key";
import { useState, type FormEvent } from "react";
import {
  getServerSettings,
  listUsers,
  makeResetLink,
  saveServerSettings,
  type AdminUser,
  type ProjectCreation,
  type ResetLink,
  type ServerSettings,
} from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { CopyField } from "../components/CopyField";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate } from "../format";
import { useT, type MessageKey } from "../i18n";
import { draftOf, readDraft, type DraftProblems, type SettingsDraft } from "../settingsForm";
import { useLoad } from "../useLoad";

/** Limits for each account and the server's name, terms and contact: typed, then saved together. */
function DetailsForm({ settings, onSave }: { settings: ServerSettings; onSave: (changes: Partial<ServerSettings>) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(settings));
  const [problems, setProblems] = useState<DraftProblems>({});
  const [busy, setBusy] = useState(false);

  const field = (key: keyof SettingsDraft, label: MessageKey, help: MessageKey, extra: { type?: string; inputMode?: "numeric" } = {}) => (
    <TextField
      label={t(label)}
      value={draft[key]}
      onChange={(e) => {
        setDraft({ ...draft, [key]: e.target.value });
        setProblems({ ...problems, [key]: undefined });
      }}
      error={problems[key] !== undefined}
      helperText={problems[key] ? t(problems[key]!) : t(help)}
      type={extra.type}
      slotProps={extra.inputMode ? { htmlInput: { inputMode: extra.inputMode } } : undefined}
    />
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { changes, problems: found } = readDraft(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await onSave(changes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <div>
        <Typography variant="h3" component="h3" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {t("server.limits")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("server.limitsIntro")}
        </Typography>
      </div>
      {field("maxProjectsPerUser", "server.maxProjects", "server.maxProjectsHelp", { inputMode: "numeric" })}
      {field("maxProjectStorageMb", "server.maxStorage", "server.maxStorageHelp", { inputMode: "numeric" })}
      <div>
        <Typography variant="h3" component="h3" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {t("server.about")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("server.aboutIntro")}
        </Typography>
      </div>
      {field("serverName", "server.serverName", "server.serverNameHelp")}
      {field("termsUrl", "server.termsUrl", "server.termsUrlHelp", { type: "url" })}
      {field("contactEmail", "server.contactEmail", "server.contactEmailHelp", { type: "email" })}
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {t("common.save")}
        </Button>
      </div>
    </Stack>
  );
}

function SettingsCard() {
  const t = useT();
  const { refreshInfo } = useApp();
  const settings = useLoad(getServerSettings, []);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const save = async (changes: Partial<ServerSettings>) => {
    setError(null);
    setSaved(false);
    const before = settings.data;
    if (!before) return;
    settings.setData({ ...before, ...changes });
    try {
      settings.setData(await saveServerSettings(before, changes));
      setSaved(true);
      void refreshInfo();
    } catch (err) {
      settings.setData(before);
      setError(err);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" gutterBottom>
        {t("server.settings")}
      </Typography>
      {settings.loading && !settings.data ? (
        <Loading />
      ) : settings.error || !settings.data ? (
        <ErrorAlert error={settings.error} onRetry={settings.reload} />
      ) : (
        <Stack spacing={3}>
          <FormControl>
            <FormControlLabel
              control={<Switch checked={settings.data.signupOpen} onChange={(e) => void save({ signupOpen: e.target.checked })} />}
              label={t("server.signupOpen")}
            />
            <FormHelperText sx={{ ml: 0 }}>{t("server.signupHelp")}</FormHelperText>
          </FormControl>
          <FormControl>
            <FormLabel id="project-creation">{t("server.projectCreation")}</FormLabel>
            <RadioGroup
              aria-labelledby="project-creation"
              value={settings.data.projectCreation}
              onChange={(e) => void save({ projectCreation: e.target.value as ProjectCreation })}
            >
              <FormControlLabel value="platform-admins" control={<Radio />} label={t("server.creationAdmins")} />
              <FormControlLabel value="anyone" control={<Radio />} label={t("server.creationAnyone")} />
            </RadioGroup>
          </FormControl>
          <DetailsForm settings={settings.data} onSave={save} />
          {saved && (
            <Alert severity="success" role="status">
              {t("server.saved")}
            </Alert>
          )}
          <ErrorAlert error={error} />
        </Stack>
      )}
    </Paper>
  );
}

function UsersCard() {
  const t = useT();
  const { language } = useApp();
  const users = useLoad(listUsers, []);
  const [link, setLink] = useState<{ user: AdminUser; reset: ResetLink } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const makeLink = async (user: AdminUser) => {
    setError(null);
    setBusy(user.userId);
    try {
      setLink({ user, reset: await makeResetLink(user.userId) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" gutterBottom>
        {t("server.users")}
      </Typography>
      <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
        {t("server.privacy")}
      </Typography>
      {users.loading && !users.data ? (
        <Loading />
      ) : users.error || !users.data ? (
        <ErrorAlert error={users.error} onRetry={users.reload} />
      ) : users.data.length === 0 ? (
        <EmptyState title={t("server.noUsers")} />
      ) : (
        <List disablePadding>
          {users.data.map((user) => (
            <ListItem key={user.userId} divider sx={{ gap: 2, flexWrap: "wrap", px: 0 }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ wordBreak: "break-word" }}>{user.username}</span>
                    {user.isPlatformAdmin && <Chip size="small" color="primary" label={t("server.adminBadge")} />}
                  </Stack>
                }
                secondary={t("server.userProjects", { count: user.projects, coordinated: user.coordinatedProjects })}
                sx={{ flex: "1 1 200px" }}
              />
              <Button variant="outlined" startIcon={<Key />} onClick={() => void makeLink(user)} disabled={busy === user.userId}>
                {t("server.makeReset")}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      <ErrorAlert error={error} />
      <Dialog open={link !== null} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        {link && (
          <>
            <DialogTitle>{t("server.resetTitle", { name: link.user.username })}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <DialogContentText>
                  {link.reset.expiresAt !== null
                    ? t("server.resetText", { name: link.user.username, date: formatDate(link.reset.expiresAt, language) })
                    : t("server.resetTextNoDate", { name: link.user.username })}
                </DialogContentText>
                <CopyField value={link.reset.resetUrl} label={t("server.resetLink")} />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setLink(null)}>{t("common.close")}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Paper>
  );
}

/** For the server administrator only: server settings and accounts. */
export function ServerPage() {
  const t = useT();
  const { me, info } = useApp();
  if (!me?.isPlatformAdmin) {
    return (
      <AppShell>
        <Paper variant="outlined">
          <EmptyState title={t("server.onlyAdmin")} />
        </Paper>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <Stack spacing={3}>
        <div>
          <Typography variant="h1" gutterBottom>
            {t("server.title")}
          </Typography>
          <Typography color="text.secondary">{t("server.intro")}</Typography>
        </div>
        <SettingsCard />
        <UsersCard />
        {info.version && (
          <Typography variant="body2" color="text.secondary">
            {t("server.version", { version: info.version })}
          </Typography>
        )}
      </Stack>
    </AppShell>
  );
}
