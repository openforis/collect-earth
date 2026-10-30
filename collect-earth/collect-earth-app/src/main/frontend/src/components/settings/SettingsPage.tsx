import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import { ApiError } from "../../apiClient";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import {
  changeCount, changes, defaultsOf, formatText, isChanged, isVisible, proposeReferenceDistance, restartNeeded, sectionsMatching,
  type Field, type SampleFileCheck, type Section, type Settings, type Validation, type Values,
} from "../../settings";
import {
  checkSampleFile, debounced, latestOnly, loadSettings, openBackupFolder, saveSettings, testCloud, testDatabase, validateSettings,
  type ConnectionTest,
} from "../../settingsApi";
import { serverText, type Texts } from "../../serverTexts";
import { PlotPreview } from "./PlotPreview";
import { ProjectsCard } from "./ProjectsCard";
import { RestartingOverlay } from "./RestartingOverlay";
import { SampleFileCard } from "./SampleFileCard";
import { SettingField } from "./SettingField";

/** How long after the last keystroke the values are sent for validation, and the plots file for its check */
const VALIDATE_AFTER_MILLIS = 300;
const CHECK_FILE_AFTER_MILLIS = 500;
const NAV_WIDTH = 220;

interface Props {
  texts: Texts | null;
  /** A narrow window: the sections in a select over the fields instead of a column beside them */
  compact: boolean;
  onClose: () => void;
  /** The settings were applied without a restart: the app bar reads /api/app again (the viewer may have changed) */
  onApplied: () => void;
}

/**
 * The settings page, which replaces the Swing properties dialog: the sections (SettingsModel) on the left, the open
 * one on the right, a search over every setting, and at the bottom the changes not applied with Apply and Discard.
 * The values are validated by the server as they change; the plot section draws its preview, the project section
 * checks the plots file and lists the projects. Applying saves the changes, and restarts Collect Earth when one of
 * them needs it.
 */
