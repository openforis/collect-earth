import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";
import { formatText, type SampleFileCheck } from "../../settings";
import { checkSampleFile, chooseFile } from "../../settingsApi";
import { divideReady, MAX_FILES_TO_DIVIDE_INTO, type DivideCsvRequest } from "../../tools";
import { divideCsvColumns, startDivideCsv } from "../../toolsApi";
import { JobPanel } from "../data/JobPanel";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

/**
 * Divide a large CSV file of plots: the file (checked as the plots file is, as the Swing dialog checked it), how
 * many files, whether to shuffle, a column to stratify by, the folder; then the job.
 */
export function DivideCsvDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [request, setRequest] = useState<DivideCsvRequest>({ source: "", folder: "", files: 2, randomize: false, column: null });
  const [files, setFiles] = useState("2");
  const [columns, setColumns] = useState<string[]>([]);
  const [check, setCheck] = useState<SampleFileCheck | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequest({ source: "", folder: "", files: 2, randomize: false, column: null }); setFiles("2"); setCheck(null); setJobId(null); setError(null);
    const controller = new AbortController();
    divideCsvColumns(controller.signal).then(setColumns, () => { /* then no column to split by is offered */ });
    return () => controller.abort();
  }, [open]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const chooseSource = () => chooseFile("OPEN", ["csv"]).then((chosen) => {
    if (!chosen) return;
    setRequest((r) => ({ ...r, source: chosen }));
    setCheck(null);
    return checkSampleFile(chosen).then(setCheck);
  }, fail);
  const chooseFolder = () => chooseFile("FOLDER").then((chosen) => { if (chosen) setRequest((r) => ({ ...r, folder: chosen })); }, fail);
  const setCount = (value: string) => { setFiles(value); setRequest((r) => ({ ...r, files: value.trim() === "" ? NaN : Number(value) })); };
  const start = () => {
    setBusy(true);
    setError(null);
    startDivideCsv(request).then((id) => { setJobId(id); setBusy(false); }, fail);
  };
  const blocked = request.source !== "" && (check === null || check.problems.some((p) => p.blocking));
  const countOk = Number.isInteger(request.files) && request.files >= 1 && request.files <= MAX_FILES_TO_DIVIDE_INTO;

  return (
    <Dialog open={open} onClose={jobId && !busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="divide-csv-dialog">
      <DialogTitle>{s("ToolsPage.divide.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {jobId ? (
            <JobPanel jobId={jobId} texts={texts} openableFile={false} />
          ) : (
            <>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={chooseSource}>{s("ToolsPage.divide.source")}</Button>
                {request.source && <Typography variant="body2" noWrap title={request.source} sx={{ minWidth: 0 }}>{request.source}</Typography>}
              </Stack>
              {check && check.plots > 0 && !blocked && <Typography variant="body2" color="text.secondary">{formatText(s("SettingsPage.sampleFile.plots"), check.plots)}</Typography>}
              {check?.problems.filter((p) => p.blocking).map((p) => <Alert key={p.code} severity="error" sx={{ whiteSpace: "pre-line" }}>{p.message}</Alert>)}
              <TextField label={s("ToolsPage.divide.files")} type="number" size="small" value={files} onChange={(e) => setCount(e.target.value)}
                error={!countOk} slotProps={{ htmlInput: { min: 1, max: MAX_FILES_TO_DIVIDE_INTO } }} sx={{ maxWidth: 260 }} />
              <FormControlLabel control={<Switch checked={request.randomize} onChange={(e) => setRequest({ ...request, randomize: e.target.checked })} />}
                label={s("ToolsPage.divide.randomize")} />
              <FormControl size="small" sx={{ maxWidth: 360 }}>
                <InputLabel id="divide-column">{s("ToolsPage.divide.column")}</InputLabel>
                <Select labelId="divide-column" label={s("ToolsPage.divide.column")} value={request.column === null ? "" : String(request.column)}
                  onChange={(e) => setRequest({ ...request, column: e.target.value === "" ? null : Number(e.target.value) })}>
                  <MenuItem value="">{s("ToolsPage.divide.noColumn")}</MenuItem>
                  {columns.map((c, i) => <MenuItem key={i} value={String(i)}>{c}</MenuItem>)}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={chooseFolder}>{s("ToolsPage.divide.folder")}</Button>
                {request.folder && <Typography variant="body2" noWrap title={request.folder} sx={{ minWidth: 0 }}>{request.folder}</Typography>}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(jobId ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {!jobId && <Button variant="contained" onClick={start} disabled={!divideReady(request, blocked) || busy}>{s("ToolsPage.divide.start")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
