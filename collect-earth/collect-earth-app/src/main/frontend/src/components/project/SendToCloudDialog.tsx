import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { cloudSendResultOf } from "../../project";
import { localRecords, startSendToCloud, type LocalRecords } from "../../projectApi";
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
  const [local, setLocal] = useState<LocalRecords | null>(null);
  const [all, setAll] = useState(false);
  const count = local?.count ?? null;
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocal(null); setAll(false); setJobId(null); setError(null); setBusy(false);
    const controller = new AbortController();
    localRecords(controller.signal).then(setLocal, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, t]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const send = () => { setBusy(true); setError(null); startSendToCloud(all).then((id) => { setJobId(id); setBusy(false); }, fail); };
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
              {local && local.others > 0 && (
                <>
                  <DialogContentText>{formatText(s("CloudSend.others"), local.others)}</DialogContentText>
                  <DialogContentText>{formatText(s("CloudSend.mine"), local.mine)}</DialogContentText>
                  <FormControlLabel
                    control={<Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="send-others" />}
                    label={formatText(s("CloudSend.includeOthers"), local.others)}
                  />
                </>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(running ? "DataPage.job.close" : "CloudSend.later")}</Button>
        {!running && <Button variant="contained" onClick={send} disabled={!count || busy || (!all && local !== null && local.mine === 0)}>{s("CloudSend.send")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
