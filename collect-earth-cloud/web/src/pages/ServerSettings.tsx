import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent, type ReactNode } from "react";
import { getServerSettings, saveServerSettings, type ProjectCreation, type ServerSettings } from "../api";
import { AI_LIMIT_MAX, parseLimit as parseAiLimit } from "../aiView";
import { fromLocalInput, toLocalInput } from "../announcement";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain, MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { draftOf, readDraft, type SettingsDraft } from "../settingsForm";
import { useUnsaved } from "../unsavedChanges";
import { useLoad } from "../useLoad";

type Save = (changes: Partial<ServerSettings>) => Promise<void>;

/**
 * One group of the server's settings: its title, what it affects, its fields, and its own Save and Discard, so that
 * what is saved is always what the group shows. Its changes not saved are named to the page (useUnsaved), which warns
 * before leaving.
 */
function SettingsGroup({ id, title, intro, more, affects, unsaved, invalid, onSave, onDiscard, extra, children }: {
  id: string;
  title: string;
  intro?: string;
  more?: string;
  affects: string;
  unsaved: boolean;
  invalid?: boolean;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useUnsaved(id, title, unsaved);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!unsaved || invalid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave();
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby={`server-group-${id}`}>
      <Stack component="form" spacing={2} onSubmit={(e) => void submit(e)} noValidate>
        <div>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="h2" id={`server-group-${id}`}>{title}</Typography>
            {unsaved && <Chip size="small" color="warning" variant="outlined" label={t("server.unsaved")} />}
          </Stack>
          {intro && (more ? <Explain variant="body2" text={intro} more={more} /> : <Typography variant="body2" color="text.secondary">{intro}</Typography>)}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{affects}</Typography>
        </div>
        {children}
        {saved && !unsaved && <Alert severity="success" role="status">{t("server.groupSaved")}</Alert>}
        <ErrorAlert error={error} />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button type="submit" variant="contained" disabled={busy || !unsaved || invalid}>{t("common.save")}</Button>
          <Button variant="outlined" disabled={busy || !unsaved} onClick={() => { onDiscard(); setError(null); }}>{t("server.discard")}</Button>
          {extra}
        </Box>
      </Stack>
    </Paper>
  );
}

/** Who can sign up, sign in and create projects. */
function AccessGroup({ settings, onSave }: { settings: ServerSettings; onSave: Save }) {
  const t = useT();
  const initial = { signupOpen: settings.signupOpen, twoFactorForCoordinators: settings.twoFactorForCoordinators, projectCreation: settings.projectCreation };
  // What is changed and not saved; null: the settings as saved
  const [edited, setDraft] = useState<typeof initial | null>(null);
  const draft = edited ?? initial;
  const unsaved = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => draft[k] !== initial[k]);
  return (
    <SettingsGroup id="access" title={t("server.group.access")} affects={t("server.affects.access")} unsaved={unsaved}
      onSave={async () => { await onSave(draft); setDraft(null); }} onDiscard={() => setDraft(null)}>
      <FormControl>
        <FormControlLabel control={<Switch checked={draft.signupOpen} onChange={(e) => setDraft({ ...draft, signupOpen: e.target.checked })} />} label={t("server.signupOpen")} />
        <FormHelperText sx={{ ml: 0 }}>{t("server.signupHelp")}</FormHelperText>
      </FormControl>
      <FormControl>
        <FormControlLabel
          control={<Switch checked={draft.twoFactorForCoordinators} onChange={(e) => setDraft({ ...draft, twoFactorForCoordinators: e.target.checked })} />}
          label={t("server.twoFactorRequired")}
        />
        <FormHelperText sx={{ ml: 0 }}>
          {t("server.twoFactorRequiredHelp.short")}
          <MoreInfo text={t("server.twoFactorRequiredHelp")} />
        </FormHelperText>
      </FormControl>
      <FormControl>
        <FormLabel id="project-creation">{t("server.projectCreation")}</FormLabel>
        <RadioGroup aria-labelledby="project-creation" value={draft.projectCreation} onChange={(e) => setDraft({ ...draft, projectCreation: e.target.value as ProjectCreation })}>
          <FormControlLabel value="platform-admins" control={<Radio />} label={t("server.creationAdmins")} />
          <FormControlLabel value="anyone" control={<Radio />} label={t("server.creationAnyone")} />
        </RadioGroup>
      </FormControl>
    </SettingsGroup>
  );
}

