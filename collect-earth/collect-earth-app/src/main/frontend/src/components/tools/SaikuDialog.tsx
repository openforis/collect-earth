import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";
import type { AnalysisFlags } from "../../tools";
import { analysisFlags, startSaiku } from "../../toolsApi";
import { JobPanel } from "../data/JobPanel";
import { RefreshChoice } from "./RefreshChoice";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

/**
 * Analyse data with Saiku: the question about the dataset generated before, then the job that prepares it and
 * starts Saiku, which opens in the browser by itself as it did from the Swing menu.
 */
export function SaikuDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [flags, setFlags] = useState<AnalysisFlags | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFlags(null); setRefresh(false); setJobId(null); setError(null);
    const controller = new AbortController();
    analysisFlags(controller.signal).then(setFlags, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, t]);

  const start = () => {
    setBusy(true);
    setError(null);
    startSaiku(refresh).then((id) => { setJobId(id); setBusy(false); }, (e) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); });
  };
  const ready = flags !== null && flags.saikuFolderSet;

  return (
    <Dialog open={open} onClose={jobId && !busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="saiku-dialog">
      <DialogTitle>{s("CollectEarthWindow.14")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false}
              renderResult={() => <Alert severity="success">{s("ToolsPage.saiku.opened")}</Alert>} />
          ) : (
            <>
              {flags && !flags.saikuFolderSet && <Alert severity="warning">{s("ToolsPage.saiku.noFolder")}</Alert>}
              <RefreshChoice generated={flags?.saikuGenerated ?? false} refresh={refresh} onChange={setRefresh} texts={texts} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(jobId ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {!jobId && <Button variant="contained" onClick={start} disabled={!ready || busy}>{s(busy ? "ToolsPage.saiku.starting" : "ToolsPage.saiku.start")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
