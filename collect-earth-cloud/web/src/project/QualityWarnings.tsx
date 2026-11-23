import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useEffect, type ReactNode } from "react";
import visuallyHidden from "@mui/utils/visuallyHidden";
import { ApiError, getProgress, getReference, type AnswerOptions } from "../api";
import { useApp } from "../appContext";
import { LevelChip, MarginBar, TrendMark, VerdictChip } from "../components/Accuracy";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { attentionAction, attentionText, browserTimeZone, peopleOf } from "../progressView";
import { answerText, formatRate } from "../qualityView";
import { linkProps, pathFor } from "../router";
import { kappaText } from "../trainingView";
import { useLoad } from "../useLoad";
import { onceVisibleAfter } from "../visibility";
import { earlyWarning, LAYERS, type EarlyWarning, type LayerId, type Level } from "../warningsView";

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;

const ACCENT: Record<Level, string> = { problem: "error.main", look: "warning.main", ok: "success.main", early: "divider", none: "divider" };

/** One layer: its number and question, how it stands, what it tells, what was found and what to do about it. */
function Layer({ id, index, level, children, todo }: { id: LayerId; index: number; level: Level; children: ReactNode; todo?: ReactNode }) {
  const t = useT();
  return (
    <Paper variant="outlined" component="section" id={`layer-${id}`} aria-labelledby={`layer-${id}-title`} sx={{ p: { xs: 2, sm: 3 }, borderLeft: 4, borderLeftColor: ACCENT[level], scrollMarginTop: { xs: 72, sm: 150 } }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="h2" id={`layer-${id}-title`} sx={{ flex: "1 1 auto" }}>
            {index}. {t(`warn.layer.${id}` as MessageKey)}
          </Typography>
          <LevelChip level={level} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {t(`warn.why.${id}` as MessageKey)}
        </Typography>
        {children}
        {todo && (
          <Box sx={{ bgcolor: "#f8fafc", border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            <Typography variant="body2" component="div">
              <Box component="span" sx={{ fontWeight: 600 }}>
                {t("warn.todo")}
              </Box>{" "}
              {todo}
            </Typography>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function Arriving({ projectId, w }: { projectId: string; w: EarlyWarning }) {
  const t = useT();
  const { language } = useApp();
  if (w.arriving === null) return <Typography variant="body2">{t("warn.arriving.reviewer")}</Typography>;
  if (w.arriving.length === 0) return <Typography variant="body2">{t("warn.arriving.fine")}</Typography>;
  return (
    <Stack spacing={1.5}>
      {w.arriving.map((item) => {
        const { title, text } = attentionText(t, item, language);
        const action = attentionAction(t, item.kind);
        const people = peopleOf(item);
        return (
          <Box key={item.kind} sx={{ display: "flex", gap: 1.5, flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "flex-start" } }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h3">{title}</Typography>
              {text.map((s) => (
                <Typography key={s} variant="body2" color="text.secondary">
                  {s}
                </Typography>
              ))}
              {people.length > 0 && (
                <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                  {people.map((p) => p.username).join(", ")}
                  {item.count > people.length && " …"}
                </Typography>
              )}
            </Box>
            <Button size="small" variant="outlined" {...linkProps(pathFor({ name: "project", projectId, tab: action.tab, ...(action.view ? { view: action.view } : {}) }))}>
              {action.label}
            </Button>
          </Box>
        );
      })}
    </Stack>
  );
}

function Reference({ projectId, w, options }: { projectId: string; w: EarlyWarning; options: AnswerOptions }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const { unassessed, waiting, doubtful, doubtfulTotal } = w.reference;
  const level = w.levels.reference;
  return (
    <Stack spacing={1.5}>
      {level === "early" && <Typography variant="body2">{t("warn.ref.early")}</Typography>}
      {level === "ok" && <Typography variant="body2">{t("warn.ref.fine")}</Typography>}
      {unassessed > 0 && level !== "early" && (
        <Typography variant="body2">
          {t("warn.ref.unassessed", { count: n(unassessed), plots: n(w.so.plots) })}
          {waiting > 0 && ` ${t("warn.ref.waiting", { count: n(waiting) })}`}
        </Typography>
      )}
      {doubtfulTotal > 0 && doubtful.length === 0 && <Typography variant="body2">{t("warn.ref.doubtReviewer", { count: n(doubtfulTotal) })}</Typography>}
      {doubtful.length > 0 && (
        <>
          <Typography variant="body2">{t("warn.ref.doubtIntro", { count: n(doubtfulTotal), plots: n(w.reference.doubtfulPlots) })}</Typography>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("warn.col.plot")}</TableCell>
                  <TableCell>{t("warn.col.question")}</TableCell>
                  <TableCell>{t("warn.ref.col.reference")}</TableCell>
                  <TableCell>{t("warn.ref.col.majority")}</TableCell>
                  <TableCell>{t("warn.ref.col.count")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {doubtful.map((d, i) => (
                  <TableRow key={`${d.plot}\n${d.key}`}>
                    <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                      {/* A plot's name once: its other answers in doubt follow it. */}
                      {i > 0 && doubtful[i - 1].plot === d.plot ? <Box component="span" sx={visuallyHidden}>{d.plot}</Box> : <Link {...linkProps(pathFor({ name: "plot", projectId, plot: d.plot }))}>{d.plot}</Link>}
                    </TableCell>
                    <TableCell sx={{ wordBreak: "break-word", minWidth: 140 }}>{d.label}</TableCell>
                    <TableCell sx={{ wordBreak: "break-word", minWidth: 140 }}>
                      {d.reference === "" ? t("warn.ref.blank") : answerText(t, d.key, d.reference, options)}
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        {" "}
                        · {d.assessor}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ wordBreak: "break-word", minWidth: 140, fontWeight: 500 }}>{answerText(t, d.key, d.majority, options)}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t("warn.ref.countOf", { count: n(d.count), of: n(d.of) })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {doubtfulTotal > doubtful.length && (
            <Typography variant="body2" color="text.secondary">
              {t("warn.listed", { shown: n(doubtful.length), total: n(doubtfulTotal) })}
            </Typography>
          )}
        </>
      )}
    </Stack>
  );
}

function Questions({ w }: { w: EarlyWarning }) {
  const t = useT();
  const { language } = useApp();
  if (w.questions.length === 0) return <Typography variant="body2">{t("warn.q.none")}</Typography>;
  return (
    <TableContainer sx={tableFrame}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t("warn.col.question")}</TableCell>
            <TableCell>{t("warn.q.col.accuracy")}</TableCell>
            <TableCell>{t("warn.col.verdict")}</TableCell>
            <TableCell>{t("warn.q.col.among")}</TableCell>
            <TableCell>{t("warn.q.col.reading")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {w.questions.map((q) => (
            <TableRow key={q.key} sx={{ verticalAlign: "top" }}>
              <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 140 }}>
                {q.label}
              </TableCell>
              <TableCell>
                <MarginBar tally={q} target={w.target} />
              </TableCell>
              <TableCell>
                <VerdictChip verdict={q.verdict} />
              </TableCell>
              <TableCell sx={{ minWidth: 170, fontVariantNumeric: "tabular-nums" }}>
                {q.among && q.among.compared > 0
                  ? t("warn.q.among", { pct: formatRate(q.among.agreeing / q.among.compared, language), kappa: kappaText(q.among.kappa, language) })
                  : "–"}
              </TableCell>
              <TableCell sx={{ minWidth: 220 }}>{q.reading === null ? "–" : t(`warn.q.reading.${q.reading}` as MessageKey, { who: q.who.join(", ") })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function People({ projectId, w }: { projectId: string; w: EarlyWarning }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const people = w.people;
  if (!people) return <Typography variant="body2">{t("warn.p.reviewer")}</Typography>;
  return (
    <Stack spacing={1.5}>
      {people.rows.length === 0 ? (
        <Typography variant="body2">{t("warn.p.none")}</Typography>
      ) : (
        <>
          <Typography variant="body2">
            {t("warn.p.counts", { below: n(people.counts.below), watch: n(people.counts.watch), ok: n(people.counts.ok), early: n(people.counts.early) })}
          </Typography>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("reference.col.person")}</TableCell>
                  <TableCell>{t("warn.p.col.answers")}</TableCell>
                  <TableCell>{t("warn.col.verdict")}</TableCell>
                  <TableCell>{t("warn.p.col.weak")}</TableCell>
                  <TableCell>{t("warn.p.col.done")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {people.rows.map((p) => (
                  <TableRow key={p.username} sx={{ verticalAlign: "top" }}>
                    <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 120 }}>
                      {p.userId ? <Link {...linkProps(pathFor({ name: "person", projectId, userId: p.userId }))}>{p.username}</Link> : p.username}
                    </TableCell>
                    <TableCell>
                      <MarginBar tally={p.answers} target={w.target} />
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
                        <VerdictChip verdict={p.verdict} />
                        <TrendMark trend={p.trend} />
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 190, wordBreak: "break-word" }}>
                      {p.weak.length === 0
                        ? "–"
                        : p.weak.map((q) => (
                            <Box key={q.key} sx={{ fontWeight: q.verdict === "below" ? 600 : 400 }}>
                              {t("warn.p.weak", { label: q.label, agreeing: n(q.agreeing), count: n(q.compared) })}
                            </Box>
                          ))}
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{p.done ? t("warn.doneOf", { checked: n(p.done.checked), copies: n(p.done.copies) }) : "–"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {people.notStarted.length > 0 && (
        <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
          {t("warn.p.notStarted", { names: people.notStarted.join(", ") })}
        </Typography>
      )}
    </Stack>
  );
}

function Plots({ projectId, w }: { projectId: string; w: EarlyWarning }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const plots = w.plots;
  if (!plots) return <Typography variant="body2">{t("warn.plots.reviewer")}</Typography>;
  const level = w.levels.plots;
  return (
    <Stack spacing={1.5}>
      {plots.total === 0 && w.inUse && <Typography variant="body2">{t(level === "early" ? "warn.plots.early" : "warn.plots.fine")}</Typography>}
      {plots.rows.length > 0 && (
        <>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("warn.col.plot")}</TableCell>
                  <TableCell>{t("warn.plots.col.match")}</TableCell>
                  <TableCell>{t("warn.plots.col.note")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {plots.rows.map((p) => (
                  <TableRow key={p.plot}>
                    <TableCell component="th" scope="row">
                      <Link {...linkProps(pathFor({ name: "plot", projectId, plot: p.plot }))}>{p.plot}</Link>
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t("warn.plots.matchOf", { agreeing: n(p.agreeing), checks: n(p.checks) })}</TableCell>
                    <TableCell>{p.doubt ? <Chip size="small" variant="outlined" color="warning" label={t("warn.plots.doubt")} /> : "–"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {plots.total > plots.rows.length && (
            <Typography variant="body2" color="text.secondary">
              {t("warn.listed", { shown: n(plots.rows.length), total: n(plots.total) })}
            </Typography>
          )}
        </>
      )}
      {plots.worthALook > 0 && (
        <Box sx={{ display: "flex", gap: 1.5, flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "center" } }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t(plots.worthALook === 1 ? "attention.worthALookOne" : "attention.worthALook", { count: n(plots.worthALook) })}
          </Typography>
          <Button size="small" variant="outlined" {...linkProps(pathFor({ name: "project", projectId, tab: "quality", view: "review" }))}>
            {t("progress.goQueue")}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/**
 * "Early warning" on the Quality tab: what the reference plots (and the Progress cards) say of the collection so far,
 * by layer, from the first plots: every share comes with its margin of error and a verdict against the project's
 * accuracy target (warningsView.ts). Coordinators get every layer; reviewers the reference and the questions.
 */
export function QualityWarnings({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const { data, error, loading, reload } = useLoad(["project", projectId, "getReference"], () => getReference(projectId));
  const timeZone = browserTimeZone();
  // The Progress cards, for the first layer: the same load as the Progress tab's. Without them the layer says nothing.
  const progress = useLoad(["project", projectId, "getProgress", timeZone], () => getProgress(projectId, timeZone));
  const busy = error instanceof ApiError && error.code === "busy";
  const stale = data?.figures.stale === true;
  // Newer figures are being worked out (or the server is busy): ask again in a while.
  useEffect(() => {
    if (loading || !(stale || busy)) return;
    return onceVisibleAfter(busy ? 15_000 : 20_000, document, reload);
  }, [loading, stale, busy, reload]);

  const setup = pathFor({ name: "project", projectId, tab: "setup", view: "quality" });
  const w = data ? earlyWarning(data, progress.data ? progress.data.attention : null) : null;
  const go = (view: "checks" | "figures" | "notes", label: MessageKey) => (
    <Button size="small" variant="outlined" {...linkProps(pathFor({ name: "project", projectId, tab: "quality", view }))}>
      {t(label)}
    </Button>
  );

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="warnings-title">
        <Stack spacing={2}>
          <Typography variant="h2" id="warnings-title">
            {t("warn.title")}
          </Typography>
          <Explain text={t("warn.explain.short")} more={t("warn.explain")} />
          {!data && loading && <Loading />}
          {busy && (
            <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={reload}>{t("common.retry")}</Button>}>
              {t("quality.busy")}
            </Alert>
          )}
          {error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />}
          {w && data && (
            <>
              {w.inUse ? (
                <Typography variant="body2" color="text.secondary">
                  {data.coordinator
                    ? t("warn.soFar", { assessed: n(w.so.assessed), plots: n(w.so.plots), checks: n(w.so.checks), collectors: n(w.so.collectors), judged: n(w.so.judged) })
                    : t("warn.soFarReviewer", { assessed: n(w.so.assessed), plots: n(w.so.plots), checks: n(w.so.checks) })}{" "}
                  {t("warn.target", { target: formatRate(w.target / 100, language) })}
                  {data.coordinator && (
                    <>
                      {" "}
                      <Link {...linkProps(setup)}>{t("setup.change")}</Link>
                    </>
                  )}{" "}
                  {t(stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.figures.computedAt, language) })}
                </Typography>
              ) : (
                <Alert
                  severity="info"
                  action={
                    data.coordinator ? (
                      <Button color="inherit" size="small" {...linkProps(setup)}>
                        {t("reference.setUp")}
                      </Button>
                    ) : undefined
                  }
                >
                  {t("warn.noReference")}
                </Alert>
              )}
              {w.inUse && (
                <Alert severity={w.first === null ? (w.so.checks === 0 ? "info" : "success") : w.levels[w.first] === "problem" ? "error" : "warning"} role="status">
                  {w.first === null
                    ? t(w.so.checks === 0 ? "warn.allEarly" : "warn.allClear")
                    : t("warn.start", { n: LAYERS.indexOf(w.first) + 1, name: t(`warn.layer.${w.first}` as MessageKey) })}
                </Alert>
              )}
              {/* The five layers at a glance; each one leads to its section below. */}
              <Box component="nav" aria-label={t("warn.layers")} sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: "repeat(5, 1fr)" } }}>
                {LAYERS.map((id, i) => (
                  <Box
                    key={id}
                    component="a"
                    href={`#layer-${id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`layer-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.75,
                      alignItems: "flex-start",
                      p: 1.25,
                      border: 1,
                      borderColor: "divider",
                      borderTop: 3,
                      borderTopColor: ACCENT[w.levels[id]],
                      borderRadius: 1,
                      color: "text.primary",
                      textDecoration: "none",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {i + 1}. {t(`warn.short.${id}` as MessageKey)}
                    </Typography>
                    <LevelChip level={w.levels[id]} />
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Stack>
      </Paper>
      {w && data && (
        <Box sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
          <Stack spacing={3}>
            <Layer id="arriving" index={1} level={w.levels.arriving}>
              <Arriving projectId={projectId} w={w} />
            </Layer>
            {w.inUse && (
              <>
                <Layer id="reference" index={2} level={w.levels.reference} todo={w.reference.doubtfulTotal > 0 ? t("warn.ref.do") : w.levels.reference === "look" ? t("warn.ref.doLate") : undefined}>
                  <Reference projectId={projectId} w={w} options={data.figures.options ?? {}} />
                </Layer>
                <Layer
                  id="questions"
                  index={3}
                  level={w.levels.questions}
                  todo={
                    w.levels.questions === "problem" || w.levels.questions === "look" ? (
                      <>
                        {t("warn.q.do")}
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                          {go("notes", "warn.goNotes")}
                          {go("checks", "warn.goReference")}
                          {go("figures", "warn.goFigures")}
                        </Box>
                      </>
                    ) : undefined
                  }
                >
                  <Questions w={w} />
                </Layer>
                <Layer id="people" index={4} level={w.levels.people} todo={w.levels.people === "problem" || w.levels.people === "look" ? t("warn.p.do") : undefined}>
                  <People projectId={projectId} w={w} />
                </Layer>
              </>
            )}
            {(w.inUse || (w.plots?.worthALook ?? 0) > 0) && (
              <Layer id="plots" index={5} level={w.levels.plots} todo={(w.plots?.total ?? 0) > 0 ? t("warn.plots.do") : undefined}>
                <Plots projectId={projectId} w={w} />
              </Layer>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