/** Text fields of the limits and the server's details, read with the rules the server applies (settingsForm.ts). */
function DraftFields({ settings, keys, fields, group, title, intro, affects, onSave }: {
  settings: ServerSettings;
  keys: (keyof SettingsDraft)[];
  fields: { key: keyof SettingsDraft; label: MessageKey; help: MessageKey; more?: MessageKey; type?: string; numeric?: boolean }[];
  group: string;
  title: string;
  intro: string;
  affects: string;
  onSave: Save;
}) {
  const t = useT();
  const initial = draftOf(settings);
  const [edited, setDraft] = useState<SettingsDraft | null>(null);
  const draft = edited ?? initial;
  const { changes, problems } = readDraft(draft);
  const shown = Object.fromEntries(keys.filter((k) => problems[k] && draft[k] !== initial[k]).map((k) => [k, problems[k]!])) as Partial<Record<keyof SettingsDraft, MessageKey>>;
  const unsaved = keys.some((k) => draft[k].trim() !== initial[k].trim());
  const invalid = keys.some((k) => problems[k] !== undefined);
  return (
    <SettingsGroup id={group} title={title} intro={intro} affects={affects} unsaved={unsaved} invalid={invalid}
      onSave={async () => { await onSave(Object.fromEntries(keys.map((k) => [k, changes[k as keyof typeof changes]])) as Partial<ServerSettings>); setDraft(null); }}
      onDiscard={() => setDraft(null)}>
      {fields.map(({ key, label, help, more, type, numeric }) => (
        <Stack key={key} spacing={0.75}>
          <FormLabel htmlFor={`server-setting-${key}`} sx={{ color: "text.primary" }}>{t(label)}</FormLabel>
          <TextField
            id={`server-setting-${key}`}
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            error={shown[key] !== undefined}
            helperText={shown[key] ? t(shown[key]!) : <>{t(help)}{more && <MoreInfo text={t(more)} />}</>}
            type={type}
            slotProps={numeric ? { htmlInput: { inputMode: "numeric" } } : undefined}
          />
        </Stack>
      ))}
    </SettingsGroup>
  );
}

