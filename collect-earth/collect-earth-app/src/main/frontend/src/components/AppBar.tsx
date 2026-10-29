import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import PersonIcon from "@mui/icons-material/Person";
import logo from "../form/collect-earth-logo.png";
import { ApiError, apiPut } from "../apiClient";
import type { AppInfo } from "../appInfo";
import { actionOf, comingSoon, operatorRequired, quitServer, type AppAction } from "../appBar";
import { useT } from "../i18n";
import { appMenus, type MenuItem as AppMenuItem } from "../menus";
import { serverText, type Texts } from "../serverTexts";

interface Props {
  info: AppInfo;
  texts: Texts | null;
  /** Reads /api/app again, after the operator changed. */
  reload: () => void;
  /** A narrow window, or Google Earth Web's panel: the menus go under one button, and the project name goes. */
  compact: boolean;
}

/** The message of an error as the user should see it: the API's own (already in the UI language), or the error's. */
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The bar over the page: the menus of the Swing window (menus.ts), the operator and Quit. It also asks for the operator
 * when there is none, as the Swing window did at start-up, and once Collect Earth quits it covers the page, which can
 * do nothing more.
 */
export function AppBar({ info, texts, reload, compact }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const menus = useMemo(() => appMenus({ plotsMap: info.plotsMap }), [info.plotsMap]);
  // The menu open and the button it hangs from; the id is null for the single menu of the compact bar
  const [open, setOpen] = useState<{ anchor: HTMLElement; id: string | null } | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  // Saved, the operator is no longer missing, even before /api/app is read again: the dialog closes at once
  const [operatorSaved, setOperatorSaved] = useState(false);
  const [quitOpen, setQuitOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const forced = operatorRequired(info) && !operatorSaved;

  // What each action does; typed by AppAction, so an action added to appBar.ts and not handled here does not compile
  const actions: Record<AppAction, () => void> = { quit: () => setQuitOpen(true) };
  const run = (item: AppMenuItem) => {
    setOpen(null);
    const action = actionOf(item);
    if (action) actions[action]();
  };

  const entry = (item: AppMenuItem): ReactNode => {
    if (!comingSoon(item)) return <MenuItem key={item.id} onClick={() => run(item)}>{s(item.label)}</MenuItem>;
    // A disabled entry gets no pointer events, so the tooltip hangs from a wrapper around it
    return (
      <Tooltip key={item.id} title={t("appBar.comingSoon")} placement="right">
        <Box component="span" sx={{ display: "block" }}>
          <MenuItem disabled>
            {item.kind === "toggle" && (
              <ListItemIcon><Checkbox disabled size="small" sx={{ p: 0 }} /></ListItemIcon>
            )}
            {s(item.label)}
          </MenuItem>
        </Box>
      </Tooltip>
    );
  };

  if (closed) return <ClosedOverlay text={t("appBar.closed")} />;

  return (
    <MuiAppBar position="static" color="default" elevation={1}>
      <Toolbar variant="dense" sx={{ gap: 1, px: { xs: 1, sm: 1.5 } }}>
        {compact && (
          <IconButton edge="start" aria-label={t("appBar.menu")} onClick={(e) => setOpen({ anchor: e.currentTarget, id: null })}>
            <MenuIcon />
          </IconButton>
        )}
        {/* The logo is drawn for a white background, also in the dark scheme */}
        <Box component="img" src={logo} alt="Open Foris Collect Earth"
          sx={{ height: 26, px: 0.5, py: "2px", bgcolor: "#fff", borderRadius: 1, flexShrink: 0 }} />
        {!compact && info.project && (
          <Typography variant="subtitle1" noWrap title={info.project} sx={{ fontWeight: 600, minWidth: 0, flexShrink: 1, mr: 1 }}>
            {info.project}
          </Typography>
        )}
        {!compact && menus.map((menu) => (
          <Button key={menu.id} color="inherit" size="small" sx={{ flexShrink: 0 }} aria-haspopup="menu"
            onClick={(e) => setOpen({ anchor: e.currentTarget, id: menu.id })}>
            {s(menu.label)}
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={s("CollectEarthWindow.66")}>
          <Chip icon={<PersonIcon />} size="small" variant="outlined" onClick={() => setOperatorOpen(true)}
            label={info.operator || s("CollectEarthWindow.26")} sx={{ maxWidth: compact ? 140 : 240 }} />
        </Tooltip>
      </Toolbar>

      <Menu anchorEl={open?.anchor} open={open !== null} onClose={() => setOpen(null)}>
        {open?.id == null
          ? menus.flatMap((menu) => [<ListSubheader key={"menu." + menu.id}>{s(menu.label)}</ListSubheader>, ...menu.items.map(entry)])
          : menus.find((m) => m.id === open.id)?.items.map(entry)}
      </Menu>

      <OperatorDialog open={forced || operatorOpen} forced={forced} info={info} texts={texts}
        onCancel={() => setOperatorOpen(false)}
        onSaved={() => { setOperatorSaved(true); setOperatorOpen(false); reload(); }}
        onQuit={() => setQuitOpen(true)} />
      <QuitDialog open={quitOpen} texts={texts} onKeepOpen={() => setQuitOpen(false)} onClosed={() => setClosed(true)} />
    </MuiAppBar>
  );
}

/**
 * The operator, written in each record. Without one (forced) the dialog cannot be closed: it takes a valid name, or
 * Quit, as the Swing window could not be used before.
 */
function OperatorDialog({ open, forced, info, texts, onCancel, onSaved, onQuit }: {
  open: boolean; forced: boolean; info: AppInfo; texts: Texts | null;
  onCancel: () => void; onSaved: () => void; onQuit: () => void;
}) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Each opening starts from the operator there is
  useEffect(() => {
    if (open) { setValue(info.operator ?? ""); setError(null); }
  }, [open, info.operator]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    apiPut("app/operator", { operator: value.trim() })
      .then(onSaved)
      // The API's refusals (operator.length, operator.cloud) come with their message in the UI language
      .catch((err) => setError(err instanceof ApiError ? err.message : messageOf(err)))
      .finally(() => setSaving(false));
  };

  return (
    // Neither Escape nor a click outside closes it while forced
    <Dialog open={open} fullWidth maxWidth="xs" onClose={forced ? undefined : onCancel}>
      {/* A form, so Enter in the field saves */}
      <Box component="form" onSubmit={save}>
      <DialogTitle>{s("CollectEarthWindow.26")}</DialogTitle>
      <DialogContent>
        {forced && (
          <DialogContentText sx={{ whiteSpace: "pre-line", mb: 2 }}>{s("CollectEarthWindow.35")}</DialogContentText>
        )}
        <TextField autoFocus fullWidth margin="dense" label={s("CollectEarthWindow.66")} value={value}
          onChange={(e) => setValue(e.target.value)} error={error !== null} helperText={error ?? " "}
          slotProps={{ htmlInput: { maxLength: 100 } }} />
      </DialogContent>
      <DialogActions>
        {forced
          ? <Button color="error" onClick={onQuit} sx={{ mr: "auto" }}>{s("CollectEarthWindow.42")}</Button>
          : <Button onClick={onCancel}>{t("appBar.cancel")}</Button>}
        <Button type="submit" variant="contained" disabled={saving || !value.trim()}>{s("CollectEarthWindow.27")}</Button>
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
    quitServer().then(onClosed, (e) => { setError(messageOf(e)); setQuitting(false); });
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
      <Box component="img" src={logo} alt="Open Foris Collect Earth" sx={{ height: 48, px: 1, py: 0.5, bgcolor: "#fff", borderRadius: 1 }} />
      <Typography variant="h6">{text}</Typography>
    </Box>
  );
}
