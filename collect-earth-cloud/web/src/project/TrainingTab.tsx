import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Print from "@mui/icons-material/Print";
import { useEffect, useState, type ReactNode } from "react";
import {
  createTrainingSet,
  deleteTrainingSet,
  getTraining,
  getTrainingSet,
  goldenFrom,
  pruneTrainingGolden,
  putTrainingGolden,
  setTrainingMembers,
  startTrainingAttempts,
  updateTrainingSet,
  type TrainingKind,
  type TrainingPerson,
  type TrainingQuestion,
  type TrainingSetView,
} from "../api";
import { useApp } from "../appContext";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, navigate, pathFor } from "../router";
import { useLoad } from "../useLoad";
import { answerLabel, goldenKeys, kappaText, questionLabel, readPassMark, shareText } from "../trainingView";

const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;

function Section({ title, children, explain, pageHeading = false }: { title: string; explain?: string; children: ReactNode; pageHeading?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section">
      <Typography variant="h2" gutterBottom {...(pageHeading ? { "data-page-heading": true } : {})}>
        {title}
      </Typography>
      {explain && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {explain}
        </Typography>
      )}
      {children}
    </Paper>
  );
}

/**
 * Training (coordinators): calibration and learning plot sets, kept apart from the project's data.
 * The list and a form to add a set; a set opens in place.
 */
