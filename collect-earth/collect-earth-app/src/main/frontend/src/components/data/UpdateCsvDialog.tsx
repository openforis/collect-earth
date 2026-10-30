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
import { chooseFiles, csvInfo, startUpdateCsv } from "../../dataApi";
import { useT } from "../../i18n";
import { csvFilesOf } from "../../importDialog";
import { formatText } from "../../settings";
import { serverText, type Texts } from "../../serverTexts";
import { JobPanel } from "./JobPanel";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

/** Update current records using CSV: the columns the files need, the files, the job with its rows and problems. */
export function UpdateCsvDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [keys, setKeys] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFiles([]); setJobId(null); setError(null);
    const controller = new AbortController();
    csvInfo(controller.signal).then((r) => setKeys(r.keyAttributes), () => { /* the note then names no attributes */ });
    return () => controller.abort();
  }, [open]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const choose = () => chooseFiles(["csv"]).then((chosen) => { if (chosen.length) setFiles(chosen); }, fail);
  const start = () => {
    setBusy(true);
    setError(null);
    startUpdateCsv(files).then((id) => { setJobId(id); setBusy(false); }, fail);
  };

  return (
    <Dialog open={open} onClose={jobId && !busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="update-csv-dialog">
      <DialogTitle>{s("CollectEarthWindow.55")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} renderResult={(job) => (
              <Stack spacing={1}>
                <Alert severity="success">{s("ImportProcessMonitorDialog.updateFinished")}</Alert>
                {csvFilesOf(job.result).map((f) => (
                  <Typography key={f.path} variant="body2">
                    {f.name}: {formatText(s("DataPage.csv.updated"), f.updated)}
                    {f.errors.length > 0 && " · " + formatText(s("DataPage.csv.rowsWithErrors"), f.errors.length)}
                  </Typography>
                ))}
              </Stack>
            )} />
          ) : (
            <>
              <Alert severity="info">{formatText(s("DataPage.csv.info"), keys.join(", "))}</Alert>
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
        {!jobId && <Button variant="contained" onClick={start} disabled={files.length === 0 || busy}>{s(busy ? "DataPage.csv.updating" : "DataPage.csv.start")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
