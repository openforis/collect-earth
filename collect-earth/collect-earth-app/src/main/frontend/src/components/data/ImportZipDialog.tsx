import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { chooseFiles, startImport, startImportSummary, summaryResultOf } from "../../dataApi";
import { useT } from "../../i18n";
import { canImport, overwritePaths, totals, type ImportFileSummary, type ImportSummaryResult } from "../../importDialog";
import type { JobInfo } from "../../jobs";
import { formatText } from "../../settings";
import { serverText, type Texts } from "../../serverTexts";
import { JobPanel } from "./JobPanel";

interface Props { open: boolean; texts: Texts | null; language: string; onClose: () => void }

type Step = "choose" | "reading" | "answer" | "importing";

/**
 * Import new data from ZIP, in the steps the Swing import took with its dialogs: the files and whether to take the
 * plots not fully assessed, the reading of the files (a job), the answer about the records already in the
 * database, the import (a job).
 */
export function ImportZipDialog({ open, texts, language, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [files, setFiles] = useState<string[]>([]);
  const [includeNonFinished, setIncludeNonFinished] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [jobId, setJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummaryResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setFiles([]); setIncludeNonFinished(false); setStep("choose"); setJobId(null); setSummary(null); setAnswers({}); setError(null); }
  }, [open]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const choose = () => chooseFiles(["zip", "collect-data"]).then((chosen) => { if (chosen.length) setFiles(chosen); }, fail);
  const read = () => {
    setBusy(true);
    setError(null);
    startImportSummary(files, includeNonFinished).then((id) => { setJobId(id); setStep("reading"); setBusy(false); }, fail);
  };
  const summaryRead = (job: JobInfo) => {
    if (job.state === "DONE") {
      setSummary(summaryResultOf(job.result));
      setStep("answer");
    }
  };
  const doImport = () => {
    if (!summary?.token) return;
    setBusy(true);
    setError(null);
    startImport(summary.token, overwritePaths(summary.files, answers)).then((id) => { setJobId(id); setStep("importing"); setBusy(false); }, fail);
  };
  const counts = summary ? totals(summary.files, answers) : null;
  const when = (millis: number | null) => (millis == null ? "" : new Date(millis).toLocaleString(language));

  return (
    <Dialog open={open} onClose={step === "reading" || step === "importing" ? undefined : onClose} fullWidth maxWidth="md" data-testid="import-zip-dialog">
      <DialogTitle>{s("CollectEarthWindow.46")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {step === "choose" && (
            <>
              <Alert severity="info">{s("CollectEarthWindow.39")}</Alert>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={choose}>{s("DataPage.import.chooseFiles")}</Button>
                {files.length > 0 && <Typography variant="body2">{formatText(s("DataPage.import.filesChosen"), files.length)}</Typography>}
              </Stack>
              {files.map((f) => <Typography key={f} variant="caption" color="text.secondary" noWrap title={f}>{f}</Typography>)}
              <FormControl>
                <FormLabel sx={{ whiteSpace: "pre-line" }}>{s("ImportActionListener.0")}</FormLabel>
                <RadioGroup value={includeNonFinished ? "all" : "finished"} onChange={(e) => setIncludeNonFinished(e.target.value === "all")}>
                  <FormControlLabel value="finished" control={<Radio size="small" />} label={s("ImportActionListener.11")} />
                  <FormControlLabel value="all" control={<Radio size="small" />} label={s("ImportActionListener.10")} />
                </RadioGroup>
              </FormControl>
            </>
          )}
          {step === "reading" && jobId && <JobPanel jobId={jobId} texts={texts} onOver={summaryRead} openableFile={false} />}
          {step === "answer" && summary && (
            <>
              {summary.files.map((file) => <FileSummary key={file.path} file={file} texts={texts} answer={answers[file.path] === true}
                onAnswer={(overwrite) => setAnswers({ ...answers, [file.path]: overwrite })} when={when} />)}
              {counts && (counts.total > 0
                ? <Typography variant="body2">{formatText(s("DataPage.import.summaryLine"), counts.toImport, counts.overwritten, counts.kept)}</Typography>
                : <Alert severity="warning">{s("DataPage.import.nothing")}</Alert>)}
            </>
          )}
          {step === "importing" && jobId && (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} renderResult={(job) => {
              const r = job.result as { imported?: number; overwritten?: number } | null;
              return <Alert severity="success">{formatText(s("DataPage.import.imported"), r?.imported ?? 0, r?.overwritten ?? 0)}</Alert>;
            }} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(step === "importing" ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {step === "choose" && <Button variant="contained" onClick={read} disabled={files.length === 0 || busy}>{s(busy ? "DataPage.import.reading" : "DataPage.import.read")}</Button>}
        {step === "answer" && <Button variant="contained" onClick={doImport} disabled={!canImport(summary, answers) || busy}>{s(busy ? "DataPage.import.importing" : "DataPage.import.start")}</Button>}
      </DialogActions>
    </Dialog>
  );
}

/** What one file holds: the records to import, the conflicting ones with the question about them, the errors. */
function FileSummary({ file, texts, answer, onAnswer, when }: {
  file: ImportFileSummary; texts: Texts | null; answer: boolean; onAnswer: (overwrite: boolean) => void; when: (millis: number | null) => string;
}) {
  const s = (key: string) => serverText(texts, key);
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="file-summary">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="subtitle2" noWrap title={file.path}>{file.name}</Typography>
          <Chip size="small" label={file.toImport > 0 ? formatText(s("DataPage.import.toImport"), file.toImport) : s("DataPage.import.nothingInFile")}
            color={file.toImport > 0 ? "primary" : "default"} variant="outlined" />
        </Stack>
        {file.errors.map((e, i) => <Alert key={i} severity="error" sx={{ whiteSpace: "pre-line" }}>{e}</Alert>)}
        {file.conflicts.length > 0 && (
          <Stack spacing={1}>
            <Alert severity="warning">
              {s("CollectEarthWindow.9")} {formatText(s("DataPage.import.conflicts"), file.conflicts.length)}. {s("CollectEarthWindow.25")}
            </Alert>
            <FormControlLabel control={<Switch checked={answer} onChange={(e) => onAnswer(e.target.checked)} />}
              label={s(answer ? "DataPage.import.overwrite" : "DataPage.import.keep")} />
            <Paper variant="outlined" sx={{ maxHeight: 220, overflow: "auto" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{s("DataPage.import.record")}</TableCell>
                    <TableCell>{s("DataPage.import.inFile")}</TableCell>
                    <TableCell>{s("DataPage.import.inDatabase")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {file.conflicts.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell>{c.keys.join(", ")}</TableCell>
                      <TableCell>{when(c.modified)} {"·"} {formatText(s("DataPage.import.filled"), c.completion)}</TableCell>
                      <TableCell>{when(c.existingModified)} {"·"} {formatText(s("DataPage.import.filled"), c.existingCompletion)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