export function TrainingTab({ projectId, setId }: { projectId: string; setId?: string }) {
  const t = useT();
  const { language } = useApp();
  const state = useLoad(() => getTraining(projectId), [projectId]);
  const n = (v: number) => formatNumber(v, language);
  // A set has its own address, so Back (the browser's or the report's) returns to it.
  const setOpen = (id: string) => navigate(pathFor({ name: "trainingSet", projectId, setId: id }));

  if (setId) {
    return <SetPage projectId={projectId} setId={setId} members={state.data?.members ?? []} onBack={() => navigate(pathFor({ name: "project", projectId, tab: "training" }))} />;
  }
  return (
    <Stack spacing={3}>
      <Section title={t("training.title")} explain={t("training.explain")}>
        <AddSet projectId={projectId} onAdded={setOpen} />
      </Section>
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error || !state.data ? (
        <ErrorAlert error={state.error} onRetry={state.reload} />
      ) : state.data.sets.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState title={t("training.none")} />
        </Paper>
      ) : (
        <Section title={t("training.setsTitle")}>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("training.colName")}</TableCell>
                  <TableCell>{t("training.kind")}</TableCell>
                  <TableCell align="right">{t("training.colPlots")}</TableCell>
                  <TableCell align="right">{t("training.colPeople")}</TableCell>
                  <TableCell align="right">{t("training.colGolden")}</TableCell>
                  <TableCell>{t("training.colProgress")}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {state.data.sets.map((set) => {
                  const finished = set.progress.filter((p) => p.submitted >= set.plotCount).length;
                  return (
                    <TableRow key={set.id} hover>
                      <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                        {set.name}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" color={set.kind === "learning" ? "primary" : "default"} label={t(set.kind === "learning" ? "training.kindLearning" : "training.kindCalibration")} />
                      </TableCell>
                      <TableCell align="right">{n(set.plotCount)}</TableCell>
                      <TableCell align="right">{n(set.participants.length)}</TableCell>
                      <TableCell align="right">{n(set.golden)}</TableCell>
                      <TableCell>{set.participants.length > 0 ? t("training.progressCell", { done: n(finished), people: n(set.participants.length) }) : "–"}</TableCell>
                      <TableCell align="right">
                        <Button size="small" {...linkProps(pathFor({ name: "trainingSet", projectId, setId: set.id }))} aria-label={t("training.openLabel", { name: set.name })}>
                          {t("training.open")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Section>
      )}
    </Stack>
  );
}

/** Adding a set: its kind, name, pass mark and the CSV file. */
function AddSet({ projectId, onAdded }: { projectId: string; onAdded: (setId: string) => void }) {
  const t = useT();
  const { language } = useApp();
  const [kind, setKind] = useState<TrainingKind>("calibration");
  const [name, setName] = useState("");
  const [passMark, setPassMark] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const mark = readPassMark(passMark);

  const add = async (files: File[]) => {
    setError(null);
    setProblem(null);
    const file = files.find((f) => f.name.toLowerCase().endsWith(".csv"));
    if (!file) return setProblem(t("plots.wrongType", { name: files[0]?.name ?? "" }));
    if (mark === undefined) return setProblem(t("training.passMarkBad"));
    setProgress(0);
    try {
      const set = await createTrainingSet(projectId, file, { kind, name: name.trim() || file.name.replace(/\.csv$/i, ""), passMark: kind === "learning" ? mark : null }, setProgress);
      setName("");
      onAdded(set.id);
    } catch (err) {
      setError(err);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h3">{t("training.newTitle")}</Typography>
      <FormControl>
        <FormLabel id="training-kind">{t("training.kind")}</FormLabel>
        <RadioGroup row aria-labelledby="training-kind" value={kind} onChange={(e) => setKind(e.target.value as TrainingKind)}>
          <FormControlLabel value="calibration" control={<Radio />} label={t("training.kindCalibration")} />
          <FormControlLabel value="learning" control={<Radio />} label={t("training.kindLearning")} />
        </RadioGroup>
      </FormControl>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField label={t("training.name")} value={name} onChange={(e) => setName(e.target.value)} helperText={t("training.nameHelp")} slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ flex: 2 }} />
        {kind === "learning" && (
          <TextField
            label={t("training.passMark")}
            value={passMark}
            onChange={(e) => setPassMark(e.target.value)}
            error={mark === undefined}
            helperText={mark === undefined ? t("training.passMarkBad") : t("training.passMarkHelp")}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            sx={{ flex: 1 }}
          />
        )}
      </Stack>
      <FileDrop label={t("training.drop")} buttonLabel={t("training.choose")} accept=".csv,text/csv" disabled={progress !== null} onFiles={add} />
      <Typography variant="body2" color="text.secondary">
        {t("training.fileHelp")}
      </Typography>
      {progress !== null && <LinearProgress variant="determinate" value={progress * 100} aria-label={t("plots.uploading", { name: name || "", pct: Math.round(progress * 100) })} />}
      {problem && <Alert severity="warning">{problem}</Alert>}
      <ClashAlert error={error} language={language} />
    </Stack>
  );
}

/** A refused file: which plots and why, or the usual error. */
function ClashAlert({ error, language }: { error: unknown; language: string }) {
  const t = useT();
  const details = (error as { details?: Record<string, unknown> } | null)?.details;
  const code = typeof details?.code === "string" ? details.code : null;
  if (code && ["in_plot_file", "in_other_set", "has_records", "bad_ids"].includes(code)) {
    const plots = Array.isArray(details!.plots) ? (details!.plots as string[]) : [];
    return (
      <Alert severity="error" role="alert">
        {t(`training.clash.${code}` as "training.clash.in_plot_file", { plots: plots.join(", "), file: String(details!.file ?? ""), count: formatNumber(plots.length, language) })}
      </Alert>
    );
  }
  return <ErrorAlert error={error} />;
}

/** One set: its settings and participants, the calibration figures, the golden answers and the scores. */
function SetPage({ projectId, setId, members, onBack }: { projectId: string; setId: string; members: TrainingPerson[]; onBack: () => void }) {
  const t = useT();
  const state = useLoad(() => getTrainingSet(projectId, setId), [projectId, setId]);
  const data = state.data;
  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button startIcon={<ArrowBack />} onClick={onBack}>
          {t("training.back")}
        </Button>
        <Button variant="outlined" startIcon={<Print />} {...linkProps(pathFor({ name: "trainingReport", projectId, setId }))}>
          {t("training.reportLink")}
        </Button>
      </Stack>
      {state.loading && !data ? (
        <Loading />
      ) : state.error || !data ? (
        <ErrorAlert error={state.error} onRetry={state.reload} />
      ) : (
        <>
          <Settings projectId={projectId} view={data} onChanged={state.reload} onDeleted={onBack} />
          <Participants projectId={projectId} view={data} members={members} onSaved={state.reload} />
          <Calibration projectId={projectId} view={data} onGolden={state.reload} />
          <Golden projectId={projectId} view={data} onChanged={state.reload} />
          {data.set.kind === "learning" && <Scores projectId={projectId} view={data} onStarted={state.reload} />}
        </>
      )}
    </Stack>
  );
}