export function SettingsPage({ texts, compact, onClose, onApplied }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [data, setData] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [stored, setStored] = useState<Values>({});
  const [values, setValues] = useState<Values>({});
  const [validation, setValidation] = useState<Validation | null>(null);
  /** The errors of a refused Apply, shown until the next validation */
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [sectionId, setSectionId] = useState<string>("project");
  const [query, setQuery] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [fileCheck, setFileCheck] = useState<SampleFileCheck | null>(null);
  const [checkingFile, setCheckingFile] = useState(false);
  const [fileCheckError, setFileCheckError] = useState<string | null>(null);
  /** Set when the reference area shape changed: the next validation proposes a distance (the Swing panel did) */
  const propose = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    loadSettings(controller.signal).then((settings) => {
      if (controller.signal.aborted) return;
      setData(settings);
      setStored(settings.values);
      setValues(settings.values);
    }, (e) => { if (!controller.signal.aborted) setLoadError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [loadAttempt, t]);

  const validate = useMemo(() => latestOnly((signal: AbortSignal, v: Values) => validateSettings(v, signal)), []);
  const validateSoon = useMemo(() => debounced((v: Values) => {
    validate(v).then((r) => { if (r) { setValidation(r); setRefused({}); } }, () => { /* the next change tries again */ });
  }, VALIDATE_AFTER_MILLIS), [validate]);
  const checkFile = useMemo(() => latestOnly((signal: AbortSignal, path: string) => checkSampleFile(path, signal)), []);
  const checkFileSoon = useMemo(() => debounced((path: string) => {
    setCheckingFile(true);
    checkFile(path).then((r) => {
      if (r === undefined) return;
      setFileCheck(r);
      setFileCheckError(null);
      setCheckingFile(false);
    }, (e) => { setFileCheckError(errorText(e, t("appBar.unreachable"))); setCheckingFile(false); });
  }, CHECK_FILE_AFTER_MILLIS), [checkFile, t]);
  useEffect(() => () => { validateSoon.cancel(); checkFileSoon.cancel(); }, [validateSoon, checkFileSoon]);

  // The first validation and file check, once the settings are in
  useEffect(() => {
    if (!data) return;
    validateSoon(data.values);
    if (data.values.csv) checkFileSoon(data.values.csv);
  }, [data, validateSoon, checkFileSoon]);

  const change = useCallback((key: string, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "buffer_shape") propose.current = true;
      if (key === "csv") checkFileSoon(value);
      validateSoon(next);
      return next;
    });
  }, [validateSoon, checkFileSoon]);

  useEffect(() => {
    if (!propose.current || !validation) return;
    propose.current = false;
    const distance = proposeReferenceDistance(values, validation.plot);
    if (distance != null) change("distance_to_buffers", String(distance));
  }, [validation, values, change]);

  const sections = data?.sections ?? [];
  const fields = useMemo(() => sections.flatMap((sec) => sec.fields), [sections]);
  const changed = useMemo(() => changes(stored, values, fields), [stored, values, fields]);
  const count = changeCount(changed);
  const errors = useMemo(() => ({ ...(validation?.errors ?? {}), ...refused }), [validation, refused]);
  const visibleErrors = fields.some((f) => isVisible(f, values) && errors[f.key] !== undefined);
  const fileBlocked = fileCheck !== null && !!values.csv && fileCheck.problems.some((p) => p.blocking);
  const restart = restartNeeded(fields, changed);
  const matching = useMemo(() => sectionsMatching(sections, texts, query, values), [sections, texts, query, values]);
  const searching = query.trim() !== "";

  const apply = () => {
    setApplying(true);
    setApplyError(null);
    saveSettings(changed).then((r) => {
      if (r.restart) {
        setRestarting(true);
        return;
      }
      setStored((prev) => ({ ...prev, ...changed }));
      setNotice(s("PropertiesDialog.settingsApplied"));
      onApplied();
    }, (e) => {
      if (e instanceof ApiError && e.code === "settings.invalid" && e.body && typeof e.body.errors === "object" && e.body.errors) {
        setRefused(e.body.errors as Record<string, string>);
      }
      setApplyError(errorText(e, t("appBar.unreachable")));
    }).finally(() => setApplying(false));
  };
  const discard = () => { setValues(stored); setRefused({}); validateSoon(stored); if (stored.csv !== values.csv) checkFileSoon(stored.csv ?? ""); };
  const close = () => { if (count > 0) setClosing(true); else onClose(); };

  const renderField = (field: Field): ReactNode => {
    const props = {
      field, value: values[field.key] ?? "", values, texts, error: errors[field.key], warning: validation?.warnings[field.key],
      changed: isChanged(stored, values, field.key), onChange: (v: string) => change(field.key, v),
    };
    if (field.key === "csv") {
      return <SampleFileCard key={field.key} {...props} check={fileCheck} checking={checkingFile} checkError={fileCheckError} />;
    }
    return <SettingField key={field.key} {...props} />;
  };

  const renderSection = (section: Section, withTitle: boolean) => {
    const visible = section.fields.filter((f) => isVisible(f, values));
    return (
      <Stack key={section.id} spacing={2.5} data-testid={"section-" + section.id}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          {withTitle && <Typography variant="h6" component="h2">{s(section.label)}</Typography>}
          {!searching && (
            <Button size="small" onClick={() => { for (const [k, v] of Object.entries(defaultsOf(section, values))) change(k, v); }}>
              {s("SettingsPage.restoreDefaults")}
            </Button>
          )}
        </Stack>
        {section.hint && !searching && <Typography variant="body2" color="text.secondary">{s(section.hint)}</Typography>}
        {section.id === "plot" && !searching ? (
          <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
            <Stack spacing={2.5} sx={{ flex: 1, minWidth: 0 }}>{visible.map(renderField)}</Stack>
            <Box sx={{ width: { md: 320 }, flexShrink: 0 }}><PlotPreview values={values} plot={validation?.plot ?? null} texts={texts} /></Box>
          </Stack>
        ) : visible.map(renderField)}
        {!searching && <SectionExtras section={section} values={values} data={data} texts={texts}
          onRestarting={() => setRestarting(true)} onMessage={setNotice} />}
      </Stack>
    );
  };

  if (restarting) return <RestartingOverlay text={s("SettingsPage.restarting")} />;

  const nav = (
    compact ? (
      <TextField select size="small" fullWidth value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label={s("SettingsPage.title")}>
        {sections.map((sec) => <MenuItem key={sec.id} value={sec.id}>{s(sec.label)}</MenuItem>)}
      </TextField>
    ) : (
      <List dense sx={{ width: NAV_WIDTH, flexShrink: 0 }} aria-label={s("SettingsPage.title")}>
        {sections.map((sec) => (
          <ListItemButton key={sec.id} selected={sec.id === sectionId} onClick={() => setSectionId(sec.id)} sx={{ borderRadius: 1 }}>
            <ListItemText primary={s(sec.label)} />
          </ListItemButton>
        ))}
      </List>
    )
  );

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }} data-testid="settings-page">
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, py: 1 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600, flexShrink: 0 }}>{s("SettingsPage.title")}</Typography>
        <Box sx={{ flex: 1 }} />
        <TextField size="small" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s("SettingsPage.search")}
          aria-label={s("SettingsPage.search")} sx={{ width: { xs: 160, sm: 260 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
        <IconButton onClick={close} aria-label={s("SettingsPage.close")}><CloseIcon /></IconButton>
      </Stack>
      {loadError && (
        <Alert severity="error" sx={{ mx: 2 }} action={<Button color="inherit" size="small" onClick={() => setLoadAttempt((n) => n + 1)}>{s("SettingsPage.retry")}</Button>}>
          {formatText(s("SettingsPage.loadError"), loadError)}
        </Alert>
      )}
      {!data && !loadError && <LinearProgress sx={{ mx: 2 }} />}
      {data && (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: compact ? "column" : "row", gap: 2, px: 2 }}>
          {!searching && nav}
          <Box sx={{ flex: 1, minWidth: 0, overflow: "auto", pb: 2 }}>
            <Box sx={{ maxWidth: 820 }}>
              {searching ? (
                matching.length === 0
                  ? <Typography color="text.secondary">{formatText(s("SettingsPage.search.none"), query.trim())}</Typography>
                  : (
                    <Stack spacing={3}>
                      {matching.map((sec) => (
                        <Box key={sec.id}>
                          <ListSubheader disableSticky sx={{ px: 0 }}>{s(sec.label)}</ListSubheader>
                          {renderSection(sec, false)}
                        </Box>
                      ))}
                    </Stack>
                  )
              ) : sections.filter((sec) => sec.id === sectionId).map((sec) => renderSection(sec, true))}
            </Box>
          </Box>
        </Box>
      )}
      <Paper square elevation={3} sx={{ px: 2, py: 1, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }} data-testid="apply-bar">
        <Typography variant="body2" color={count ? "text.primary" : "text.secondary"} sx={{ fontWeight: count ? 600 : 400 }}>
          {count === 0 ? s("SettingsPage.noChanges") : count === 1 ? s("SettingsPage.oneChange") : formatText(s("SettingsPage.changes"), count)}
        </Typography>
        {count > 0 && restart && <Typography variant="body2" color="warning.main">{s("SettingsPage.restartNote")}</Typography>}
        {(visibleErrors || fileBlocked) && count > 0 && <Typography variant="body2" color="error">{s("SettingsPage.applyBlocked")}</Typography>}
        {applyError && <Typography variant="body2" color="error">{applyError}</Typography>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={discard} disabled={count === 0 || applying}>{s("SettingsPage.discard")}</Button>
        <Button variant="contained" onClick={apply} disabled={count === 0 || applying || visibleErrors || fileBlocked}>
          {applying ? s("PropertiesDialog.applyingChanges") : s("SettingsPage.apply")}
        </Button>
      </Paper>
      <Dialog open={closing} onClose={() => setClosing(false)} maxWidth="xs">
        <DialogTitle>{s("SettingsPage.title")}</DialogTitle>
        <DialogContent><DialogContentText>{s("SettingsPage.unsavedChanges")}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setClosing(false)} autoFocus>{s("SettingsPage.keepEditing")}</Button>
          <Button color="error" onClick={() => { setClosing(false); onClose(); }}>{s("SettingsPage.discard")}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice} />
    </Box>
  );
}

