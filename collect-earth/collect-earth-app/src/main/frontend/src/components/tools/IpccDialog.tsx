import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import type { JobInfo } from "../../jobs";
import { serverText, type Texts } from "../../serverTexts";
import { chooseFile } from "../../settingsApi";
import { initialIpccState, ipccAnswers, ipccComplete, type AnalysisFlags, type IpccAnswer, type IpccCategory, type IpccForm, type IpccState } from "../../tools";
import { analysisFlags, startIpccOutputs, startIpccPrepare } from "../../toolsApi";
import { JobPanel } from "../data/JobPanel";
import { RefreshChoice } from "./RefreshChoice";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

type Step = "prepare" | "preparing" | "form" | "generating";

/**
 * Generate the LULUCF (IPCC) package, in the steps of the Swing entry: the question about the dataset generated
 * before and the job that prepares it; the form that replaces the wizard (the country, the attribute with the
 * region, a management type for every land use subdivision found in the data, the ZIP to write); the job that
 * produces the package.
 */
export function IpccDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [flags, setFlags] = useState<AnalysisFlags | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [step, setStep] = useState<Step>("prepare");
  const [jobId, setJobId] = useState<string | null>(null);
  const [form, setForm] = useState<IpccForm | null>(null);
  const [state, setState] = useState<IpccState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFlags(null); setRefresh(false); setStep("prepare"); setJobId(null); setForm(null); setState(null); setError(null);
    const controller = new AbortController();
    analysisFlags(controller.signal).then(setFlags, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, t]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const prepare = () => {
    setBusy(true);
    setError(null);
    startIpccPrepare(refresh).then((id) => { setJobId(id); setStep("preparing"); setBusy(false); }, fail);
  };
  const prepared = (job: JobInfo) => {
    if (job.state === "DONE" && job.result) {
      const f = job.result as IpccForm;
      setForm(f);
      setState(initialIpccState(f));
      setStep("form");
    }
  };
  const choose = () => state && chooseFile("SAVE", ["zip"], state.path || "lulucf.zip").then((chosen) => { if (chosen) setState({ ...state, path: chosen }); }, fail);
  const generate = () => {
    if (!form || !state) return;
    setBusy(true);
    setError(null);
    startIpccOutputs(ipccAnswers(form, state)).then((id) => { setJobId(id); setStep("generating"); setBusy(false); }, fail);
  };
  const running = step === "preparing" || step === "generating";

  return (
    <Dialog open={open} onClose={running || busy ? undefined : onClose} fullWidth maxWidth="md" data-testid="ipcc-dialog">
      <DialogTitle>{s("CollectEarthWindow.72")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {step === "prepare" && (
            <RefreshChoice generated={flags?.ipccGenerated ?? false} refresh={refresh} onChange={setRefresh} texts={texts} />
          )}
          {step === "preparing" && jobId && <JobPanel jobId={jobId} texts={texts} onOver={prepared} openableFile={false} />}
          {step === "form" && form && state && (
            <>
              <Typography variant="subtitle1">{s("ToolsPage.ipcc.form")}</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="ipcc-country">{s("ToolsPage.ipcc.country")}</InputLabel>
                  <Select labelId="ipcc-country" label={s("ToolsPage.ipcc.country")} value={state.country} onChange={(e) => setState({ ...state, country: e.target.value })}>
                    {form.countries.map((c) => <MenuItem key={c.code} value={c.code}>{c.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel id="ipcc-region">{s("ToolsPage.ipcc.region")}</InputLabel>
                  <Select labelId="ipcc-region" label={s("ToolsPage.ipcc.region")} value={state.regionAttribute} onChange={(e) => setState({ ...state, regionAttribute: e.target.value })}>
                    {form.attributes.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              {form.categories.map((category) => (
                <CategoryTable key={category.code} category={category} answers={state.answers} texts={texts}
                  onAnswer={(guid, answer) => setState({ ...state, answers: { ...state.answers, [guid]: answer } })} />
              ))}
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={choose}>{s("ToolsPage.ipcc.file")}</Button>
                {state.path && <Typography variant="body2" noWrap title={state.path} sx={{ minWidth: 0 }}>{state.path}</Typography>}
              </Stack>
              {!ipccComplete(form, state) && <Typography variant="body2" color="text.secondary">{s("ToolsPage.ipcc.incomplete")}</Typography>}
            </>
          )}
          {step === "generating" && jobId && <JobPanel jobId={jobId} texts={texts} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{s(step === "generating" ? "DataPage.job.close" : "OptionWizard.24")}</Button>
        {step === "prepare" && <Button variant="contained" onClick={prepare} disabled={flags === null || busy}>{s("ToolsPage.ipcc.prepare")}</Button>}
        {step === "form" && form && state && <Button variant="contained" onClick={generate} disabled={!ipccComplete(form, state) || busy}>{s("ToolsPage.ipcc.generate")}</Button>}
      </DialogActions>
    </Dialog>
  );
}

/** One land use category: its subdivisions found in the data, each with its management type and, for some, its type. */
function CategoryTable({ category, answers, texts, onAnswer }: {
  category: IpccCategory; answers: Record<string, IpccAnswer>; texts: Texts | null; onAnswer: (guid: string, answer: IpccAnswer) => void;
}) {
  const s = (key: string) => serverText(texts, key);
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid={"ipcc-category-" + category.code}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{category.label}</Typography>
      {category.subdivisions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{s("ToolsPage.ipcc.noSubdivisions")}</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{s("ToolsPage.ipcc.subdivision")}</TableCell>
              <TableCell sx={{ width: 220 }}>{s("ToolsPage.ipcc.managementType")}</TableCell>
              {category.extra && <TableCell sx={{ width: 220 }}>{category.extra.label}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {category.subdivisions.map((sub) => {
              const answer = answers[sub.guid] ?? { managementType: "", type: "" };
              return (
                <TableRow key={sub.guid}>
                  <TableCell>{sub.code} {"·"} {sub.name}</TableCell>
                  <TableCell>
                    <Select size="small" fullWidth displayEmpty value={answer.managementType} error={!answer.managementType}
                      inputProps={{ "aria-label": s("ToolsPage.ipcc.managementType") + " " + sub.code }}
                      onChange={(e) => onAnswer(sub.guid, { ...answer, managementType: e.target.value })}>
                      <MenuItem value=""><em>{"–"}</em></MenuItem>
                      {category.managementTypes.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                    </Select>
                  </TableCell>
                  {category.extra && (
                    <TableCell>
                      <Select size="small" fullWidth value={answer.type} inputProps={{ "aria-label": category.extra.label + " " + sub.code }}
                        onChange={(e) => onAnswer(sub.guid, { ...answer, type: e.target.value })}>
                        {category.extra.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                      </Select>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
