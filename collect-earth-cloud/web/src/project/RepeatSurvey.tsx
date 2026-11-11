import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type FormEvent } from "react";
import {
  base64Of,
  getPeriods,
  getPlotPeriods,
  previewRepeat,
  repeatSurvey,
  setPeriodHeader,
  type AnswerOptions,
  type Periods,
  type RepeatPreview,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FileDrop } from "../components/FileDrop";
import { useT } from "../i18n";
import { formatDate } from "../format";
import { answerText } from "../qualityView";
import { navigate, pathFor } from "../router";
import { periodRows, repeatName } from "../repeatSurveyView";
import { useLoad } from "../useLoad";

/** The questions a header can show, ticked by key. */
function QuestionPicker({
  questions,
  chosen,
  onChange,
  disabled,
}: {
  questions: { key: string; label: string }[];
  chosen: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (key: string, on: boolean) => onChange(on ? questions.map((q) => q.key).filter((k) => k === key || chosen.includes(k)) : chosen.filter((k) => k !== key));
  return (
    <FormGroup sx={{ maxHeight: 260, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 0.5, flexWrap: "nowrap" }}>
      {questions.map((q) => (
        <FormControlLabel
          key={q.key}
          disabled={disabled}
          control={<Checkbox size="small" checked={chosen.includes(q.key)} onChange={(e) => toggle(q.key, e.target.checked)} />}
          label={q.label}
          sx={{ wordBreak: "break-word" }}
        />
      ))}
    </FormGroup>
  );
}

/**
 * "Repeat this survey" (docs/plans/2026-11-11-repeat-survey.md): a new project, as a draft, that collects this one's
 * plots again with this one's answers as an earlier period; the labels, the questions the collectors' form shows of the
 * earlier period, the people, and a newer project file when the survey changed.
 */
function RepeatDialog({ projectId, name, onClose }: { projectId: string; name: string; onClose: () => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [preview, setPreview] = useState<RepeatPreview | null>(null);
  const [projectFile, setProjectFile] = useState<{ name: string; base64: string } | null>(null);
  const [earlierLabel, setEarlierLabel] = useState("");
  const [label, setLabel] = useState("");
  const [newName, setNewName] = useState("");
  const [named, setNamed] = useState(false);
  const [header, setHeader] = useState<string[]>([]);
  const [members, setMembers] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = async (file: { name: string; base64: string } | null) => {
    setBusy(true);
    setError(null);
    try {
      const shown = await previewRepeat(projectId, file?.base64 ?? null);
      if (preview === null) {
        setEarlierLabel(shown.earlierLabel);
        setLabel(shown.label);
        setNewName(repeatName(name, shown.earlierLabel, shown.label));
      }
      setHeader(shown.headerQuestions);
      setPreview(shown);
      setProjectFile(file);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(null);
    // the first preview only: a newer project file asks again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const labelsTaken = preview ? new Set(preview.periods.map((p) => p.label)) : new Set<string>();
  const sameLabel = label.trim() !== "" && (label.trim() === earlierLabel.trim() || labelsTaken.has(label.trim()) || labelsTaken.has(earlierLabel.trim()));
  const missing = !newName.trim() || !label.trim() || !earlierLabel.trim();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (missing || sameLabel) return;
    setBusy(true);
    setError(null);
    try {
      const made = await repeatSurvey(projectId, {
        name: newName.trim(),
        label: label.trim(),
        earlierLabel: earlierLabel.trim(),
        members,
        headerQuestions: header,
        projectFile: projectFile?.base64 ?? null,
      });
      await refreshMe();
      navigate(pathFor({ name: "project", projectId: made.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const relabel = (earlier: string, now: string) => {
    if (!named) setNewName(repeatName(name, earlier, now));
  };
  const questionLabel = (key: string) => preview?.questions.find((q) => q.key === key)?.label ?? key;

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <form onSubmit={create} noValidate>
        <DialogTitle>{t("repeat.title")}</DialogTitle>
        <DialogContent>
          {preview === null ? (
            busy ? <LinearProgress aria-label={t("repeat.reading")} /> : null
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>{t("repeat.dialogIntro", { plots: String(preview.plots) })}</Typography>
              {preview.plots === 0 && <Alert severity="warning">{t("repeat.noPlots")}</Alert>}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label={t("repeat.earlierLabel")}
                  value={earlierLabel}
                  onChange={(e) => {
                    setEarlierLabel(e.target.value);
                    relabel(e.target.value, label);
                  }}
                  required
                  error={!earlierLabel.trim()}
                  helperText={t("repeat.earlierHelp")}
                  slotProps={{ htmlInput: { maxLength: 40 } }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label={t("repeat.label")}
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    relabel(earlierLabel, e.target.value);
                  }}
                  required
                  error={!label.trim() || sameLabel}
                  helperText={sameLabel ? t("repeat.sameLabel") : t("repeat.labelHelp")}
                  slotProps={{ htmlInput: { maxLength: 40 } }}
                  sx={{ flex: 1 }}
                />
              </Stack>
              {preview.periods.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t("repeat.periodsBefore", { periods: preview.periods.map((p) => p.label).join(", ") })}
                </Typography>
              )}
              <TextField
                label={t("copy.nameLabel")}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNamed(true);
                }}
                required
                error={!newName.trim()}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              <Typography variant="h3" component="h3">
                {t("repeat.headerTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("repeat.headerHelp", { label: earlierLabel || "…" })}
              </Typography>
              <QuestionPicker questions={preview.questions} chosen={header} onChange={setHeader} disabled={busy} />
              <FormControlLabel control={<Checkbox checked={members} onChange={(e) => setMembers(e.target.checked)} />} label={t("copy.members")} />
              <Typography variant="h3" component="h3">
                {t("repeat.newerTitle")}
              </Typography>
              {projectFile ? (
                <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography sx={{ flex: 1, wordBreak: "break-word" }}>{t("repeat.newerChosen", { name: projectFile.name })}</Typography>
                  <Button disabled={busy} onClick={() => void load(null)}>
                    {t("repeat.newerRemove")}
                  </Button>
                </Stack>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {t("repeat.newerHelp")}
                  </Typography>
                  <FileDrop
                    label={t("repeat.newerDrop")}
                    buttonLabel={t("repeat.newerChoose")}
                    accept=".cep,.zip,application/zip"
                    disabled={busy}
                    onFiles={([file]) => void (async () => load({ name: file.name, base64: base64Of(new Uint8Array(await file.arrayBuffer())) }))()}
                  />
                </>
              )}
              {preview.report.questionsLeftOut.length > 0 && (
                <Alert severity="warning">
                  {t("repeat.leftOut")}
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {preview.report.questionsLeftOut.slice(0, 10).map((q) => (
                      <li key={q.key}>{t("repeat.leftOutItem", { question: q.key, plots: String(q.plots) })}</li>
                    ))}
                  </Box>
                </Alert>
              )}
              {preview.report.unknownAnswers.length > 0 && (
                <Alert severity="info" role="note">
                  {t("repeat.unknownAnswers")}
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {preview.report.unknownAnswers.slice(0, 10).map((u) => (
                      <li key={`${u.key}\u0000${u.code}`}>{t("repeat.unknownItem", { question: questionLabel(u.key), code: u.code, plots: String(u.plots) })}</li>
                    ))}
                  </Box>
                </Alert>
              )}
              <Alert severity="info" role="note">
                {t("repeat.next")}
              </Alert>
              {busy && <LinearProgress aria-label={t("repeat.creating")} />}
            </Stack>
          )}
          <Stack sx={{ mt: error ? 2 : 0 }}>
            <ErrorAlert error={error} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || preview === null || missing || sameLabel}>
            {t("repeat.submit")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** A repeat survey's periods and the questions its form's header shows, which the coordinator can change. */
function PeriodsOfThisProject({ projectId, periods, onSaved }: { projectId: string; periods: Periods; onSaved: () => void }) {
  const t = useT();
  const { language } = useApp();
  const settings = periods.settings!;
  const [header, setHeader] = useState(settings.headerQuestions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const changed = header.join("\u0000") !== settings.headerQuestions.join("\u0000");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setHeader((await setPeriodHeader(projectId, header)).headerQuestions);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Typography>{t("repeat.thisProject", { label: settings.label })}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {settings.earlier.map((p) => (
          <li key={p.label}>
            {t("repeat.periodLine", { label: p.label, plots: String(p.plots), source: p.sourceName || "—", date: formatDate(p.madeAt, language) })}
          </li>
        ))}
      </Box>
      <Typography variant="h3" component="h3">
        {t("repeat.headerTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("repeat.headerHelp", { label: settings.earlier[settings.earlier.length - 1]?.label ?? "…" })}
      </Typography>
      <QuestionPicker
        questions={periods.candidates ?? periods.questions}
        chosen={header}
        onChange={(next) => {
          setHeader(next);
          setSaved(false);
        }}
        disabled={busy}
      />
      <ErrorAlert error={error} />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Button variant="outlined" disabled={busy || !changed || header.length === 0} onClick={() => void save()}>
          {t("repeat.headerSave")}
        </Button>
        {saved && !changed && (
          <Typography variant="body2" color="success.main" role="status">
            {t("repeat.headerSaved")}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

/** Settings: "Repeat this survey", and for a repeat survey its earlier periods. */
export function RepeatCard({ projectId, name }: { projectId: string; name: string }) {
  const t = useT();
  const periods = useLoad(() => getPeriods(projectId), [projectId]);
  const [open, setOpen] = useState(false);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="settings-repeat">
      <Stack spacing={2}>
        <Typography variant="h2" id="settings-repeat">
          {t("repeat.cardTitle")}
        </Typography>
        <Explain color="text.primary" text={t("repeat.intro.short")} more={t("repeat.intro")} />
        {periods.data?.settings && <PeriodsOfThisProject projectId={projectId} periods={periods.data} onSaved={periods.reload} />}
        <ErrorAlert error={periods.error} onRetry={periods.reload} />
        <Box>
          <Button variant="contained" onClick={() => setOpen(true)}>
            {t("repeat.open")}
          </Button>
        </Box>
      </Stack>
      {open && <RepeatDialog projectId={projectId} name={name} onClose={() => setOpen(false)} />}
    </Paper>
  );
}

/**
 * A plot's answers in the earlier periods of a repeat survey, on its page: the plot's main characteristics (the
 * form's header) first. Nothing when the project repeats no survey or the plot had no answer then.
 */
export function EarlierPeriods({ projectId, plot, labels, options }: { projectId: string; plot: string; labels: Record<string, string>; options: AnswerOptions }) {
  const t = useT();
  const { language } = useApp();
  const loaded = useLoad(async () => {
    const periods = await getPeriods(projectId);
    if (!periods.settings) return null;
    return { periods, plotPeriods: await getPlotPeriods(projectId, plot) };
  }, [projectId, plot]);
  if (!loaded.data) return null;
  const { periods, plotPeriods } = loaded.data;
  const answers = plotPeriods.periods;
  const titleLabels = new Map(periods.questions.map((q) => [q.key, q.label]));
  // The survey's labels and answers' names, the plot page's when the server gave none
  const label = (key: string) => titleLabels.get(key) ?? plotPeriods.labels[key] ?? labels[key] ?? key;
  const answerOptions: AnswerOptions = { ...options, ...plotPeriods.options };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="plot-earlier">
      <Stack spacing={1.5}>
        <Typography variant="h3" component="h3" id="plot-earlier">
          {t("repeat.plotTitle", { labels: periods.settings!.earlier.map((p) => p.label).join(", ") })}
        </Typography>
        {answers.length === 0 ? (
          <Typography color="text.secondary">{t("repeat.plotNone")}</Typography>
        ) : (
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
            <Table size="small" sx={{ "& th, & td": { overflowWrap: "anywhere", px: { xs: 1, sm: 2 }, verticalAlign: "top" } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 120 }}>{t("quality.question")}</TableCell>
                  {answers.map((p) => (
                    <TableCell key={p.label} sx={{ minWidth: 100 }}>
                      {p.label}
                      <Box component="span" sx={{ display: "block", color: "text.secondary", fontWeight: 400 }}>
                        {[p.operator, formatDate(p.savedAt, language)].filter(Boolean).join(" · ")}
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {periodRows(answers, periods.settings!.headerQuestions).map((row) => (
                  <TableRow key={row.key} sx={row.header ? { bgcolor: "action.hover" } : undefined}>
                    <TableCell component="th" scope="row" sx={row.header ? { fontWeight: 600 } : undefined}>
                      {label(row.key)}
                    </TableCell>
                    {row.values.map((value, i) => (
                      <TableCell key={i}>{value === null ? "—" : answerText(t, row.key, value, answerOptions)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {answers.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("repeat.plotHeaderNote")}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