function Settings({ projectId, view, onChanged, onDeleted }: { projectId: string; view: TrainingSetView; onChanged: () => void; onDeleted: () => void }) {
  const t = useT();
  const { set } = view;
  const [name, setName] = useState(set.name);
  const [passMark, setPassMark] = useState(set.passMark === null ? "" : String(set.passMark));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setName(set.name);
    setPassMark(set.passMark === null ? "" : String(set.passMark));
  }, [set.name, set.passMark]);
  const mark = readPassMark(passMark);
  const changed = name.trim() !== set.name || (mark !== undefined && mark !== set.passMark);

  const run = async (action: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={set.name} pageHeading>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <Chip color={set.kind === "learning" ? "primary" : "default"} label={t(set.kind === "learning" ? "training.kindLearning" : "training.kindCalibration")} />
          <Typography variant="body2" color="text.secondary">
            {t("training.servedAs", { file: set.servedName })}
          </Typography>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField label={t("training.name")} value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ flex: 2 }} />
          {set.kind === "learning" && (
            <TextField
              label={t("training.passMark")}
              value={passMark}
              onChange={(e) => setPassMark(e.target.value)}
              error={mark === undefined}
              helperText={mark === undefined ? t("training.passMarkBad") : t("training.passMarkHelp")}
              slotProps={{ htmlInput: { inputMode: "numeric" } }}
              sx={{ flex: 1 }}
            />
          )}
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            variant="contained"
            disabled={busy || !changed || name.trim() === "" || mark === undefined}
            onClick={() => void run(() => updateTrainingSet(projectId, set.id, { name: name.trim(), ...(set.kind === "learning" ? { passMark: mark ?? null } : {}) }), onChanged)}
          >
            {t("common.save")}
          </Button>
          <Button variant="outlined" disabled={busy} onClick={() => void run(() => updateTrainingSet(projectId, set.id, { kind: set.kind === "learning" ? "calibration" : "learning" }), onChanged)}>
            {t(set.kind === "learning" ? "training.toCalibration" : "training.toLearning")}
          </Button>
          <Button color="error" disabled={busy} onClick={() => setDeleting(true)}>
            {t("training.delete")}
          </Button>
        </Stack>
        {set.kind === "calibration" && (
          <Typography variant="body2" color="text.secondary">
            {t("training.toLearningHelp")}
          </Typography>
        )}
        <ErrorAlert error={error} />
      </Stack>
      <Dialog open={deleting} onClose={() => !busy && setDeleting(false)}>
        <DialogTitle>{t("training.deleteTitle", { name: set.name })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("training.deleteText")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)} disabled={busy} autoFocus>
            {t("common.cancel")}
          </Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void run(() => deleteTrainingSet(projectId, set.id), onDeleted)}>
            {t("training.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

function Participants({ projectId, view, members, onSaved }: { projectId: string; view: TrainingSetView; members: TrainingPerson[]; onSaved: () => void }) {
  const t = useT();
  const saved = view.set.participants.map((p) => p.userId);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(saved));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const changed = chosen.size !== saved.length || saved.some((id) => !chosen.has(id));
  const people = [...members].sort((a, b) => a.username.localeCompare(b.username));
  const toggle = (id: string) => {
    setDone(false);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setTrainingMembers(projectId, view.set.id, [...chosen]);
      setDone(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("training.participants")} explain={t("training.participantsHelp")}>
      <Stack spacing={2}>
        <FormGroup row>
          {people.map((m) => (
            <FormControlLabel
              key={m.userId}
              control={<Checkbox checked={chosen.has(m.userId)} onChange={() => toggle(m.userId)} />}
              label={`${m.username} · ${t(`role.${m.role}`)}`}
              sx={{ minWidth: 220, overflowWrap: "anywhere" }}
            />
          ))}
        </FormGroup>
        {done && !changed && (
          <Alert severity="success" role="status">
            {t("training.participantsSaved")}
          </Alert>
        )}
        <ErrorAlert error={error} />
        <Box>
          <Button variant="contained" disabled={busy || !changed} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}

function Calibration({ projectId, view, onGolden }: { projectId: string; view: TrainingSetView; onGolden: () => void }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const c = view.calibration;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const answered = c.plots.filter((p) => p.people.length > 0);
  const label = (key: string) => questionLabel(c.questions, key);
  const useConsensus = async () => {
    setBusy(true);
    setError(null);
    try {
      const count = await goldenFrom(projectId, view.set.id, { from: "consensus" });
      setMessage(t("training.usedConsensus", { count: n(count) }));
      onGolden();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("training.calibrationTitle")} explain={t("training.calibrationExplain")}>
      {answered.length === 0 ? (
        <Typography color="text.secondary">{t("training.calibrationNone")}</Typography>
      ) : (
        <Stack spacing={3}>
          <Typography>{t("training.overall", { rate: shareText(c.overall, language), agreeing: n(c.overall.agreeing), compared: n(c.overall.compared) })}</Typography>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("training.colQuestion")}</TableCell>
                  <TableCell align="right">{t("training.colPairs")}</TableCell>
                  <TableCell align="right" title={t("training.kappaHelp")}>
                    {t("training.colKappa")}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {c.questions.map((q) => (
                  <TableRow key={q.key}>
                    <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                      {q.label}
                    </TableCell>
                    <TableCell align="right">
                      {shareText(q.pairs, language)} ({n(q.pairs.agreeing)}/{n(q.pairs.compared)})
                    </TableCell>
                    <TableCell align="right">{kappaText(q.kappa, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="body2" color="text.secondary">
            {t("training.kappaHelp")}
          </Typography>
          <Box>
            <Typography variant="h3" gutterBottom>
              {t("training.peopleTitle")}
            </Typography>
            <TableContainer sx={tableFrame}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("training.colPerson")}</TableCell>
                    <TableCell align="right">{t("training.colDone")}</TableCell>
                    <TableCell align="right">{t("training.colWithConsensus")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {c.people.map((p) => (
                    <TableRow key={p.username}>
                      <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                        {p.username}
                      </TableCell>
                      <TableCell align="right">
                        {n(p.plots)}/{n(view.plots.length)}
                      </TableCell>
                      <TableCell align="right">{shareText(p.withConsensus, language)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
          <Box>
            <Typography variant="h3" gutterBottom>
              {t("training.plotsTitle")}
            </Typography>
            <Stack spacing={1}>
              {answered.map((plot) => (
                <Box key={plot.plot} component="details" sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}>
                  <Box component="summary" sx={{ cursor: "pointer" }}>
                    {t("training.plotLine", { plot: plot.plot, count: n(plot.people.length) })}
                    {plot.questions.some((q) => q.pairs.agreeing < q.pairs.compared) && ` · ${t("training.plotDiffers")}`}
                  </Box>
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {plot.questions.map((q) => (
                      <Box key={q.key}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {label(q.key)}
                        </Typography>
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", my: 0.5 }}>
                          {q.answers.map((a) => (
                            <Chip
                              key={a.value}
                              size="small"
                              variant={q.answers.length > 1 ? "outlined" : "filled"}
                              title={a.people.join(", ")}
                              label={`${answerLabel(view.questions, q.key, a.value)} × ${n(a.count)}`}
                            />
                          ))}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {q.consensus !== null ? t("training.agreed", { value: answerLabel(view.questions, q.key, q.consensus) }) : t("training.tie")}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Box>
          {message && (
            <Alert severity="success" role="status" onClose={() => setMessage(null)}>
              {message}
            </Alert>
          )}
          <ErrorAlert error={error} />
          <Box>
            <Button variant="contained" disabled={busy} onClick={() => void useConsensus()}>
              {t("training.useConsensus")}
            </Button>
          </Box>
        </Stack>
      )}
    </Section>
  );
}

function Golden({ projectId, view, onChanged }: { projectId: string; view: TrainingSetView; onChanged: () => void }) {
  const t = useT();
  const { language } = useApp();
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const golden = new Map(view.golden.map((g) => [g.plotKey, g]));
  // The questions the participants answered in this set: a plot's golden answers are asked for those first.
  const answered = new Set(view.calibration.questions.map((q) => q.key));
  const prune = async () => {
    setBusy(true);
    setError(null);
    try {
      await pruneTrainingGolden(projectId, view.set.id);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const person = view.set.participants.find((p) => p.userId === from);
    if (!person) return;
    setBusy(true);
    setError(null);
    try {
      const count = await goldenFrom(projectId, view.set.id, { from: "person", userId: person.userId });
      setMessage(t("training.copied", { count: formatNumber(count, language), name: person.username }));
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("training.goldenTitle")} explain={t("training.goldenExplain")}>
      <Stack spacing={2}>
        {view.set.participants.length > 0 && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="golden-from">{t("training.copyFrom")}</InputLabel>
              <Select labelId="golden-from" label={t("training.copyFrom")} value={from} onChange={(e) => setFrom(e.target.value)}>
                {view.set.participants.map((p) => (
                  <MenuItem key={p.userId} value={p.userId}>
                    {p.username}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" disabled={busy || from === ""} onClick={() => void copy()}>
              {t("training.copy")}
            </Button>
          </Stack>
        )}
        {message && (
          <Alert severity="success" role="status" onClose={() => setMessage(null)}>
            {message}
          </Alert>
        )}
        <ErrorAlert error={error} />
        {view.questions.length === 0 && golden.size === 0 && <Alert severity="info">{t("training.noQuestions")}</Alert>}
        {(view.staleQuestions ?? []).length > 0 && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" disabled={busy} onClick={() => void prune()}>
                {t("training.staleRemove")}
              </Button>
            }
          >
            {t("training.staleQuestions", { keys: (view.staleQuestions ?? []).join(", ") })}
          </Alert>
        )}
        <Stack spacing={1}>
          {view.plots.map((plot) => (
            <GoldenPlot
              key={`${plot} ${golden.get(plot)?.updatedAt ?? 0}`}
              projectId={projectId}
              setId={view.set.id}
              plot={plot}
              questions={view.questions}
              answered={answered}
              saved={golden.get(plot)}
              onSaved={onChanged}
            />
          ))}
        </Stack>
      </Stack>
    </Section>
  );
}

function GoldenPlot({
  projectId,
  setId,
  plot,
  questions,
  answered,
  saved,
  onSaved,
}: {
  projectId: string;
  setId: string;
  plot: string;
  questions: TrainingQuestion[];
  answered: ReadonlySet<string>;
  saved: { answers: Record<string, string>; note: string | null } | undefined;
  onSaved: () => void;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...(saved?.answers ?? {}) }));
  const [note, setNote] = useState(saved?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [all, setAll] = useState(false);
  const allKeys = goldenKeys(questions, answers);
  // The questions answered in the set and those already given, unless all are asked for (or none was answered yet).
  const focused = allKeys.filter((k) => answered.has(k) || (answers[k] ?? "").trim() !== "");
  const keys = all || focused.length === 0 ? allKeys : focused;
  const given = Object.values(answers).filter((v) => v.trim() !== "").length;
  const noted = (saved?.note ?? "").trim() !== "";
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await putTrainingGolden(projectId, setId, plot, answers, note.trim() || null);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box component="details" sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}>
      <Box component="summary" sx={{ cursor: "pointer" }}>
        {t("training.goldenPlot", { plot })} · {given > 0 ? t("training.goldenGiven", { count: given }) : noted ? t("training.noteOnly") : t("training.goldenMissing")}
        {given > 0 && noted && ` · ${t("training.withNote")}`}
      </Box>
      <Stack spacing={1.5} sx={{ mt: 1.5 }}>
        {keys.map((key) => {
          const q = questions.find((x) => x.key === key);
          const value = answers[key] ?? "";
          const set = (v: string) => setAnswers((prev) => ({ ...prev, [key]: v }));
          return q?.kind === "choice" && q.options && q.options.length > 0 && !q.multiple ? (
            <FormControl key={key} size="small" sx={{ maxWidth: 420 }}>
              <InputLabel id={`g-${plot}-${key}`}>{q.label || key}</InputLabel>
              <Select labelId={`g-${plot}-${key}`} label={q.label || key} value={value} onChange={(e) => set(e.target.value)}>
                <MenuItem value="">{t("training.noAnswer")}</MenuItem>
                {q.options.map((o) => (
                  <MenuItem key={o.code} value={o.code}>
                    {o.label ? `${o.label} (${o.code})` : o.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField key={key} size="small" label={q?.label || key} value={value} onChange={(e) => set(e.target.value)} sx={{ maxWidth: 420 }} />
          );
        })}
        {focused.length > 0 && focused.length < allKeys.length && (
          <Box>
            <Button size="small" onClick={() => setAll(!all)}>
              {all ? t("training.answeredQuestions") : t("training.allQuestions", { count: allKeys.length })}
            </Button>
          </Box>
        )}
        <TextField label={t("training.note")} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <ErrorAlert error={error} />
        <Box>
          <Button variant="contained" size="small" disabled={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

function Scores({ projectId, view, onStarted }: { projectId: string; view: TrainingSetView; onStarted: () => void }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const start = async (who: { userIds: string[] } | { all: true }) => {
    setBusy(true);
    setError(null);
    try {
      const count = await startTrainingAttempts(projectId, view.set.id, who);
      setMessage(count === 1 ? t("training.attemptsStartedOne") : t("training.attemptsStarted", { count: n(count) }));
      onStarted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const passedText = (passed: boolean | null) => (view.set.passMark === null ? "–" : passed === null ? t("training.notFinished") : passed ? t("training.passed") : t("training.notPassed"));
  return (
    <Section title={t("training.scoresTitle")} explain={t("training.attemptExplain")}>
      <Stack spacing={2}>
        {view.scores.length === 0 ? (
          <Typography color="text.secondary">{t("training.noParticipants")}</Typography>
        ) : (
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("training.colPerson")}</TableCell>
                  <TableCell align="right">{t("training.colAttempt")}</TableCell>
                  <TableCell align="right">{t("training.colScored")}</TableCell>
                  <TableCell align="right">{t("training.colAccuracy")}</TableCell>
                  <TableCell align="right">{t("training.colPlotsRight")}</TableCell>
                  <TableCell>{t("training.colPassed")}</TableCell>
                  <TableCell>{t("training.colEarlier")}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {view.scores.map((s) => (
                  <TableRow key={s.userId}>
                    <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                      {s.username}
                    </TableCell>
                    <TableCell align="right">{n(s.attempt.number)}</TableCell>
                    <TableCell align="right">
                      {n(s.score.submitted)}/{n(s.score.plots)}
                    </TableCell>
                    <TableCell align="right">{shareText(s.score.answers, language)}</TableCell>
                    <TableCell align="right">{n(s.score.plotsRight)}</TableCell>
                    <TableCell>{passedText(s.score.passed)}</TableCell>
                    <TableCell>{s.history.length === 0 ? "–" : s.history.map((h) => t("training.historyItem", { n: n(h.number), rate: shareText(h.answers, language) })).join(" · ")}</TableCell>
                    <TableCell align="right">
                      <Button size="small" disabled={busy} onClick={() => void start({ userIds: [s.userId] })} aria-label={t("training.newAttemptLabel", { name: s.username })} sx={{ whiteSpace: "nowrap" }}>
                        {t("training.newAttempt")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {view.set.passMark !== null && (
          <Typography variant="body2" color="text.secondary">
            {t("training.passMarkIs", { mark: n(view.set.passMark) })}
          </Typography>
        )}
        {message && (
          <Alert severity="success" role="status" onClose={() => setMessage(null)}>
            {message}
          </Alert>
        )}
        <ErrorAlert error={error} />
        {view.scores.length > 0 && (
          <Box>
            <Button variant="outlined" disabled={busy} onClick={() => void start({ all: true })}>
              {t("training.newAttemptAll")}
            </Button>
          </Box>
        )}
      </Stack>
    </Section>
  );
}
