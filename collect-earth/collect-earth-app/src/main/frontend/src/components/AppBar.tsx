import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import MuiAppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined";
import PersonIcon from "@mui/icons-material/Person";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SyncProblemOutlinedIcon from "@mui/icons-material/SyncProblemOutlined";
import { Logo } from "./Logo";
import { apiPut } from "../apiClient";
import type { AppInfo } from "../appInfo";
import { actionOf, comingSoon, errorText, operatorRequired, quitServer, type AppAction } from "../appBar";
import { droppedKind, droppedRefusal } from "../project";
import { cloudLogin, setErrorsShown as setErrorsShown_, uploadFile } from "../projectApi";
import { saveSettings } from "../settingsApi";
import { useT } from "../i18n";
import { CLOUD_DASHBOARD_NOTE, appMenus, type MenuItem as AppMenuItem } from "../menus";
import { type ChipIcon, type ProjectChip, cloudProjectOf, fallbackState, projectChip, serverOf, useCloudState, youChip } from "../cloud";
import { MenuEntryIcon } from "../menuIcons";
import { AppDrawer, DRAWER_ID } from "./AppDrawer";
import { serverText, type Texts } from "../serverTexts";
import { formatText } from "../settings";
import { ExportDialog } from "./data/ExportDialog";
import { ImportDialog } from "./data/ImportDialog";
import { runAction } from "../toolsApi";
import { DeletePlotsDialog } from "./tools/DeletePlotsDialog";
import { DivideCsvDialog } from "./tools/DivideCsvDialog";
import { IpccDialog } from "./tools/IpccDialog";
import { LoadKmlDialog } from "./tools/LoadKmlDialog";
import { MissingPlotsDialog } from "./tools/MissingPlotsDialog";
import { NoticeDialog } from "./notices/NoticeDialog";
import { CloudLoginDialog } from "./project/CloudLoginDialog";
import { CloudStatusDialog } from "./project/CloudStatusDialog";
import { ImportCepDialog } from "./project/ImportCepDialog";
import { ProjectsDialog } from "./project/ProjectsDialog";
import { JoinCloudDialog } from "./project/JoinCloudDialog";
import { LanguageDialog } from "./project/LanguageDialog";
import { SendToCloudDialog } from "./project/SendToCloudDialog";
import { SEND_TO_CLOUD } from "../notices";
import { AboutDialog } from "./help/AboutDialog";
import { TextDialog } from "./help/TextDialog";
import { RestartingOverlay } from "./settings/RestartingOverlay";

interface Props {
  info: AppInfo;
  texts: Texts | null;
  /** Reads /api/app again, after the operator changed. */
  reload: () => void;
  /** A narrow window, or Google Earth Web's panel: the menus go under one button, and the project name goes. */
  compact: boolean;
  /** Opens the settings page (the Settings menu). */
  onSettings: () => void;
}

/**
 * The bar over the page: the project and where it keeps its data (the project chip: this computer, or the cloud project
 * and its sending), the menus of the Swing window (menus.ts), you (your name, or the cloud account) and Quit. It asks for your name
 * when there is none, as the Swing window did at start-up, and once Collect Earth quits it covers the page, which can
 * do nothing more.
 */
