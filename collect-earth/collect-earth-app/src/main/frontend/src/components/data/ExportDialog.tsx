import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { exportFileName, exportOptions, startExport, type ExportOptions } from "../../dataApi";
import { emptyRequest, EXTENSIONS, FORMATS, lastExportText, missing, nameKey, recordsFor, replaceFileName, withFormat, type ExportFormat, type ExportRequest } from "../../exportDialog";
import { useT } from "../../i18n";
import { formatText } from "../../settings";
import { chooseFile, latestOnly } from "../../settingsApi";
import { serverText, type Texts } from "../../serverTexts";
import { JobPanel } from "./JobPanel";

interface Props { open: boolean; texts: Texts | null; language: string; onClose: () => void }

/**
 * The export dialog, in place of the nine export entries of the Swing Data Import/Export menu: the format, which
 * records (what the format offers), the CSV option, and where to, with the name the server suggests; then the job.
 */
export function ExportDialog({ open, texts, language, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [request, setRequest] = useState<ExportRequest>(emptyRequest());
  const [suggested, setSuggested] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const askName = useMemo(() => latestOnly((signal: AbortSignal, r: ExportRequest) => {
    const { path: _path, ...withoutPath } = r;
    return exportFileName(withoutPath, signal);
  }), []);

  useEffect(() => {
    if (!open) return;
    setRequest(emptyRequest());
    setJobId(null);
    setError(null);
    const controller = new AbortController();
    exportOptions(controller.signal).then(setOptions, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, t]);

  // The suggested name follows the choices; a path chosen already takes the new name
  const key = nameKey(request);
  useEffect(() => {
    if (!open) return;
    askName(request).then((r) => {
      if (!r) return;
      setSuggested(r.name);
      setRequest((prev) => (prev.path ? { ...prev, path: replaceFileName(prev.path, r.name) } : prev));
    }, () => { /* the request is not complete yet: the server says so once it is */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const attributes = options?.attributes ?? [];
  const problems = missing(request, attributes);
  const browse = async () => {
    const path = await chooseFile("SAVE", [EXTENSIONS[request.format]], request.path || suggested).catch((e) => { setError(errorText(e, t("appBar.unreachable"))); return null; });
    if (path) setRequest((prev) => ({ ...prev, path }));
  };
  const start = () => {
    setStarting(true);
    setError(null);
    startExport({ ...request, value: request.value.trim(), fromDate: request.fromDate.trim() })
      .then(setJobId, (e) => setError(errorText(e, t("appBar.unreachable")))).finally(() => setStarting(false));
  };
  const lastExport = options ? lastExportText(options.lastExport, language) : null;

  return (
    <Dialog open={open} onClose={jobId && !starting ? undefined : onClose} fullWidth maxWidth="sm" data-testid="export-dialog">
      <DialogTitle>{s("DataPage.export.title")}</DialogTitle>
      <DialogContent>
        {jobId ? (
          <JobPanel jobId={jobId} texts={texts} renderResult={(job) => (
            <Alert severity="success">
              {s("DataPage.job.done")}
              {typeof (job.result as { records?: unknown })?.records === "number" && request.format !== "KML"
                && " · " + formatText(s("DataPage.job.records"), (job.result as { records: number }).records)}
            </Alert>
          )} />
        ) : (
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl>
              <FormLabel sx={{ mb: 1 }}>{s("DataPage.export.format")}</FormLabel>
              <ToggleButtonGroup exclusive value={request.format} size="small" color="primary" sx={{ flexWrap: "wrap" }}
                onChange={(_, format: ExportFormat | null) => { if (format) setRequest(withFormat(request, format)); }}>
                {FORMATS.map((f) => <ToggleButton key={f} value={f} data-testid={"format-" + f}>{s("DataPage.export.format." + f).split(" (")[0]}</ToggleButton>)}
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>{s("DataPage.export.format." + request.format)}</Typography>
            </FormControl>
            {request.format === "CSV" && (
              <>
                <Alert severity="info">{s("ExportActionListener.2")}</Alert>
                <FormControlLabel control={<Switch checked={request.includeLabels} onChange={(e) => setRequest({ ...request, includeLabels: e.target.checked })} />}
                  label={s("ExportActionListener.includeLabelsQuestion")} />
              </>
            )}
            {recordsFor(request.format).length > 1 && (
              <FormControl>
                <FormLabel>{s("DataPage.export.records")}</FormLabel>
                <RadioGroup value={request.records} onChange={(e) => setRequest({ ...request, records: e.target.value as ExportRequest["records"] })}>
                  {recordsFor(request.format).map((r) => (
                    <FormControlLabel key={r} value={r} control={<Radio size="small" />} label={s("DataPage.export.records." + r)} />
                  ))}
                </RadioGroup>
              </FormControl>
            )}
            {request.records === "SINCE_LAST_EXPORT" && (
              <Typography variant="body2" color="text.secondary">
                {lastExport ? formatText(s("DataPage.export.lastExport"), lastExport) : s("DataPage.export.noLastExport")}
              </Typography>
            )}
            {request.records === "FROM_DATE" && (
              <TextField type="date" size="small" label={s("ExportActionListener.1")} value={request.fromDate}
                onChange={(e) => setRequest({ ...request, fromDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ maxWidth: 260 }} />
            )}
            {request.records === "BY_ATTRIBUTE" && (
              attributes.length === 0 ? <Alert severity="warning">{s("ExportActionListener.7")}</Alert> : (
                <Stack spacing={1.5}>
                  <TextField select size="small" label={s("ExportActionListener.4")} value={request.attribute}
                    onChange={(e) => setRequest({ ...request, attribute: e.target.value })}>
                    {attributes.map((a) => <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>)}
                  </TextField>
                  <TextField size="small" label={s("ExportActionListener.5")} value={request.value} helperText={s("ExportActionListener.6")}
                    onChange={(e) => setRequest({ ...request, value: e.target.value })} />
                </Stack>
              )
            )}
            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
              <TextField size="small" fullWidth label={s("DataPage.export.file")} value={request.path} placeholder={suggested}
                onChange={(e) => setRequest({ ...request, path: e.target.value })} />
              <Button variant="outlined" size="small" onClick={browse} sx={{ flexShrink: 0, mt: "2px" }}>{s("OptionWizard.50")}</Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s(jobId ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {!jobId && (
          <Button variant="contained" onClick={start} disabled={problems.length > 0 || starting || !options}
            title={problems.map(s).join("\n") || undefined}>
            {s(starting ? "DataPage.export.exporting" : "DataPage.export.start")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
