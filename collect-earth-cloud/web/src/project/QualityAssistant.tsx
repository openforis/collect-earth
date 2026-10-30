import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  getAiRun,
  getProjectAi,
  listAiRuns,
  startAiRun,
  type AiAnswer,
  type AiFinding,
  type AiRun,
  type AiRunKind,
  type AiRunSummary,
  type AiStart,
  type FollowUpAction,
  type QualityData,
} from "../api";
import {
  causeMessageKey,
  failureMessageKey,
  findingFigures,
  followedKind,
  followUpsOf,
  LOST_CONTACT_AFTER,
  MAX_QUESTION_CHARS,
  plotLinks,
  progressMessageKey,
  questionCounter,
  RUN_POLL_MS,
  runPollFailure,
  runRetryDelay,
  runToFollow,
  shouldPollRun,
  startErrorText,
  withRunState,
} from "../aiView";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate } from "../format";
import { useT, type MessageKey } from "../i18n";
import { labelMap, labelsOf, rateText, withQuestionLabels } from "../qualityView";
import { linkProps, pathFor } from "../router";
import { useLoad } from "../useLoad";
import type { NoteDraft } from "./QualityNotes";

// Everything the AI model wrote is shown as plain text: React escapes it, nothing is
// read as HTML or Markdown, and no link is made from it. Plot links come from the
// result's plot lists, and only for plots in the differences list.

const ACTION_LABEL: Record<FollowUpAction, MessageKey> = {
  explain: "ai.explainMore",
  draft_note: "ai.draftNote",
  recheck: "ai.whichPlots",
};

const STATUS_LABEL: Record<AiRunSummary["status"], MessageKey> = {
  running: "ai.status.running",
  done: "ai.status.done",
  failed: "ai.status.failed",
  refused: "ai.status.refused",
};

/**
 * The questions' labels by key: a question key in the model's text is shown as its label
 * (a review written before the server replaced them may still hold one).
 */
const QuestionLabels = createContext<ReadonlyMap<string, string>>(new Map());

/** The model's text with question keys shown as labels (still plain text). */
function useModelText(): (text: string) => string {
  const labels = useContext(QuestionLabels);
  return (text) => withQuestionLabels(text, labels);
}

