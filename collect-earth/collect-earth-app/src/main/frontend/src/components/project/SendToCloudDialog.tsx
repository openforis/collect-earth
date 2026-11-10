import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { cloudSendResultOf } from "../../project";
import { localRecordCount, startSendToCloud } from "../../projectApi";
import { formatText } from "../../settings";
import { serverText, type Texts } from "../../serverTexts";
import { JobPanel } from "../data/JobPanel";

interface Props { open: boolean; texts: Texts | null; operator: string | null; onClose: () => void }

/**
 * Data > Send this computer's records to the cloud project (CloudRecordsSender): how many there are, then the job
 * sending them, and what the cloud project said.
 */
export function SendToCloudDialog({ open, texts, operator, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [count, setCount] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCount(null); setJobId(null); setError(null); setBusy(false);
    const controller = new AbortController();
    localRecordCount(controller.signal).then(setCount, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, t]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const send = () => { setBusy(true); setError(null); startSendToCloud().then((id) => { setJobId(id); setBusy(false); }, fail); };
  const running = jobId !== null;

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} fullWidth maxWidth="sm" data-testid="send-to-cloud-dialog">
      <DialogTitle>{s("CloudSend.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} renderResult={(job) => {
              const r = cloudSendResultOf(job.result);
              return (
                <Stack spacing={1}>
                  <Alert severity={r.refused ? "warning" : "success"}>{formatText(s("CloudSend.done"), r.sent)}</Alert>
                  {r.refused > 0 && <Typography variant="body2">{formatText(s("CloudSend.refused"), r.refused)}</Typography>}
                  {r.reasons.map((x) => <Typography key={x.reason} variant="body2" color="text.secondary">{x.reason}: {x.count}</Typography>)}
                </Stack>
              );
            }} />
          ) : count === 0 ? (
            <DialogContentText>{s("CloudSend.none")}</DialogContentText>
          ) : count !== null && (
            <>
              <DialogContentText>{formatText(s("CloudSend.question"), count)}</DialogContentText>
              <DialogContentText>{formatText(s("CloudSend.underAccount"), operator ?? "")}</DialogContentText>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(running ? "DataPage.job.close" : "CloudSend.later")}</Button>
        {!running && <Button variant="contained" onClick={send} disabled={!count || busy}>{s("CloudSend.send")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
