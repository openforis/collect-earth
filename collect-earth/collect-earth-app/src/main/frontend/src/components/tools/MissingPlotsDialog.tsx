import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { chooseFiles } from "../../dataApi";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";
import { formatText } from "../../settings";
import { chooseFile } from "../../settingsApi";
import { missingResultOf, type MissingPlotsResult } from "../../tools";
import { copyFile, startMissingPlots } from "../../toolsApi";
import { JobPanel } from "../data/JobPanel";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

/**
 * Find missing plots in the database: the files with the plots, the job, then the report it wrote, to copy or to
 * save as CSV (the server copies the temporary file it wrote where the user says).
 */
export function MissingPlotsDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [files, setFiles] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setFiles([]); setJobId(null); setError(null); setNotice(null); }
  }, [open]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const choose = () => chooseFiles(["csv", "ced"]).then((chosen) => { if (chosen.length) setFiles(chosen); }, fail);
  const start = () => {
    setBusy(true);
    setError(null);
    startMissingPlots(files).then((id) => { setJobId(id); setBusy(false); }, fail);
  };
  const copy = (result: MissingPlotsResult) =>
    navigator.clipboard.writeText(result.text).then(() => setNotice(s("ToolsPage.missing.copied")), fail);
  const save = (result: MissingPlotsResult) => {
    if (!result.csv) return;
    chooseFile("SAVE", ["csv"], "missing_plots.csv")
      .then((to) => (to ? copyFile(result.csv as string, to).then((r) => setNotice(formatText(s("ToolsPage.missing.saved"), r.path))) : undefined))
      .catch(fail);
  };

  return (
    <Dialog open={open} onClose={jobId && !busy ? undefined : onClose} fullWidth maxWidth="md" data-testid="missing-plots-dialog">
      <DialogTitle>{s("ToolsPage.missing.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} renderResult={(job) => {
              const result = missingResultOf(job.result);
              if (!result) return <Alert severity="success">{s("DataPage.job.done")}</Alert>;
              return (
                <Stack spacing={1.5} data-testid="missing-plots-result">
                  <Alert severity={result.totalMissing > 0 ? "warning" : "success"}>
                    {result.totalMissing > 0 ? formatText(s("ToolsPage.missing.summary"), result.totalMissing, result.totalPlots) : s("ToolsPage.missing.none")}
                  </Alert>
                  <Box component="pre" sx={{ m: 0, p: 1, maxHeight: 280, overflow: "auto", fontSize: 12, bgcolor: "action.hover", borderRadius: 1, whiteSpace: "pre-wrap" }}>
                    {result.text}
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => copy(result)}>{s("ToolsPage.missing.copy")}</Button>
                    {result.csv && result.totalMissing > 0 && <Button size="small" onClick={() => save(result)}>{s("ToolsPage.missing.save")}</Button>}
                  </Stack>
                </Stack>
              );
            }} />
          ) : (
            <>
              <Alert severity="info">{s("ToolsPage.missing.intro")}</Alert>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={choose}>{s("DataPage.import.chooseFiles")}</Button>
                {files.length > 0 && <Typography variant="body2">{formatText(s("DataPage.import.filesChosen"), files.length)}</Typography>}
              </Stack>
              {files.map((f) => <Typography key={f} variant="caption" color="text.secondary" noWrap title={f}>{f}</Typography>)}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(jobId ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {!jobId && <Button variant="contained" onClick={start} disabled={files.length === 0 || busy}>{s("ToolsPage.missing.start")}</Button>}
      </DialogActions>
      <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice} />
    </Dialog>
  );
}
