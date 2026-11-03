import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
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
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, getReference, markReference, unmarkReference, type ReferenceFiguresView, type ReferenceView } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { accuracyText, parsePlotIds, refusalKey, sortedPeople, weakestQuestions } from "../referenceView";
import { linkProps, pathFor } from "../router";
import { useLoad } from "../useLoad";
import { wholeNumber } from "../checksView";

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;

/** The accuracy figures: per person (lowest first) and per question. */
function Accuracy({ figures }: { figures: ReferenceFiguresView }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const labels = new Map(figures.questions.map((q) => [q.key, q.label]));
  return (
    <Stack spacing={2}>
      <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
        {t("reference.accuracyTitle")}
      </Typography>
      {figures.assessed < figures.plots && (
        <Typography variant="body2" color="text.secondary">
          {t("reference.waitingNote", { assessed: n(figures.assessed), plots: n(figures.plots) })}
        </Typography>
      )}
      {figures.checks === 0 ? (
        <Typography>{t("reference.noChecks")}</Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {t(figures.people.length > 0 ? "reference.accuracyExplain" : "reference.accuracyExplainQuestions", { checks: n(figures.checks) })}
          </Typography>
          {/* Reviewers get no one's accuracy by name (Decision 3): the people's table is the coordinators'. */}
          {figures.people.length > 0 && (
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("reference.col.person")}</TableCell>
                  <TableCell>{t("reference.col.accuracy")}</TableCell>
                  <TableCell>{t("reference.col.weakest")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedPeople(figures).map((person) => {
                  const weakest = weakestQuestions(person);
                  return (
                    <TableRow key={person.username} sx={{ verticalAlign: "top" }}>
                      <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                        {person.username}
                      </TableCell>
                      <TableCell sx={{ minWidth: 180 }}>{accuracyText(t, person.plots, language)}</TableCell>
                      <TableCell sx={{ minWidth: 180, wordBreak: "break-word" }}>
                        {weakest.length === 0
                          ? "–"
                          : weakest.map((q) => (
                              <Box key={q.key}>{t("reference.missed", { label: labels.get(q.key) ?? q.key, missed: n(q.compared - q.agreeing), count: n(q.compared) })}</Box>
                            ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          )}
          <Typography variant="h3" sx={{ fontSize: "1rem", fontWeight: 600 }}>
            {t("reference.questionsTitle")}
          </Typography>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("reference.col.question")}</TableCell>
                  <TableCell>{t("reference.col.questionMatch")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {figures.questions.map((q) => (
                  <TableRow key={q.key}>
                    <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                      {q.label}
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>{accuracyText(t, q, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Stack>
  );
}

type How = "random" | "list";

/** Adding reference plots: a divided file, the reference assessor, and the plots (at random or by id). */
function AddForm({ projectId, view, onDone }: { projectId: string; view: ReferenceView; onDone: (next: ReferenceView, marked: number) => void }) {
  const t = useT();
  const { language } = useApp();
  const idBase = useId();
  const [fileId, setFileId] = useState(view.files[0]?.csvFileId ?? "");
  const [assessor, setAssessor] = useState(view.assessors[0]?.userId ?? "");
  const [how, setHow] = useState<How>("random");
  const [count, setCount] = useState("20");
  const [ids, setIds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const idsRef = useRef<HTMLTextAreaElement>(null);
  // A file or person that is gone (another change) falls back to the first one.
  useEffect(() => {
    if (!view.files.some((f) => f.csvFileId === fileId)) setFileId(view.files[0]?.csvFileId ?? "");
    if (!view.assessors.some((a) => a.userId === assessor)) setAssessor(view.assessors[0]?.userId ?? "");
  }, [view, fileId, assessor]);

  const left = Math.max(0, view.max - view.count);
  const cannotAdd = busy || !fileId || !assessor || left === 0;
  const submit = async () => {
    if (cannotAdd) return;
    setError(null);
    setProblem(null);
    let body: Parameters<typeof markReference>[1];
    if (how === "random") {
      const value = wholeNumber(count, 1, Math.max(1, Math.min(500, left)));
      if (value === null) {
        setProblem(t("reference.invalidCount", { max: formatNumber(Math.max(1, Math.min(500, left)), language) }));
        countRef.current?.focus();
        return;
      }
      body = { csvFileId: fileId, assessorUserId: assessor, random: value };
    } else {
      const plots = parsePlotIds(ids);
      if (plots.length === 0) {
        setProblem(t("reference.noPlotsTyped"));
        idsRef.current?.focus();
        return;
      }
      body = { csvFileId: fileId, assessorUserId: assessor, plots };
    }
    setBusy(true);
    try {
      const { marked, view: next } = await markReference(projectId, body);
      setIds("");
      onDone(next, marked);
    } catch (err) {
      const key = err instanceof ApiError ? refusalKey(err.details.code) : null;
      if (key) {
        const plots = Array.isArray(err instanceof ApiError ? err.details.plots : null) ? ((err as ApiError).details.plots as unknown[]).map(String).join(", ") : "";
        setProblem(t(key, { plots, max: formatNumber(view.max, language) }));
        (how === "random" ? countRef : idsRef).current?.focus();
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  if (view.files.length === 0) return <Alert severity="info">{t("reference.noDivided")}</Alert>;
  return (
    <Stack spacing={2} component="form" onSubmit={(e) => (e.preventDefault(), void submit())} aria-labelledby={`${idBase}-add`}>
      <Typography variant="h3" id={`${idBase}-add`} sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
        {t("reference.addTitle")}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id={`${idBase}-file`}>{t("reference.file")}</InputLabel>
          <Select labelId={`${idBase}-file`} label={t("reference.file")} value={fileId} onChange={(e) => setFileId(e.target.value)}>
            {view.files.map((f) => (
              <MenuItem key={f.csvFileId} value={f.csvFileId}>
                {f.filename}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id={`${idBase}-assessor`}>{t("reference.assessor")}</InputLabel>
          <Select labelId={`${idBase}-assessor`} label={t("reference.assessor")} value={assessor} onChange={(e) => setAssessor(e.target.value)} aria-describedby={`${idBase}-assessor-help`}>
            {view.assessors.map((a) => (
              <MenuItem key={a.userId} value={a.userId}>
                {a.username} ({t(`role.${a.role}`)})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <Typography variant="body2" color="text.secondary" id={`${idBase}-assessor-help`}>
        {t("reference.assessorHelp")}
      </Typography>
      <FormControl>
        <FormLabel id={`${idBase}-how`}>{t("reference.how")}</FormLabel>
        <RadioGroup aria-labelledby={`${idBase}-how`} value={how} onChange={(e) => setHow(e.target.value as How)}>
          <FormControlLabel value="random" control={<Radio />} label={t("reference.howRandom")} />
          <FormControlLabel value="list" control={<Radio />} label={t("reference.howList")} />
        </RadioGroup>
      </FormControl>
      {how === "random" ? (
        <TextField
          size="small"
          label={t("reference.randomCount")}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          inputMode="numeric"
          inputRef={countRef}
          error={problem !== null}
          helperText={problem}
          sx={{ maxWidth: 420 }}
        />
      ) : (
        <TextField
          label={t("reference.plotIds")}
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          multiline
          minRows={3}
          maxRows={10}
          inputRef={idsRef}
          error={problem !== null}
          helperText={problem}
          sx={{ maxWidth: 420 }}
        />
      )}
      {/* What is wrong is said on the field (its helper text, read with it; the field takes the focus). */}
      <ErrorAlert error={error} />
      <Typography variant="body2" color="text.secondary">
        {t("reference.collectors", { count: formatNumber(view.collectors, language) })}
      </Typography>
      <Box>
        <Button type="submit" variant="contained" aria-disabled={cannotAdd}>
          {t("reference.add")}
        </Button>
      </Box>
    </Stack>
  );
}

/** The reference plots, each removable, and each collector's progress through them. */
function PlotList({ projectId, view, onDone }: { projectId: string; view: ReferenceView; onDone: (next: ReferenceView, removed: number) => void }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const headingId = useId();
  const [confirm, setConfirm] = useState<{ plots: { csvFileId: string; plot: string }[] | "all"; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      const { unmarked, view: next } = await unmarkReference(projectId, confirm.plots);
      setConfirm(null);
      onDone(next, unmarked);
      // The row (or the list) pressed is gone: the list's heading takes the focus.
      window.setTimeout(() => document.getElementById(headingId)?.focus(), 0);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (view.plots.length === 0)
    return (
      <Typography id={headingId} tabIndex={-1} sx={{ outline: "none" }}>
        {t("reference.none")}
      </Typography>
    );
  return (
    <Stack spacing={2}>
      <Typography variant="h3" id={headingId} tabIndex={-1} sx={{ fontSize: "1.1rem", fontWeight: 600, outline: "none" }}>
        {t("reference.plotsTitle")}
      </Typography>
      <ErrorAlert error={error} />
      <TableContainer sx={{ ...tableFrame, maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("reference.col.plot")}</TableCell>
              <TableCell>{t("reference.col.file")}</TableCell>
              <TableCell>{t("reference.col.assessor")}</TableCell>
              <TableCell>{t("reference.col.state")}</TableCell>
              <TableCell>{t("reference.col.checked")}</TableCell>
              <TableCell>
                <Box component="span" sx={visuallyHidden}>
                  {t("reference.remove")}
                </Box>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {view.plots.map((p) => (
              <TableRow key={`${p.csvFileId}\n${p.plot}`}>
                <TableCell component="th" scope="row">
                  <Link {...linkProps(pathFor({ name: "plot", projectId, plot: p.plot }))}>{p.plot}</Link>
                </TableCell>
                <TableCell sx={{ wordBreak: "break-word", minWidth: 160 }}>{p.filename}</TableCell>
                <TableCell sx={{ wordBreak: "break-word" }}>{p.assessorInProject ? p.assessor : t("reference.assessorLeft", { name: p.assessor })}</TableCell>
                <TableCell>{p.assessed ? t("reference.assessed") : t("reference.waiting")}</TableCell>
                <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{t("reference.checkedOf", { checked: n(p.checked), copies: n(p.copies) })}</TableCell>
                <TableCell>
                  <Button size="small" onClick={() => setConfirm({ plots: [{ csvFileId: p.csvFileId, plot: p.plot }], count: 1 })} aria-label={`${t("reference.remove")}: ${p.plot}`}>
                    {t("reference.remove")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box>
        <Button size="small" color="warning" onClick={() => setConfirm({ plots: "all", count: view.plots.length })}>
          {t("reference.removeAll")}
        </Button>
      </Box>
      {view.people.length > 0 && (
        <Box component="details">
          <Typography component="summary" variant="body2" sx={{ cursor: "pointer", fontWeight: 500 }}>
            {t("reference.peopleTitle")}
          </Typography>
          <TableContainer sx={{ ...tableFrame, mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("reference.col.person")}</TableCell>
                  <TableCell>{t("reference.col.submitted")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.people.map((p) => (
                  <TableRow key={p.userId}>
                    <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                      {p.username}
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{t("reference.checkedOf", { checked: n(p.checked), copies: n(p.copies) })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
      {confirm && (
        <Dialog open onClose={() => !busy && setConfirm(null)} fullWidth maxWidth="sm" aria-labelledby="reference-remove-title" aria-describedby="reference-remove-text">
          <DialogTitle id="reference-remove-title">{confirm.plots === "all" ? t("reference.removeAll") : t("reference.remove")}</DialogTitle>
          <DialogContent>
            <DialogContentText id="reference-remove-text">{t("reference.removeConfirm", { count: n(confirm.count) })}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void remove()} color="warning" variant="contained" disabled={busy}>
              {t("reference.remove")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

const visuallyHidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/**
 * "Reference plots" on the Quality tab (Task 14). Coordinators (`canEdit`) choose the reference
 * plots and their assessor and see who has done them; coordinators and reviewers see the accuracy
 * against the reference, per person and per question. Never on My work.
 */
export function QualityReference({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useT();
  const { language } = useApp();
  const { data, error, loading, reload, setData } = useLoad(() => getReference(projectId), [projectId]);
  const [message, setMessage] = useState<string | null>(null);
  const busy = error instanceof ApiError && error.code === "busy";
  const stale = data?.figures?.stale === true;
  // Newer figures are being worked out (or the server is busy): ask again in a while.
  useEffect(() => {
    if (loading || !(stale || busy)) return;
    const id = window.setTimeout(reload, busy ? 15_000 : 20_000);
    return () => window.clearTimeout(id);
  }, [loading, stale, busy, reload]);
  const changed = (next: ReferenceView, text: string) => {
    // The change's answer has the set as it is now; the figures follow with the next load.
    setData((prev) => ({ ...next, figures: prev.figures }));
    setMessage(text);
    reload();
  };
  const n = (v: number) => formatNumber(v, language);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="reference-title">
      <Stack spacing={2}>
        <Typography variant="h2" id="reference-title">
          {t("reference.title")}
        </Typography>
        <Typography color="text.secondary">{t(canEdit ? "reference.explain" : "reference.reviewerExplain")}</Typography>
        {canEdit && <Typography variant="body2" color="text.secondary">{t("reference.blind")}</Typography>}
        {!data && loading && <Loading />}
        {busy && (
          <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={reload}>{t("common.retry")}</Button>}>
            {t("quality.busy")}
          </Alert>
        )}
        {error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />}
        {message && (
          <Alert severity="success" role="status" onClose={() => setMessage(null)}>
            {message}
          </Alert>
        )}
        {data && (
          <Box sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
            <Stack spacing={3}>
              {/* With none, the coordinator's list below says so already. */}
              {!(data.count === 0 && canEdit && data.coordinator) && (
                <Typography variant="body2" color="text.secondary">
                  {data.count === 0 ? t("reference.none") : t("reference.count", { count: n(data.count), max: n(data.max) })}
                  {data.figures?.computedAt != null && data.count > 0 && ` ${t(data.figures.stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.figures.computedAt, language) })}`}
                </Typography>
              )}
              {data.figures && data.count > 0 && <Accuracy figures={data.figures} />}
              {canEdit && data.coordinator && (
                <>
                  <PlotList projectId={projectId} view={data} onDone={(next, removed) => changed(next, t("reference.removed", { count: n(removed) }))} />
                  <AddForm projectId={projectId} view={data} onDone={(next, marked) => changed(next, t("reference.added", { count: n(marked) }))} />
                  {data.wholeFiles.length > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t("reference.wholeFiles", { files: data.wholeFiles.map((f) => f.filename).join(", ") })}
                    </Typography>
                  )}
                </>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
