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
import { formatText } from "../../settings";
import { chooseFile } from "../../settingsApi";
import type { DeleteCheck } from "../../tools";
import { deletePlotsCheck, startDeletePlots } from "../../toolsApi";
import { JobPanel } from "../data/JobPanel";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

/**
 * Delete plots from the database using a CSV: the file, checked against the key attributes before the question is
 * asked, then the job, which logs each row and ends with the counts.
 */
export function DeletePlotsDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [path, setPath] = useState("");
  const [check, setCheck] = useState<DeleteCheck | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setPath(""); setCheck(null); setJobId(null); setError(null); }
  }, [open]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const choose = () => chooseFile("OPEN", ["csv"]).then((chosen) => {
    if (!chosen) return;
    setPath(chosen);
    setCheck(null);
    setError(null);
    return deletePlotsCheck(chosen).then(setCheck);
  }, fail);
  const start = () => {
    setBusy(true);
    setError(null);
    startDeletePlots(path).then((id) => { setJobId(id); setBusy(false); }, fail);
  };

  return (
    <Dialog open={open} onClose={jobId && !busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="delete-plots-dialog">
      <DialogTitle>{s("ToolsPage.delete.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} renderResult={(job) => {
              const r = job.result as { deleted?: number; notFound?: number; failed?: number } | null;
              return <Alert severity={r?.failed ? "warning" : "success"}>{formatText(s("ToolsPage.delete.result"), r?.deleted ?? 0, r?.notFound ?? 0, r?.failed ?? 0)}</Alert>;
            }} />
          ) : (
            <>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={choose}>{s("ToolsPage.delete.file")}</Button>
                {path && <Typography variant="body2" noWrap title={path} sx={{ minWidth: 0 }}>{path}</Typography>}
              </Stack>
              {check && (check.ok
                ? <Alert severity="warning">{formatText(s("ToolsPage.delete.ok"), check.expected.join(", "))}</Alert>
                : <Alert severity="error" sx={{ whiteSpace: "pre-line" }}>{check.message}</Alert>)}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(jobId ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {!jobId && <Button variant="contained" color="error" onClick={start} disabled={!check?.ok || busy}>{s("ToolsPage.delete.start")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
