import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";
import { chooseFile } from "../../settingsApi";
import type { AnalysisFlags } from "../../tools";
import { analysisFlags, startSaikuTool } from "../../toolsApi";
import { JobPanel } from "../data/JobPanel";
import { RefreshChoice } from "./RefreshChoice";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

/**
 * Generate the stand-alone Saiku tool: the ZIP to write, the question about the dataset generated before, then the
 * job. Only on Windows, as the tool is, which the server says.
 */
export function SaikuToolDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [flags, setFlags] = useState<AnalysisFlags | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [path, setPath] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFlags(null); setRefresh(false); setPath(""); setJobId(null); setError(null);
    const controller = new AbortController();
    analysisFlags(controller.signal).then(setFlags, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, t]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const choose = () => chooseFile("SAVE", ["zip"], path || "collectEarthSaikuTool.zip").then((chosen) => { if (chosen) setPath(chosen); }, fail);
  const start = () => {
    setBusy(true);
    setError(null);
    startSaikuTool(refresh, path).then((id) => { setJobId(id); setBusy(false); }, fail);
  };
  const ready = flags !== null && flags.saikuToolAvailable && path !== "";

  return (
    <Dialog open={open} onClose={jobId && !busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="saiku-tool-dialog">
      <DialogTitle>{s("CollectEarthWindow.71")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} />
          ) : (
            <>
              {flags && !flags.saikuToolAvailable && <Alert severity="warning">{s("ToolsPage.saikuTool.windowsOnly")}</Alert>}
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={choose} disabled={flags !== null && !flags.saikuToolAvailable}>{s("ToolsPage.saikuTool.file")}</Button>
                {path && <Typography variant="body2" noWrap title={path} sx={{ minWidth: 0 }}>{path}</Typography>}
              </Stack>
              <RefreshChoice generated={flags?.saikuGenerated ?? false} refresh={refresh} onChange={setRefresh} texts={texts} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(jobId ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {!jobId && <Button variant="contained" onClick={start} disabled={!ready || busy}>{s("ToolsPage.saikuTool.start")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
