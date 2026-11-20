import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useId, useRef, useState } from "react";
import { getOnePlace } from "../api";
import { EXPLORER_URL, getCatalogue } from "../api/explorer";
import { useApp } from "../appContext";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT, type Translate } from "../i18n";
import { useLoad } from "../useLoad";
import { configMessage, configureUrl, summarise, type ExplorerSummary } from "./explorerConfig";

const EXPLORER_ORIGIN = new URL(EXPLORER_URL).origin;
/** The setup page reports on load: without a word by then, it is taken as out of reach. */
const REPORT_WAIT_MS = 15_000;

function summaryText(t: Translate, s: ExplorerSummary | null): string {
  if (!s) return t("file.explorer.standard");
  const count = (n: number | "standard", one: Parameters<Translate>[0], many: Parameters<Translate>[0], standard: Parameters<Translate>[0]) =>
    n === "standard" ? t(standard) : n === 1 ? t(one) : t(many, { n });
  const counts = t("file.explorer.counts", {
    layers: count(s.layers, "file.explorer.layerCountOne", "file.explorer.layerCount", "file.explorer.standardLayers"),
    charts: count(s.charts, "file.explorer.chartCountOne", "file.explorer.chartCount", "file.explorer.standardCharts"),
  });
  return s.names.length ? t("file.explorer.summary", { counts, names: s.names.join(", ") }) : counts;
}

/**
 * The Imagery card's Explorer section: a summary of what the Explorer window shows for this project, and the
 * Explorer's own setup page in a dialog. `stored` is what the server has, `value` what the card holds now; `onChange`
 * gets the text to store. `disabled` while the Explorer window is off (its value is not sent then: imageryChanges).
 */
export function ExplorerSection({ projectId, stored, value, disabled, onChange }: {
  projectId: string; stored: string; value: string; disabled: boolean; onChange: (text: string) => void;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const catalogue = useLoad(["explorer", "catalogue"], getCatalogue);
  const summary = summaryText(t, summarise(value, catalogue.data));
  return (
    <Stack component="section" aria-labelledby={id} spacing={1} sx={disabled ? { color: "text.disabled" } : undefined}>
      <Box>
        <Typography variant="subtitle1" component="h3" id={id} sx={{ fontWeight: 600 }}>{t("file.explorer.title")}</Typography>
        <Explain variant="body2" text={t(disabled ? "file.explorer.off" : "file.explorer.explain")} />
      </Box>
      <Typography variant="body2" noWrap title={summary}>{summary}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outlined" disabled={disabled} onClick={() => setOpen(true)}>{t("file.explorer.customize")}</Button>
        {value !== "" && <Button size="small" disabled={disabled} onClick={() => onChange("")}>{t("file.explorer.reset")}</Button>}
      </Stack>
      {!disabled && value !== stored && <Alert severity="info">{t("file.explorer.notSaved")}</Alert>}
      {open && <ExplorerDialog projectId={projectId} value={value} onClose={() => setOpen(false)} onUse={(text) => { onChange(text); setOpen(false); }} />}
    </Stack>
  );
}

/** The Explorer's setup page, framed; mounted while open. MUI's Dialog takes focus in and gives it back on closing. */
function ExplorerDialog({ projectId, value, onClose, onUse }: { projectId: string; value: string; onClose: () => void; onUse: (text: string) => void }) {
  const t = useT();
  const { language } = useApp();
  const titleId = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  // Never fails: without a plot of the project, the page previews on its own sample plot
  const place = useLoad(["project", projectId, "onePlace"], () => getOnePlace(projectId).catch(() => null));
  const [report, setReport] = useState<{ config: string; valid: boolean } | null>(null);
  const [late, setLate] = useState(() => !navigator.onLine);
  // Fixed once the plot is known, so a later answer does not reload the page and lose the edits made in it
  const [url, setUrl] = useState<string | null>(null);
  if (url === null && !place.loading) setUrl(configureUrl(EXPLORER_URL, value, language, place.data));

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const message = configMessage(event, EXPLORER_ORIGIN, frame.current?.contentWindow);
      if (message) setReport(message);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);
  useEffect(() => {
    if (url === null) return;
    const timer = setTimeout(() => setLate(true), REPORT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [url]);

  return (
    <Dialog open fullScreen onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{t("file.explorer.dialogTitle")}</DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        {late && !report && <Alert severity="warning" sx={{ m: 2 }}>{t("file.explorer.unreachable")}</Alert>}
        {url === null ? <Loading /> : (
          <Box component="iframe" ref={frame} src={url} title={t("file.explorer.frameTitle")} sx={{ flex: 1, width: "100%", border: 0 }} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!report?.valid} onClick={() => report && onUse(report.config)}>{t("file.explorer.use")}</Button>
      </DialogActions>
    </Dialog>
  );
}
