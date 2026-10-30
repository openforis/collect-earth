import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { openFile, revealFile } from "../../dataApi";
import { useT } from "../../i18n";
import { isOver, progressOf, resultPath, useJob, type JobInfo } from "../../jobs";
import { serverText, type Texts } from "../../serverTexts";

interface Props {
  jobId: string;
  texts: Texts | null;
  /** What to say and show once the job is done, from its result; the default says Done and offers the file it names */
  renderResult?: (job: JobInfo) => React.ReactNode;
  /** Told once, when the job ends, whatever its state */
  onOver?: (job: JobInfo) => void;
  /** The result names a file the system can open (an export): offer Open file */
  openableFile?: boolean;
}

/**
 * The progress of a job (JobService), followed until it is over: the bar, the step, the last lines of its log,
 * Cancel; then what it ended as, with the file it wrote to open or reveal. Replaces the ProgressMonitor dialogs
 * of the Swing exports and imports.
 */
export function JobPanel({ jobId, texts, renderResult, onOver, openableFile = true }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const { job, error, cancelling, cancel } = useJob(jobId);
  const [openError, setOpenError] = useState<string | null>(null);
  const told = useRef(false);
  useEffect(() => {
    if (job && isOver(job) && !told.current) {
      told.current = true;
      onOver?.(job);
    }
  }, [job, onOver]);
  const percent = progressOf(job);
  const over = isOver(job);
  const path = job ? resultPath(job.result) : null;
  const act = (call: Promise<void>) => call.catch((e) => setOpenError(errorText(e, t("appBar.unreachable"))));

  return (
    <Stack spacing={1.5} data-testid="job-panel" data-state={job?.state}>
      {!over && (
        <Box>
          <LinearProgress variant={percent === null ? "indeterminate" : "determinate"} value={percent ?? undefined} sx={{ height: 8, borderRadius: 4 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{job?.step ?? ""}</Typography>
        </Box>
      )}
      {job?.state === "DONE" && (renderResult ? renderResult(job) : <Alert severity="success">{s("DataPage.job.done")}</Alert>)}
      {job?.state === "FAILED" && <Alert severity="error" sx={{ whiteSpace: "pre-line" }}>{s("DataPage.job.failed")}{job.error ? ": " + job.error : ""}</Alert>}
      {job?.state === "CANCELLED" && <Alert severity="warning">{s("DataPage.job.cancelled")}</Alert>}
      {error && !job && <Alert severity="error">{error}</Alert>}
      {job && job.messages.length > 0 && (
        <Box component="pre" sx={{ m: 0, p: 1, maxHeight: 160, overflow: "auto", fontSize: 12, bgcolor: "action.hover", borderRadius: 1, whiteSpace: "pre-wrap" }}
          aria-label={s("DataPage.job.log")}>
          {job.messages.join("\n")}
        </Box>
      )}
      {openError && <Alert severity="error" onClose={() => setOpenError(null)}>{openError}</Alert>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        {!over && <Button color="error" onClick={cancel} disabled={cancelling || !job}>{s(cancelling ? "DataPage.job.cancelling" : "DataPage.job.cancel")}</Button>}
        {over && path && openableFile && job?.state === "DONE" && <Button onClick={() => act(openFile(path))}>{s("DataPage.job.openFile")}</Button>}
        {over && path && <Button onClick={() => act(revealFile(path))}>{s("DataPage.job.openFolder")}</Button>}
      </Stack>
    </Stack>
  );
}