/** Model text as plain text: its line breaks kept, nothing else read into it. */
function ModelText({ text, variant = "body1" }: { text: string; variant?: "body1" | "body2" }) {
  const shown = useModelText();
  return (
    <Typography variant={variant} sx={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>
      {shown(text)}
    </Typography>
  );
}

/** Whether the page is hidden (another tab, minimised): nothing is asked for then. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => {
    const changed = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return hidden;
}

/** A list of plots: links to the differences list for plots in it, plain ids for the others. */
function Plots({ plots, existing, onShowPlot }: { plots: string[]; existing: ReadonlySet<string>; onShowPlot: (plot: string) => void }) {
  const t = useT();
  if (plots.length === 0) return null;
  const links = plotLinks(plots, existing);
  return (
    <Typography variant="body2" component="div" sx={{ wordBreak: "break-word" }}>
      {t("ai.plots")}{" "}
      {links.map(({ plot, linked }, i) => (
        <Box component="span" key={plot}>
          {i > 0 && "; "}
          {linked ? (
            <Link component="button" type="button" variant="body2" onClick={() => onShowPlot(plot)} aria-label={t("ai.showPlot", { plot })} sx={{ verticalAlign: "baseline" }}>
              {plot}
            </Link>
          ) : (
            plot
          )}
        </Box>
      ))}
    </Typography>
  );
}

/** The progress of a running run, and the reminder to keep the page open. */
function Progress({ run, hidden }: { run: AiRun | undefined; hidden: boolean }) {
  const t = useT();
  return (
    <Alert severity="info" role="status" icon={<CircularProgress size={20} />}>
      <Typography sx={{ fontWeight: 500 }}>{t("ai.working", { step: t(progressMessageKey(run?.tools ?? [])) })}</Typography>
      <Typography variant="body2">{hidden ? t("ai.paused") : t("ai.keepOpen")}</Typography>
    </Alert>
  );
}

/** Why a run did not finish: its code in words (a refusal is the off-topic sentence). */
function NotFinished({ run }: { run: AiRunSummary }) {
  const t = useT();
  return (
    <Alert severity={run.status === "refused" ? "info" : "warning"}>
      {t(failureMessageKey(run.status === "refused" ? "off_topic" : run.errorCode))}
    </Alert>
  );
}

/** The answer of a follow-up or a question. */
function Answer({
  answer,
  existing,
  onShowPlot,
  onUseNote,
}: {
  answer: AiAnswer;
  existing: ReadonlySet<string>;
  onShowPlot: (plot: string) => void;
  onUseNote: (text: string) => void;
}) {
  const t = useT();
  return (
    <Stack spacing={1}>
      <ModelText text={answer.text} />
      <Plots plots={answer.plots} existing={existing} onShowPlot={onShowPlot} />
      {answer.note && (
        <Box sx={{ borderLeft: 3, borderColor: "divider", pl: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t("ai.draftLabel")}
          </Typography>
          <ModelText text={answer.note} />
          <Button size="small" onClick={() => onUseNote(answer.note!)} sx={{ mt: 0.5 }}>
            {t("ai.useAsNote")}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/** A follow-up or a question with what came of it. */
function Child({
  summary,
  run,
  hidden,
  heading,
  existing,
  onShowPlot,
  onUseNote,
}: {
  summary: AiRunSummary;
  run: AiRun | undefined;
  hidden: boolean;
  heading: string;
  existing: ReadonlySet<string>;
  onShowPlot: (plot: string) => void;
  onUseNote: (text: string) => void;
}) {
  const status = run?.status ?? summary.status;
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
          {heading}
        </Typography>
        {status === "running" ? (
          <Progress run={run} hidden={hidden} />
        ) : status === "done" ? (
          run?.answer ? <Answer answer={run.answer} existing={existing} onShowPlot={onShowPlot} onUseNote={onUseNote} /> : <Loading />
        ) : (
          <NotFinishedOf summary={summary} run={run} />
        )}
      </Stack>
    </Box>
  );
}

function NotFinishedOf({ summary, run }: { summary: AiRunSummary; run: AiRun | undefined }) {
  return <NotFinished run={run ?? summary} />;
}

function Finding({
  finding,
  index,
  data,
  followUps,
  details,
  hidden,
  canRun,
  existing,
  onFollowUp,
  onDraftNote,
  onShowPlot,
  onUseNote,
}: {
  finding: AiFinding;
  index: number;
  data: QualityData;
  followUps: AiRunSummary[];
  details: ReadonlyMap<string, AiRun>;
  hidden: boolean;
  canRun: boolean;
  existing: ReadonlySet<string>;
  onFollowUp: (index: number, action: FollowUpAction) => void;
  onDraftNote: (index: number, finding: AiFinding) => void;
  onShowPlot: (plot: string) => void;
  onUseNote: (text: string, finding: AiFinding) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const shown = useModelText();
  const figures = findingFigures(finding.questions, data.questions);
  return (
    <Paper variant="outlined" component="article" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <div>
          <Typography variant="h3" sx={{ wordBreak: "break-word" }}>
            {shown(finding.title)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(causeMessageKey(finding.cause))}
          </Typography>
        </div>
        <ModelText text={finding.explanation} />
        {figures.length > 0 && (
          // The server's own figures for these questions, never the model's numbers.
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t("ai.figures")}
            </Typography>
            {figures.map((f) => (
              <Typography key={f.key} variant="body2" sx={{ wordBreak: "break-word", fontVariantNumeric: "tabular-nums" }}>
                {f.rate ? t("ai.figure", { label: f.label, figure: rateText(t, f.rate, language) }) : t("ai.noFigure", { label: f.label })}
              </Typography>
            ))}
          </Box>
        )}
        {finding.persons.length > 0 && (
          <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
            {t("ai.people", { names: finding.persons.join(", ") })}
          </Typography>
        )}
        <Plots plots={finding.plots} existing={existing} onShowPlot={onShowPlot} />
        {canRun && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button size="small" variant="outlined" onClick={() => onFollowUp(index, "explain")}>
              {t("ai.explainMore")}
            </Button>
            <Button size="small" variant="outlined" onClick={() => onDraftNote(index, finding)}>
              {t("ai.draftNote")}
            </Button>
            <Button size="small" variant="outlined" onClick={() => onFollowUp(index, "recheck")}>
              {t("ai.whichPlots")}
            </Button>
          </Stack>
        )}
        {followUps.map((f) => (
          <Child
            key={f.id}
            summary={f}
            run={details.get(f.id)}
            hidden={hidden}
            heading={t(f.action ? ACTION_LABEL[f.action] : "ai.explainMore")}
            existing={existing}
            onShowPlot={onShowPlot}
            onUseNote={(text) => onUseNote(text, finding)}
          />
        ))}
      </Stack>
    </Paper>
  );
}

function QuestionBox({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => Promise<boolean> }) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const counter = questionCounter(question);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (counter.empty || counter.over || disabled) return;
    if (await onAsk(question.trim())) setQuestion("");
  };
  return (
    <Stack component="form" spacing={1} onSubmit={submit} noValidate>
      <Typography variant="h3">{t("ai.askTitle")}</Typography>
      <TextField
        label={t("ai.askLabel")}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        multiline
        minRows={2}
        error={counter.over}
        helperText={
          <Box component="span" sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
            <span>{counter.over ? t("ai.askTooLong", { max: MAX_QUESTION_CHARS, count: counter.count }) : t("ai.askHelp")}</span>
            <span aria-hidden>{t("ai.askCounter", { count: counter.count, max: MAX_QUESTION_CHARS })}</span>
          </Box>
        }
      />
      <Box>
        <Button type="submit" variant="contained" disabled={disabled || counter.empty || counter.over}>
          {t("ai.ask")}
        </Button>
      </Box>
    </Stack>
  );
}

/** A review: summary, findings with their follow-ups, plots to check again, survey changes, and its questions. */
function Report({
  summary,
  run,
  runs,
  details,
  data,
  hidden,
  canRun,
  busy,
  onStart,
  onWriteNote,
  onShowPlot,
}: {
  summary: AiRunSummary;
  run: AiRun | undefined;
  runs: AiRunSummary[];
  details: ReadonlyMap<string, AiRun>;
  data: QualityData;
  hidden: boolean;
  canRun: boolean;
  busy: boolean;
  onStart: (start: AiStart, draftFor?: AiFinding) => Promise<boolean>;
  onWriteNote: (draft: NoteDraft) => void;
  onShowPlot: (plot: string) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const shown = useModelText();
  const existing = useMemo(() => new Set(data.differences.map((d) => d.plot)), [data.differences]);
  const label = labelMap(data.questions);
  const { byFinding, questions } = useMemo(() => followUpsOf(runs, summary.id), [runs, summary.id]);
  // A draft becomes a note with question labels, not keys: collectors read it.
  const noteFor = (text: string, finding?: AiFinding) =>
    onWriteNote({ questionKey: finding?.questions.find((k) => data.questions.some((q) => q.key === k)) ?? "", firstValue: null, checkValue: null, text: shown(text) });

  const heading = (
    <div>
      <Typography variant="h3">{t("ai.reportOf", { date: formatDate(summary.startedAt, language) })}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t("ai.reportBy", { name: summary.startedBy ?? t("ai.deletedAccount") })}
      </Typography>
    </div>
  );
  if (summary.status === "running") return null;
  if (summary.status !== "done") {
    return (
      <Stack spacing={1}>
        {heading}
        <NotFinishedOf summary={summary} run={run} />
      </Stack>
    );
  }
  if (!run?.report) return <Loading />;
  const report = run.report;
  return (
    <Stack spacing={2}>
      {heading}
      <Alert severity="info" icon={<AutoAwesome />}>
        {t("ai.caution")}
      </Alert>
      <ModelText text={report.summary} />
      <Typography variant="h3" component="h3">
        {t("ai.findings")}
      </Typography>
      {report.findings.length === 0 && <Typography>{t("ai.noFindings")}</Typography>}
      {report.findings.map((finding, index) => (
        <Finding
          key={index}
          finding={finding}
          index={index}
          data={data}
          followUps={byFinding.get(index) ?? []}
          details={details}
          hidden={hidden}
          canRun={canRun && !busy}
          existing={existing}
          onFollowUp={(i, action) => void onStart({ kind: "follow_up", parentRunId: summary.id, findingIndex: i, action })}
          onDraftNote={(i, f) =>
            f.suggestedNote ? noteFor(f.suggestedNote, f) : void onStart({ kind: "follow_up", parentRunId: summary.id, findingIndex: i, action: "draft_note" }, f)
          }
          onShowPlot={onShowPlot}
          onUseNote={noteFor}
        />
      ))}
      {report.recheckPlots.length > 0 && (
        <Box>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            {t("ai.recheckPlots")}
          </Typography>
          <Plots plots={report.recheckPlots} existing={existing} onShowPlot={onShowPlot} />
        </Box>
      )}
      {report.surveyChanges.length > 0 && (
        <Box>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            {t("ai.surveyChanges")}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {report.surveyChanges.map((c, i) => (
              <Box component="li" key={i} sx={{ whiteSpace: "pre-line", wordBreak: "break-word", mb: 0.5 }}>
                {t("ai.surveyChange", { label: label(c.question), suggestion: shown(c.suggestion) })}
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {questions.map((q) => (
        <Child
          key={q.id}
          summary={q}
          run={details.get(q.id)}
          hidden={hidden}
          heading={t("ai.youAsked", { question: details.get(q.id)?.question ?? "…" })}
          existing={existing}
          onShowPlot={onShowPlot}
          onUseNote={(text) => noteFor(text)}
        />
      ))}
      {canRun && <QuestionBox disabled={busy} onAsk={(question) => onStart({ kind: "question", parentRunId: summary.id, question })} />}
    </Stack>
  );
}

/**
 * Section 9 of the Quality tab: the AI assistant. A review runs on the server in the
 * background; its progress is asked for every 2 s while the page is visible (with
 * request-based billing that asking is also what gives the server CPU for it, so the
 * panel asks the coordinator to keep the page open).
 */
export function QualityAssistant({
  projectId,
  data,
  onWriteNote,
  onShowPlot,
}: {
  projectId: string;
  data: QualityData;
  onWriteNote: (draft: NoteDraft) => void;
  onShowPlot: (plot: string) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const ai = useLoad(() => getProjectAi(projectId), [projectId]);
  const runs = useLoad(() => listAiRuns(projectId), [projectId]);
  const hidden = usePageHidden();
  const [details, setDetails] = useState<Map<string, AiRun>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  /** The run followed, with its kind when it was started here (so its progress shows at once). */
  const [active, setActive] = useState<{ id: string; kind?: AiRunKind } | null>(null);
  const activeId = active?.id ?? null;
  const [pollTick, setPollTick] = useState(0);
  /** Asks for the progress that failed in a row (the server or the connection): the wait grows with them. */
  const [failures, setFailures] = useState(0);
  /** Why the progress can no longer be asked for (signed out, no right to it...). */
  const [pollError, setPollError] = useState<unknown>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  /** A draft_note follow-up started from "Draft a guidance note": its note opens the editor when it is done. */
  const draftFor = useRef<{ runId: string; finding: AiFinding } | null>(null);
  const asked = useRef(new Set<string>());
  /** Runs finished here or given up on: never followed again, even while the list still says running. */
  const done = useRef(new Set<string>());
  const labels = useMemo(() => labelsOf(data.questions), [data.questions]);

  const list = runs.data ?? [];
  const reports = list.filter((r) => r.kind === "report");
  const shownId = selected ?? reports.find((r) => r.status === "done")?.id ?? reports[0]?.id ?? null;
  const shown = reports.find((r) => r.id === shownId) ?? null;
  const running = list.find((r) => r.status === "running") ?? null;
  const canRun = ai.data?.enabled === true && ai.data.available;
  const busy = starting || activeId !== null || running !== null;
  const toFollow = runToFollow(list, activeId, done.current);

  // A run that is running (started here, elsewhere, or before a reload) is followed.
  useEffect(() => {
    if (activeId === null && toFollow !== null) setActive({ id: toFollow });
  }, [activeId, toFollow]);

  // Its progress, every 2 s while the page is visible; after a failure of the server or
  // the connection, a little later each time (2, 4, 8... up to 30 s).
  useEffect(() => {
    if (!activeId || !shouldPollRun("running", hidden)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getAiRun(projectId, activeId).then(
        (run) => {
          if (cancelled) return;
          setFailures(0);
          setDetails((old) => new Map(old).set(run.id, run));
          if (run.status === "running") {
            setPollTick((n) => n + 1);
            return;
          }
          // Finished: the list says so at once (before it is loaded again), so the run is not followed again.
          done.current.add(run.id);
          runs.setData((prev) => withRunState(prev, run));
          setActive(null);
          runs.reload();
          if (run.kind === "report" && run.status === "done") setSelected(run.id);
          const draft = draftFor.current;
          if (draft && draft.runId === run.id) {
            draftFor.current = null;
            if (run.answer?.note) {
              onWriteNote({
                questionKey: draft.finding.questions.find((k) => data.questions.some((q) => q.key === k)) ?? "",
                firstValue: null,
                checkValue: null,
                text: withQuestionLabels(run.answer.note, labels),
              });
            }
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          const next = runPollFailure(err);
          if (next === "retry") {
            setFailures((n) => n + 1);
            return;
          }
          // Gone, or refused (signed out, no right to it): it is not asked for again.
          done.current.add(activeId);
          setActive(null);
          setFailures(0);
          if (next === "stop") setPollError(err);
          runs.reload();
        },
      );
    }, failures === 0 ? RUN_POLL_MS : runRetryDelay(failures));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeId, hidden, pollTick, failures]);

  // The shown review and its follow-ups and questions, once each (finished runs do not change).
  const wanted = shown ? [shown, ...list.filter((r) => r.parentRunId === shown.id)] : [];
  const missing = wanted.filter((r) => r.status !== "running" && !details.has(r.id) && !asked.current.has(r.id)).map((r) => r.id);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    for (const id of missingKey.split(",")) {
      asked.current.add(id);
      getAiRun(projectId, id).then(
        (run) => setDetails((old) => new Map(old).set(run.id, run)),
        () => asked.current.delete(id),
      );
    }
  }, [projectId, missingKey]);

  const start = async (body: AiStart, finding?: AiFinding): Promise<boolean> => {
    setStartError(null);
    setStarting(true);
    try {
      const runId = await startAiRun(projectId, body, language);
      if (finding) draftFor.current = { runId, finding };
      setPollError(null);
      setFailures(0);
      // Its kind is known now: a review's progress shows at once, not after the first answer.
      setActive({ id: runId, kind: body.kind });
      runs.reload();
      return true;
    } catch (err) {
      setStartError(err);
      if (err instanceof ApiError && err.status === 409 && err.code === "busy") runs.reload();
      return false;
    } finally {
      setStarting(false);
    }
  };

  const startText = startError ? startErrorText(t, startError, language) : null;
  const activeRun = activeId ? details.get(activeId) : undefined;
  const reportRunning = followedKind(active, list, details) === "report";

  return (
    <QuestionLabels.Provider value={labels}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="ai-title">
        <Stack spacing={2}>
          <Typography variant="h2" id="ai-title">
            {t("ai.title")}
          </Typography>
          <Typography color="text.secondary">{t("ai.explain")}</Typography>
          {ai.error ? (
            <ErrorAlert error={ai.error} onRetry={ai.reload} />
          ) : !ai.data ? (
            <Loading />
          ) : !ai.data.available ? (
            <Alert severity="info">{t("ai.notSetUp")}</Alert>
          ) : !ai.data.enabled ? (
            <Alert
              severity="info"
              action={
                <Button color="inherit" size="small" {...linkProps(pathFor({ name: "project", projectId, tab: "settings" }))}>
                  {t("ai.openSettings")}
                </Button>
              }
            >
              {t("ai.switchedOff")}
            </Alert>
          ) : (
            <Box>
              <Button variant="contained" startIcon={<AutoAwesome />} disabled={busy} onClick={() => void start({ kind: "report" })}>
                {reports.length > 0 ? t("ai.startAgain") : t("ai.start")}
              </Button>
            </Box>
          )}
          {activeId !== null && reportRunning && <Progress run={activeRun} hidden={hidden} />}
          {activeId !== null && failures >= LOST_CONTACT_AFTER && (
            <Alert severity="warning" role="status">
              {t("ai.lostContact")}
            </Alert>
          )}
          <ErrorAlert error={pollError} />
          {startText ? <Alert severity="warning">{startText}</Alert> : <ErrorAlert error={startError} />}
          {runs.error ? <ErrorAlert error={runs.error} onRetry={runs.reload} /> : null}
          {shown && (
            <Report
              summary={shown}
              run={details.get(shown.id)}
              runs={list}
              details={details}
              data={data}
              hidden={hidden}
              canRun={canRun}
              busy={busy}
              onStart={start}
              onWriteNote={onWriteNote}
              onShowPlot={onShowPlot}
            />
          )}
          {reports.length > 0 && (
            <Box>
              <Typography variant="h3" sx={{ mb: 0.5 }}>
                {t("ai.pastTitle")}
              </Typography>
              <List disablePadding>
                {reports.map((r) => (
                  <ListItem key={r.id} divider disableGutters sx={{ gap: 1, flexWrap: "wrap" }}>
                    <ListItemText
                      primary={formatDate(r.startedAt, language)}
                      secondary={r.startedBy ?? t("ai.deletedAccount")}
                      sx={{ flex: "1 1 160px", wordBreak: "break-word" }}
                    />
                    <Chip size="small" label={t(STATUS_LABEL[r.status])} color={r.status === "done" ? "success" : r.status === "running" ? "info" : "default"} variant="outlined" />
                    {r.status === "running" ? null : r.id === shownId ? (
                      <Typography variant="body2" color="text.secondary">
                        {t("ai.pastShowing")}
                      </Typography>
                    ) : (
                      <Button size="small" onClick={() => setSelected(r.id)}>
                        {t("ai.pastShow")}
                      </Button>
                    )}
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Stack>
      </Paper>
    </QuestionLabels.Provider>
  );
}