export function AppBar({ info, texts, reload, compact, onSettings }: Props) {
  const t = useT();
  // Where the project keeps its data and how its sending goes; what /api/app knows until it is read
  const [cloudNow, refreshCloud] = useCloudState(info.cloud);
  const cloud = cloudNow ?? fallbackState(info.project, info.cloud);
  const server = serverOf(cloud.project);
  // The note of the cloud dashboard's entry names the server ({0}), in the wide menus and in the drawer; none while the
  // server is not known
  const barTexts = useMemo(() => (texts && info.cloud
    ? { ...texts, [CLOUD_DASHBOARD_NOTE]: server ? formatText(texts[CLOUD_DASHBOARD_NOTE] ?? "", server) : "" }
    : texts), [texts, info.cloud, server]);
  const s = (key: string) => serverText(barTexts, key);
  const menus = useMemo(() => appMenus({ plotsMap: info.plotsMap, surveyGuide: info.surveyGuide, client: info.client, cloud: info.cloud }), [info.plotsMap, info.surveyGuide, info.client, info.cloud]);
  // The menu open and the button it hangs from; the id is null for the drawer of the compact bar
  const [open, setOpen] = useState<{ anchor: HTMLElement; id: string | null } | null>(null);
  // The menu of the wide bar opened last: it keeps its entries and its button while it fades out
  const [wideMenu, setWideMenu] = useState<{ anchor: HTMLElement; id: string } | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  // The operator just saved, shown (and no longer missing) at once, until /api/app is read again
  const [savedOperator, setSavedOperator] = useState<string | null>(null);
  useEffect(() => setSavedOperator(null), [info]);
  const operator = savedOperator ?? info.operator;
  const [quitOpen, setQuitOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  // The dialog of a menu that is open
  const [dialog, setDialog] = useState<Exclude<AppAction, "quit" | "settings" | "analyse" | "dataFolder" | "openPlotsMap" | "myDashboard" | "surveyGuide" | "manual" | "support" | "updates" | "showExceptions"> | null>(null);
  // What a quick action (open the data folder, the manual...) answered when it could not be done
  const [actionError, setActionError] = useState<string | null>(null);
  const forced = operatorRequired({ ...info, operator });
  // Help > Show exception errors: the setting, flipped here as the server is told
  const [errorsShown, setErrorsShown] = useState(info.errorsShown);
  useEffect(() => setErrorsShown(info.errorsShown), [info.errorsShown]);
  // Cloud mode with nobody logged in: the question, then the login (CollectEarthWindow.promptCloudLogin)
  const [cloudPrompt, setCloudPrompt] = useState<"ask" | "login" | "done">("ask");
  useEffect(() => { if (info.cloudLoginNeeded) setCloudPrompt("ask"); }, [info.cloudLoginNeeded]);
  // A file dropped on the page, once the server has it: a project to import, a KML to load, a plots file to use
  const [dropped, setDropped] = useState<{ kind: "cep" | "kml" | "plots"; path: string } | null>(null);
  const [restarting, setRestarting] = useState(false);
  useDroppedFiles((file) => {
    const kind = droppedKind(file.name);
    if (!kind) { setActionError(s("ProjectPage.drop.unknown")); return; }
    const refusal = droppedRefusal(kind, info.cloud);
    if (refusal) { setActionError(s(refusal)); return; }
    uploadFile(file).then((r) => {
      setDropped({ kind, path: r.path });
      setDialog(kind === "cep" ? "importCep" : kind === "kml" ? "loadKml" : null);
    }, (e) => setActionError(errorText(e, t("appBar.unreachable"))));
  });
  const usePlotsFile = () => {
    if (!dropped) return;
    setDropped(null);
    saveSettings({ csv: dropped.path }).then((r) => { if (r.restart) setRestarting(true); else reload(); }, (e) => setActionError(errorText(e, t("appBar.unreachable"))));
  };

  // What each action does; typed by AppAction, so an action added to appBar.ts and not handled here does not compile
  const quick = (name: string) => () => runAction(name).catch((e) => setActionError(errorText(e, t("appBar.unreachable"))));
  const actions: Record<AppAction, () => void> = {
    quit: () => setQuitOpen(true), settings: onSettings,
    export: () => setDialog("export"), import: () => setDialog("import"),
    analyse: quick("openAnalysis"), lulucf: () => setDialog("lulucf"), loadKml: () => setDialog("loadKml"),
    dataFolder: quick("openDataFolder"), openPlotsMap: quick("openPlotsMap"), myDashboard: quick("openDashboard"),
    missingPlots: () => setDialog("missingPlots"), divideCsv: () => setDialog("divideCsv"), deletePlots: () => setDialog("deletePlots"),
    sendToCloud: () => setDialog("sendToCloud"),
    importCep: () => { setDropped(null); setDialog("importCep"); }, projects: () => setDialog("projects"), joinCloud: () => setDialog("joinCloud"), cloudStatus: () => setDialog("cloudStatus"), language: () => setDialog("language"),
    surveyGuide: quick("openSurveyGuide"), manual: quick("openManual"), support: quick("openSupport"), updates: quick("runUpdater"),
    log: () => setDialog("log"), disclaimer: () => setDialog("disclaimer"), about: () => setDialog("about"),
    showExceptions: () => {
      const shown = !errorsShown;
      setErrorsShown(shown);
      setErrorsShown_(shown).catch((e) => { setErrorsShown(!shown); setActionError(errorText(e, t("appBar.unreachable"))); });
    },
  };
  const close = () => { setDialog(null); setDropped(null); };
  // The offer made after joining a cloud project, answered with Send (NoticeDialog)
  useEffect(() => {
    const openSend = () => setDialog("sendToCloud");
    window.addEventListener(SEND_TO_CLOUD, openSend);
    return () => window.removeEventListener(SEND_TO_CLOUD, openSend);
  }, []);
  const toggles: Record<string, boolean> = { showExceptions: errorsShown };
  const run = (item: AppMenuItem) => {
    setOpen(null);
    const action = actionOf(item);
    if (action) actions[action]();
  };

  const entry = (item: AppMenuItem): ReactNode => {
    if (item.disabledReason) {
      // Looks disabled but is not, so the tooltip gets the pointer; aria-disabled keeps it an item of the list that
      // the keyboard and a screen reader find unavailable, and the tooltip describes it
      return (
        <Tooltip key={item.id} title={s(item.disabledReason)} placement="right" describeChild>
          <MenuItem aria-disabled="true" onClick={(e) => e.preventDefault()} sx={{ opacity: 0.38, cursor: "default", "&:hover": { bgcolor: "transparent" } }}>
            <ListItemIcon><MenuEntryIcon id={item.id} /></ListItemIcon>
            <ListItemText primary={s(item.label)} />
          </MenuItem>
        </Tooltip>
      );
    }
    if (!comingSoon(item) && item.kind === "toggle") {
      return (
        <MenuItem key={item.id} onClick={() => run(item)} role="menuitemcheckbox" aria-checked={toggles[item.id] ?? false}>
          <ListItemIcon><Checkbox size="small" checked={toggles[item.id] ?? false} tabIndex={-1} disableRipple sx={{ p: 0 }} /></ListItemIcon>
          <ListItemText primary={s(item.label)} />
        </MenuItem>
      );
    }
    if (!comingSoon(item)) {
      return (
        <MenuItem key={item.id} onClick={() => run(item)}>
          <ListItemIcon><MenuEntryIcon id={item.id} /></ListItemIcon>
          <ListItemText primary={s(item.label)} secondary={item.note ? s(item.note) : undefined} />
        </MenuItem>
      );
    }
    // "Coming soon" is written under the entry, not in a tooltip: a disabled entry gets no pointer events, and a
    // tooltip would need a wrapper, which is no item of the list for the keyboard or a screen reader
    return (
      <MenuItem key={item.id} disabled>
        <ListItemIcon>
          {item.kind === "toggle" ? <Checkbox disabled size="small" sx={{ p: 0 }} /> : <MenuEntryIcon id={item.id} />}
        </ListItemIcon>
        <ListItemText primary={s(item.label)} secondary={t("appBar.comingSoon")} />
      </MenuItem>
    );
  };

  const chip = projectChip(cloud, t, (iso) => new Date(iso).toLocaleString(info.language));
  // You in a cloud project: the account and its role (a local project has none)
  const you = youChip(cloud.project, operator, formatText(s("User.cloudTip"), cloud.project.account ?? operator ?? ""), t);
  // The login names the server and the cloud project once they are known
  const signInTo = cloud.project.mode === "cloud" && server ? t("cloud.signInTo", { server, project: cloudProjectOf(cloud.project) }) : null;

  if (closed) return <ClosedOverlay text={t("appBar.closed")} />;
  if (restarting) return <RestartingOverlay text={s("SettingsPage.restarting")} />;

  return (
    <MuiAppBar position="static" color="default" elevation={1}>
      {/* No media query (the gutters of Toolbar have one): in Google Earth Web's panel the frame is the whole window while a
          dialog is open (panelDialogs.ts), and the bar behind it would move */}
      <Toolbar variant="dense" disableGutters sx={{ gap: 1, px: compact ? 1 : 1.5 }}>
        {compact && (
          <IconButton edge="start" aria-label={t("appBar.menu")} id="app-menu-button-all"
            aria-controls={open?.id === null ? DRAWER_ID : undefined} aria-expanded={open?.id === null}
            onClick={(e) => setOpen({ anchor: e.currentTarget, id: null })}>
            {/* The three dots of today's apps: clearer than the three lines, as people told */}
            <MoreVertIcon />
          </IconButton>
        )}
        <Logo sx={{ height: 40, flexShrink: 0 }} />
        {!compact && info.project && (
          <Typography variant="subtitle1" noWrap title={info.project} sx={{ fontWeight: 600, minWidth: 0, flexShrink: 1, mr: 1 }}>
            {info.project}
          </Typography>
        )}
        {/* Where the project keeps its data, always in sight: this computer, or the cloud project and its sending */}
        {info.project && <ProjectChipView chip={chip} compact={compact} onStatus={() => setDialog("cloudStatus")} onSignIn={() => setCloudPrompt("login")} />}
        {!compact && menus.map((menu) => (
          <Button key={menu.id} color="inherit" size="small" sx={{ flexShrink: 0 }} aria-haspopup="menu"
            id={"app-menu-button-" + menu.id} aria-controls={open?.id === menu.id ? "app-menu" : undefined}
            aria-expanded={open?.id === menu.id}
            onClick={(e) => { setOpen({ anchor: e.currentTarget, id: menu.id }); setWideMenu({ anchor: e.currentTarget, id: menu.id }); }}>
            {s(menu.label)}
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        {/* The settings beside you, one click from the plot form, without going through the menus */}
        <Tooltip title={t("appBar.settingsTip")}>
          <IconButton size="small" aria-label={s("CollectEarthWindow.15")} onClick={onSettings} data-testid="settings-button">
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {/* You: in a cloud project the account signed in (its sync status on click; the project chip has the cloud's
            state), else the name you typed */}
        {info.cloud ? (
          info.cloudLoginNeeded ? (
            <Tooltip title={s("User.signInTip")}>
              <Chip icon={<LoginOutlinedIcon />} size="small" variant="outlined" onClick={() => setCloudPrompt("login")}
                label={s("User.signIn")} data-testid="user-chip" />
            </Tooltip>
          ) : (
            <Tooltip title={you.tip} describeChild>
              <Chip icon={<PersonIcon />} size="small" variant="outlined" onClick={() => setDialog("cloudStatus")}
                label={compact ? you.short : you.label} aria-label={you.name} sx={{ maxWidth: compact ? 140 : 280 }} data-testid="user-chip" />
            </Tooltip>
          )
        ) : (
          <Tooltip title={s("User.nameTip")}>
            <Chip icon={<PersonIcon />} size="small" variant="outlined" onClick={() => setOperatorOpen(true)}
              label={operator || s("User.name")} sx={{ maxWidth: compact ? 140 : 240 }} data-testid="user-chip" />
          </Tooltip>
        )}
        {/* Quit, always in sight and red, so it is not taken for anything else: closing the window only asks whether to quit, and the icon by the clock is easy to miss */}
        <Tooltip title={t("appBar.quitTip")}>
          {compact ? (
            <IconButton edge="end" color="error" aria-label={s("WindowClosed.quit")} onClick={() => setQuitOpen(true)} data-testid="quit-button">
              <PowerSettingsNewIcon />
            </IconButton>
          ) : (
            <Button color="error" size="small" startIcon={<PowerSettingsNewIcon />} onClick={() => setQuitOpen(true)}
              sx={{ flexShrink: 0 }} data-testid="quit-button">
              {s("CollectEarthWindow.42")}
            </Button>
          )}
        </Tooltip>
      </Toolbar>

      <Menu id="app-menu" anchorEl={wideMenu?.anchor} open={open !== null && open.id !== null && wideMenu !== null} onClose={() => setOpen(null)}
        slotProps={{ list: { "aria-labelledby": "app-menu-button-" + wideMenu?.id } }}>
        {wideMenu && menus.find((m) => m.id === wideMenu.id)?.items.map(entry)}
      </Menu>
      <AppDrawer open={open !== null && open.id === null} onClose={() => setOpen(null)} menus={menus} project={info.project}
        texts={barTexts} toggles={toggles} onRun={run} />

      <OperatorDialog open={forced || operatorOpen} forced={forced} operator={operator} texts={texts}
        onCancel={() => setOperatorOpen(false)}
        onSaved={(name) => { setSavedOperator(name); setOperatorOpen(false); reload(); }}
        onQuit={() => setQuitOpen(true)} />
      <QuitDialog open={quitOpen} texts={texts} onKeepOpen={() => setQuitOpen(false)} onClosed={() => setClosed(true)} />
      <ExportDialog open={dialog === "export"} texts={texts} language={info.language} onClose={close} />
      <ImportDialog open={dialog === "import"} texts={texts} language={info.language} onClose={close} />
      <IpccDialog open={dialog === "lulucf"} texts={texts} onClose={close} />
      <LoadKmlDialog open={dialog === "loadKml"} texts={texts} onClose={close} kml={dropped?.kind === "kml" ? dropped.path : null} />
      <MissingPlotsDialog open={dialog === "missingPlots"} texts={texts} onClose={close} />
      <DivideCsvDialog open={dialog === "divideCsv"} texts={texts} onClose={close} />
      <DeletePlotsDialog open={dialog === "deletePlots"} texts={texts} onClose={close} />
      <ImportCepDialog open={dialog === "importCep"} texts={texts} onClose={close} path={dropped?.kind === "cep" ? dropped.path : null} />
      <ProjectsDialog open={dialog === "projects"} texts={texts} onClose={close} onRestarting={() => setRestarting(true)} />
      <JoinCloudDialog open={dialog === "joinCloud"} texts={texts} onClose={close} />
      <SendToCloudDialog open={dialog === "sendToCloud"} texts={texts} operator={operator} onClose={close} />
      <CloudStatusDialog open={dialog === "cloudStatus"} texts={texts} language={info.language} cloud={cloudNow}
        onClose={() => { close(); refreshCloud(); }} />
      <LanguageDialog open={dialog === "language"} texts={texts} languages={info.languages} current={info.language} onClose={close} />
      <AboutDialog open={dialog === "about"} texts={texts} info={info} onClose={close} />
      <TextDialog open={dialog === "disclaimer"} texts={texts} name="disclaimer" onClose={close} />
      <TextDialog open={dialog === "log"} texts={texts} name="log" onClose={close} />
      {/* Cloud mode with nobody logged in: the question, then the login; Cancel leaves it, as the Swing window did. The
          login is also the project chip's, when the server no longer takes the sign-in */}
      <Dialog open={info.cloudLoginNeeded && cloudPrompt === "ask"} maxWidth="xs" data-testid="cloud-prompt">
        <DialogTitle>{signInTo ?? s("CloudLoginDialog.title")}</DialogTitle>
        <DialogContent><DialogContentText>{s("CollectEarthWindow.cloudNotLoggedIn")}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setCloudPrompt("done")}>{s("CloudLoginDialog.cancelButton")}</Button>
          <Button variant="contained" onClick={() => setCloudPrompt("login")} autoFocus>{s("CloudLoginDialog.loginButton")}</Button>
        </DialogActions>
      </Dialog>
      <CloudLoginDialog open={cloudPrompt === "login"} texts={texts} intro={signInTo} onCancel={() => setCloudPrompt("done")}
        onSubmit={(c) => cloudLogin(c.username, c.password, c.code).then((r) => { setSavedOperator(r.operator); setCloudPrompt("done"); reload(); refreshCloud(); })} />
      {/* A dropped plots file: use it as the project's plots file? */}
      <Dialog open={dropped?.kind === "plots" && dialog === null} maxWidth="sm" onClose={() => setDropped(null)} data-testid="drop-plots">
        <DialogTitle>{s("ProjectPage.drop.plotsTitle")}</DialogTitle>
        <DialogContent><DialogContentText sx={{ wordBreak: "break-all" }}>{formatText(s("ProjectPage.drop.plots"), dropped?.path ?? "")}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDropped(null)}>{t("appBar.cancel")}</Button>
          <Button variant="contained" onClick={usePlotsFile}>{s("ProjectPage.drop.use")}</Button>
        </DialogActions>
      </Dialog>
      <NoticeDialog />
      <Snackbar open={actionError !== null} autoHideDuration={6000} onClose={() => setActionError(null)} message={actionError} />
    </MuiAppBar>
  );
}

/**
 * Your name, written in each record you save (its operator). Without one (forced) the dialog cannot be closed: it takes a
 * valid name, or Quit, as the Swing window could not be used before. A cloud project uses the account instead.
 */
function OperatorDialog({ open, forced, operator, texts, onCancel, onSaved, onQuit }: {
  open: boolean; forced: boolean; operator: string | null; texts: Texts | null;
  onCancel: () => void; onSaved: (operator: string) => void; onQuit: () => void;
}) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Each opening starts from the operator there is
  useEffect(() => {
    if (open) { setValue(operator ?? ""); setError(null); }
  }, [open, operator]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const name = value.trim();
    apiPut("app/operator", { operator: name })
      .then(() => onSaved(name))
      // The API's refusals (operator.length, operator.cloud) come with their message in the UI language
      .catch((err) => setError(errorText(err, t("appBar.unreachable"))))
      .finally(() => setSaving(false));
  };

  return (
    // Neither Escape nor a click outside closes it while forced
    <Dialog open={open} fullWidth maxWidth="xs" onClose={forced ? undefined : onCancel}>
      {/* A form, so Enter in the field saves */}
      <Box component="form" onSubmit={save}>
      <DialogTitle>{s("User.name")}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{s(forced ? "User.nameAsk" : "User.nameTip")}</DialogContentText>
        <TextField autoFocus fullWidth margin="dense" label={s("User.name")} value={value}
          onChange={(e) => setValue(e.target.value)} error={error !== null} helperText={error ?? " "}
          slotProps={{ htmlInput: { maxLength: 100 } }} />
      </DialogContent>
      <DialogActions>
        {forced
          ? <Button color="error" onClick={onQuit} sx={{ mr: "auto" }}>{s("CollectEarthWindow.42")}</Button>
          : <Button onClick={onCancel}>{t("appBar.cancel")}</Button>}
        <Button type="submit" variant="contained" disabled={saving || !value.trim()}>{s("User.save")}</Button>
      </DialogActions>
      </Box>
    </Dialog>
  );
}

/** The Swing window's confirmation before quitting, which stops the server. */
function QuitDialog({ open, texts, onKeepOpen, onClosed }: {
  open: boolean; texts: Texts | null; onKeepOpen: () => void; onClosed: () => void;
}) {
  const s = (key: string) => serverText(texts, key);
  const [quitting, setQuitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  const quit = () => {
    setQuitting(true);
    quitServer().then(onClosed, (e) => { setError(errorText(e, "")); setQuitting(false); });
  };

  return (
    <Dialog open={open} onClose={quitting ? undefined : onKeepOpen} maxWidth="xs">
      <DialogTitle>{s("CollectEarthWindow.23")}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ whiteSpace: "pre-line" }}>{s("CollectEarthWindow.22")}</DialogContentText>
        {error && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onKeepOpen} disabled={quitting} autoFocus>{s("CollectEarthWindow.37")}</Button>
        <Button color="error" variant="contained" onClick={quit} disabled={quitting}>{s("CollectEarthWindow.42")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Over everything once Collect Earth has quit: the page stays in the browser, but no call would be answered. */
function ClosedOverlay({ text }: { text: string }) {
  return (
    <Box role="alert" sx={{
      position: "fixed", inset: 0, zIndex: (theme) => theme.zIndex.modal + 1, bgcolor: "background.default",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, p: 3, textAlign: "center",
    }}>
      <Logo sx={{ height: 64 }} />
      <Typography variant="h6">{text}</Typography>
    </Box>
  );
}

/**
 * A file dropped anywhere on the page, as the Swing window took one dropped on it (CollectEarthTransferHandler): one
 * file at a time. The browser would otherwise open the file in place of the page.
 */
function useDroppedFiles(onFile: (file: File) => void) {
  const handler = useRef(onFile);
  handler.current = onFile;
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      handler.current(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, []);
}

const CHIP_ICONS: Record<ChipIcon, ReactElement> = {
  computer: <ComputerOutlinedIcon />, cloud: <CloudOutlinedIcon />, sent: <CloudDoneOutlinedIcon />, waiting: <CloudUploadOutlinedIcon />,
  offline: <CloudOffOutlinedIcon />, failed: <SyncProblemOutlinedIcon />, signIn: <LoginOutlinedIcon />,
};

/**
 * The project chip (cloud.ts, projectChip): its icon and words, only the icon in the compact bar, the whole of it as its
 * name and the tooltip as its description. A click shows the sync status, or the login when the server wants one.
 */
function ProjectChipView({ chip, compact, onStatus, onSignIn }: { chip: ProjectChip; compact: boolean; onStatus: () => void; onSignIn: () => void }) {
  const onClick = chip.action === "status" ? onStatus : chip.action === "signIn" ? onSignIn : undefined;
  return (
    <Tooltip title={chip.tip} describeChild>
      {/* A local project's chip does nothing, but takes the focus, for its tooltip to be read */}
      <Chip icon={CHIP_ICONS[chip.icon]} size="small" variant="outlined" color={chip.color} onClick={onClick}
        label={chip.status ? chip.label + " · " + chip.status : chip.label} aria-label={chip.name}
        {...(onClick ? {} : { tabIndex: 0, role: "img" })} data-testid="project-chip" data-state={chip.icon}
        sx={{ flexShrink: compact ? 0 : 1, minWidth: 0, maxWidth: 320,
          ...(compact && { "& .MuiChip-label": { display: "none" }, "& .MuiChip-icon": { mx: "4px !important" } }) }} />
    </Tooltip>
  );
}