/** What a section shows besides its fields: the projects, the connection tests, the backup folder. */
function SectionExtras({ section, values, data, texts, onRestarting, onMessage }: {
  section: Section; values: Values; data: Settings | null; texts: Texts | null; onRestarting: () => void; onMessage: (m: string) => void;
}) {
  const s = (key: string) => serverText(texts, key);
  if (section.id === "project") return <ProjectsCard texts={texts} onRestarting={onRestarting} onMessage={onMessage} />;
  if (section.id === "storage") {
    const postgres = values.db_driver === "POSTGRESQL";
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">{s("OptionWizard.4")} {data?.info.computerIp}</Typography>
        {postgres ? (
          <ConnectionTestButton label={s("OptionWizard.135")} testing={s("SettingsPage.testing")} test={() => testDatabase({
            host: values.db_host ?? "", port: values.db_port ?? "", name: values.db_name ?? "", username: values.db_username ?? "", password: values.db_password ?? "",
          })} />
        ) : (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="outlined" size="small" onClick={() => openBackupFolder().catch(() => { /* the folder may not exist yet */ })}>
              {s("OptionWizard.10")}
            </Button>
            <Typography variant="caption" color="text.secondary">{data?.info.backupFolder}</Typography>
          </Stack>
        )}
      </Stack>
    );
  }
  if (section.id === "collaboration") {
    return (
      <ConnectionTestButton label={s("DatabaseServerPanel.cloudTestButton")} testing={s("SettingsPage.testing")} test={() => testCloud({
        url: values.cloud_sync_url ?? "", projectId: values.cloud_project_id ?? "", token: values.cloud_sync_token ?? "",
      })} />
    );
  }
  return null;
}

/** A Test connection button with the answer under it, as the dialogs of the Swing panels. */
function ConnectionTestButton({ label, testing, test }: { label: string; testing: string; test: () => Promise<ConnectionTest> }) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const run = () => {
    setRunning(true);
    setResult(null);
    test().then(setResult, (e) => setResult({ ok: false, message: errorText(e, t("appBar.unreachable")) })).finally(() => setRunning(false));
  };
  return (
    <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
      <Button variant="outlined" size="small" onClick={run} disabled={running}>{running ? testing : label}</Button>
      {result && <Alert severity={result.ok ? "success" : "error"} sx={{ whiteSpace: "pre-line" }}>{result.message}</Alert>}
    </Stack>
  );
}