/** The banner every signed-in person sees at the top of each page: a short plain message, until an optional end or until cleared. */
function AnnouncementGroup({ settings, onSave }: { settings: ServerSettings; onSave: Save }) {
  const t = useT();
  const { refreshMe } = useApp();
  const initialText = settings.announcement ?? "";
  const initialUntil = toLocalInput(settings.announcementUntil);
  const [editedText, setText] = useState<string | null>(null);
  const [editedUntil, setUntil] = useState<string | null>(null);
  const text = editedText ?? initialText;
  const until = editedUntil ?? initialUntil;
  const [clearing, setClearing] = useState(false);
  const end = fromLocalInput(until);
  const past = text.trim() !== "" && end !== null && end <= Date.now();
  const unsaved = text !== initialText || until !== initialUntil;
  const save = async (changes: Partial<ServerSettings>) => {
    await onSave(changes);
    await refreshMe();
  };
  const clear = async () => {
    setClearing(true);
    try {
      await save({ announcement: null, announcementUntil: null });
      setText(null);
      setUntil(null);
    } finally {
      setClearing(false);
    }
  };
  return (
    <SettingsGroup id="announcement" title={t("server.announcementTitle")} intro={t("server.announcementHelp.short")} more={t("server.announcementHelp")}
      affects={t("server.affects.announcement")} unsaved={unsaved} invalid={past}
      onSave={async () => { await save({ announcement: text.trim() || null, announcementUntil: text.trim() ? end : null }); setText(null); setUntil(null); }}
      onDiscard={() => { setText(null); setUntil(null); }}
      extra={settings.announcement ? <Button color="error" disabled={clearing} onClick={() => void clear()}>{t("server.announcementClear")}</Button> : undefined}>
      <TextField label={t("server.announcementText")} value={text} onChange={(e) => setText(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField
        type="datetime-local"
        label={t("server.announcementUntil")}
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        error={past}
        helperText={t(past ? "server.announcementPast" : "server.announcementUntilHelp")}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </SettingsGroup>
  );
}

type AiLimitKey = keyof typeof AI_LIMIT_MAX;
const AI_LIMIT_FIELDS: { key: AiLimitKey; label: MessageKey; help: MessageKey; more?: MessageKey }[] = [
  { key: "aiReportsPerDay", label: "server.aiReports", help: "server.aiReportsHelp" },
  { key: "aiFollowUpsPerDay", label: "server.aiFollowUps", help: "server.aiFollowUpsHelp" },
  { key: "aiMonthlyTokens", label: "server.aiTokens", help: "server.aiTokensHelp.short", more: "server.aiTokensHelp" },
];

/** The AI assistant on this server: its switch (once the server has its Vertex AI settings) and its three limits per project. */
function AiGroup({ settings, onSave }: { settings: ServerSettings; onSave: Save }) {
  const t = useT();
  const { language } = useApp();
  const initial = { aiEnabled: settings.aiEnabled, ...Object.fromEntries(AI_LIMIT_FIELDS.map(({ key }) => [key, String(settings[key])])) } as { aiEnabled: boolean } & Record<AiLimitKey, string>;
  const [edited, setDraft] = useState<typeof initial | null>(null);
  const draft = edited ?? initial;
  const values = Object.fromEntries(AI_LIMIT_FIELDS.map(({ key }) => [key, parseAiLimit(draft[key], AI_LIMIT_MAX[key])])) as Record<AiLimitKey, number | null>;
  const invalid = AI_LIMIT_FIELDS.some(({ key }) => values[key] === null);
  const unsaved = draft.aiEnabled !== initial.aiEnabled || AI_LIMIT_FIELDS.some(({ key }) => draft[key].trim() !== initial[key]);
  return (
    <SettingsGroup id="ai" title={t("server.aiTitle")} intro={t("server.aiIntro.short")} more={t("server.aiIntro")} affects={t("server.affects.ai")}
      unsaved={unsaved} invalid={invalid}
      onSave={async () => { await onSave({ aiEnabled: draft.aiEnabled, ...(Object.fromEntries(AI_LIMIT_FIELDS.map(({ key }) => [key, values[key]])) as Partial<ServerSettings>) }); setDraft(null); }}
      onDiscard={() => setDraft(null)}>
      <FormControl>
        <FormControlLabel
          control={<Switch checked={draft.aiEnabled && settings.aiConfigured} disabled={!settings.aiConfigured} onChange={(e) => setDraft({ ...draft, aiEnabled: e.target.checked })} />}
          label={t("server.aiEnabled")}
        />
        <FormHelperText sx={{ ml: 0 }}>{settings.aiConfigured ? t("server.aiEnabledHelp") : `${t("server.aiNotSetUp")} ${t("server.aiNotSetUpHelp")}`}</FormHelperText>
      </FormControl>
      <Typography variant="body2" color="text.secondary">{t("server.aiLimitsIntro")}</Typography>
      {AI_LIMIT_FIELDS.map(({ key, label, help, more }) => {
        const max = formatNumber(AI_LIMIT_MAX[key], language);
        return (
          <TextField
            key={key}
            label={t(label)}
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            error={values[key] === null}
            helperText={values[key] === null ? t("server.aiLimitInvalid", { max }) : <>{t(help, { max })}{more && <MoreInfo text={t(more, { max })} />}</>}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
          />
        );
      })}
    </SettingsGroup>
  );
}

/**
 * The Settings section of the server page: the groups of settings, each saved on its own; saving one keeps what is
 * changed and not saved in the others.
 */
export function ServerSettingsSection() {
  const t = useT();
  const { refreshInfo } = useApp();
  const settings = useLoad(getServerSettings, []);
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error || !settings.data) return <ErrorAlert error={settings.error} onRetry={settings.reload} />;
  const current = settings.data;
  const save: Save = async (changes) => {
    const next = await saveServerSettings(current, changes);
    settings.setData(next);
    void refreshInfo();
  };
  return (
    <Stack spacing={3}>
      <AccessGroup settings={current} onSave={save} />
      <DraftFields settings={current} onSave={save} group="limits" title={t("server.limits")} intro={t("server.limitsIntro")} affects={t("server.affects.limits")}
        keys={["maxProjectsPerUser", "maxProjectStorageMb"]}
        fields={[
          { key: "maxProjectsPerUser", label: "server.maxProjects", help: "server.maxProjectsHelp", numeric: true },
          { key: "maxProjectStorageMb", label: "server.maxStorage", help: "server.maxStorageHelp.short", more: "server.maxStorageHelp", numeric: true },
        ]} />
      <DraftFields settings={current} onSave={save} group="about" title={t("server.about")} intro={t("server.aboutIntro")} affects={t("server.affects.about")}
        keys={["serverName", "termsUrl", "contactEmail"]}
        fields={[
          { key: "serverName", label: "server.serverName", help: "server.serverNameHelp" },
          { key: "termsUrl", label: "server.termsUrl", help: "server.termsUrlHelp", type: "url" },
          { key: "contactEmail", label: "server.contactEmail", help: "server.contactEmailHelp", type: "email" },
        ]} />
      <AnnouncementGroup settings={current} onSave={save} />
      <AiGroup settings={current} onSave={save} />
    </Stack>
  );
}
