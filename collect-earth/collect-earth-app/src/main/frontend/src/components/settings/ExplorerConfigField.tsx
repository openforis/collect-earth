import { useEffect, useRef, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useT } from "../../i18n";
import { configureUrl, explorerMessage, explorerOrigin, explorerSummary, type ExplorerMessage } from "../../explorerConfig";
import { serverText, type Texts } from "../../serverTexts";

/** How long the editor page has to say something before the dialog says the Explorer cannot be reached */
const UNREACHABLE_AFTER_MILLIS = 15000;

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  texts: Texts | null;
  /** The field to type the document in, shown under Advanced */
  rawField: ReactNode;
  /** gee_app_url, whose origin is the Explorer of the editor */
  explorerUrl?: string | null;
  /** A plot (latitude, longitude) for the editor's preview */
  point?: [number, number] | null;
}

/**
 * The Explorer window's layers and charts (explorer_config): a summary, Customize, which opens the Explorer's editor
 * page in a dialog and takes the document it posts, the field to paste one under Advanced, and the way back to the
 * standard window. In a cloud project only the summary: the coordinator sets it on the dashboard.
 */
export function ExplorerConfigField({ value, onChange, readOnly, texts, rawField, explorerUrl, point }: Props) {
  const s = (key: string) => serverText(texts, key);
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const summary = <Typography variant="body2" data-testid="explorer-config-summary">{explorerSummary(value, s)}</Typography>;
  if (readOnly) {
    return (
      <Stack spacing={0.5}>
        {summary}
        <Typography variant="body2" color="text.secondary">{s("SettingsPage.explorerConfig.coordinator")}</Typography>
      </Stack>
    );
  }
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        {summary}
        <Box sx={{ flex: 1 }} />
        {value.trim() !== "" && <Button size="small" onClick={() => onChange("")}>{s("SettingsPage.explorerConfig.reset")}</Button>}
        <Button variant="outlined" size="small" onClick={() => setEditing(true)}>{s("SettingsPage.explorerConfig.customize")}</Button>
      </Stack>
      <Box>
        <Button size="small" aria-expanded={advanced} aria-controls="explorer-config-advanced" onClick={() => setAdvanced(!advanced)}>
          {s("SettingsPage.explorerConfig.advanced")}
        </Button>
        <Collapse in={advanced} id="explorer-config-advanced">{rawField}</Collapse>
      </Box>
      {editing && <EditorDialog value={value} texts={texts} explorerUrl={explorerUrl} point={point}
        onClose={() => setEditing(false)} onUse={(config) => { onChange(config); setEditing(false); }} />}
    </Stack>
  );
}

function EditorDialog({ value, texts, explorerUrl, point, onClose, onUse }: {
  value: string; texts: Texts | null; explorerUrl?: string | null; point?: [number, number] | null;
  onClose: () => void; onUse: (config: string) => void;
}) {
  const s = (key: string) => serverText(texts, key);
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [reported, setReported] = useState<ExplorerMessage | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const origin = explorerOrigin(explorerUrl);
  // The address is the one the dialog opened with: a new one would reload the editor at each change
  const [src] = useState(() => configureUrl(origin, value, point, document.documentElement.lang || "en"));

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const message = explorerMessage(event, origin, frame.current?.contentWindow);
      if (message) setReported(message);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [origin]);
  useEffect(() => {
    if (reported) return;
    const timer = setTimeout(() => setUnreachable(true), UNREACHABLE_AFTER_MILLIS);
    return () => clearTimeout(timer);
  }, [reported]);

  return (
    <Dialog open fullScreen onClose={onClose} aria-labelledby="explorer-config-title">
      <DialogTitle id="explorer-config-title">{s("SettingsPage.explorerConfig.dialogTitle")}</DialogTitle>
      {unreachable && !reported && <Alert severity="warning" sx={{ mx: 3, mb: 1 }}>{s("SettingsPage.explorerConfig.unreachable")}</Alert>}
      <Box component="iframe" ref={frame} src={src} title={s("SettingsPage.explorerConfig.frame")}
        sx={{ flex: 1, border: 0, width: "100%", minHeight: 0 }} />
      <DialogActions>
        <Button onClick={onClose}>{t("appBar.cancel")}</Button>
        <Button variant="contained" disabled={!reported?.valid} onClick={() => reported && onUse(reported.config)}>
          {s("SettingsPage.explorerConfig.use")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
