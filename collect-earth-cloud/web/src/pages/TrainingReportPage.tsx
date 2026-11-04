import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useEffect, type ReactNode } from "react";
import { getTrainingSet, sendUsageEvent, type TrainingSetView } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { answerLabel, goldenKeys, kappaText, plotAccuracy, questionAccuracy, questionLabel, shareText } from "../trainingView";
import { useLoad } from "../useLoad";
import { Block, ReportFrame } from "./ReportPages";

/** A table that prints whole rows and repeats its header on each page. */
function PrintTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" sx={{ "& thead": { display: "table-header-group" }, "& tr": { breakInside: "avoid" } }}>
        <TableHead>
          <TableRow>
            {head.map((h, i) => (
              <TableCell key={i} align={i === 0 ? "left" : "right"}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </Box>
  );
}

function Row({ cells }: { cells: ReactNode[] }) {
  return (
    <TableRow>
      {cells.map((c, i) =>
        i === 0 ? (
          <TableCell key={i} component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
            {c}
          </TableCell>
        ) : (
          <TableCell key={i} align="right">
            {c}
          </TableCell>
        ),
      )}
    </TableRow>
  );
}

/**
 * A training set's printable report (coordinators): the set, how much the participants agree
 * (calibration), each one's score and the weakest questions and plots (learning), and the golden
 * interpretation with its explanations. It names people: for the coordinators and trainers.
 */
// The heading stays empty while loading, so the page's title waits for the set's name.
export function TrainingReportPage({ projectId, setId }: { projectId: string; setId: string }) {
  const t = useT();
  const { info } = useApp();
  const state = useLoad(() => getTrainingSet(projectId, setId), [projectId, setId]);
  const data = state.data;
  const kind = data?.set.kind;
  // Usage events (when the server sends them): the report opened, and printed.
  useEffect(() => {
    if (!kind || !info.telemetry?.events) return;
    sendUsageEvent(projectId, "training_report_opened", { kind });
    const printed = () => sendUsageEvent(projectId, "training_report_printed", { kind });
    window.addEventListener("afterprint", printed);
    return () => window.removeEventListener("afterprint", printed);
  }, [projectId, kind, info.telemetry?.events]);
  return (
    <ReportFrame projectId={projectId} title={data ? t("trainingReport.title", { name: data.set.name }) : state.error ? t("trainingReport.titlePlain") : ""} back="training" printable={Boolean(data)}>
      {!data ? state.loading ? <Loading /> : <ErrorAlert error={state.error} onRetry={state.reload} /> : <Report view={data} />}
    </ReportFrame>
  );
}

function Report({ view }: { view: TrainingSetView }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const { set, calibration: c } = view;
  const answered = c.plots.some((p) => p.people.length > 0);
  const learning = set.kind === "learning";
  const scored = view.scores.filter((s) => s.score.submitted > 0 || s.history.length > 0);
  const questions = questionAccuracy(view.scores);
  const plots = plotAccuracy(view.scores);
  const labels = [...view.questions, ...c.questions];
  const golden = new Map(view.golden.map((g) => [g.plotKey, g]));
  const passed = view.scores.filter((s) => s.score.passed === true).length;

  return (
    <>
      <Typography color="text.secondary">{t("trainingReport.intro", { date: formatDate(Date.now(), language) })}</Typography>
      <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
        {[
          [t("training.kind"), t(learning ? "training.kindLearning" : "training.kindCalibration")],
          [t("training.colPlots"), n(set.plotCount)],
          [t("training.colPeople"), n(set.participants.length)],
          [t("training.colGolden"), n(view.golden.length)],
          ...(learning && set.passMark !== null ? [[t("trainingReport.passed"), `${n(passed)} / ${n(view.scores.length)}`]] : []),
        ].map(([label, value]) => (
          <Box key={label}>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography sx={{ fontSize: "1.6rem", fontWeight: 600, lineHeight: 1.2 }}>{value}</Typography>
          </Box>
        ))}
      </Stack>
      {set.passMark !== null && learning && <Typography variant="body2">{t("training.passMarkIs", { mark: n(set.passMark) })}</Typography>}
      {set.participants.length > 0 && (
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {t("trainingReport.participants", { names: set.participants.map((p) => p.username).join(", ") })}
        </Typography>
      )}

      {learning && (
        <Block title={t("training.scoresTitle")}>
          {scored.length === 0 ? (
            <Typography color="text.secondary">{t("trainingReport.noScores")}</Typography>
          ) : (
            <PrintTable
              head={[t("training.colPerson"), t("training.colAttempt"), t("training.colDone"), t("training.colAccuracy"), t("training.colPlotsRight"), t("training.colPassed"), t("training.colEarlier")]}
            >
              {view.scores.map((s) => (
                <Row
                  key={s.userId}
                  cells={[
                    s.username,
                    n(s.attempt.number),
                    `${n(s.score.submitted)}/${n(s.score.plots)}`,
                    shareText(s.score.answers, language),
                    n(s.score.plotsRight),
                    set.passMark === null ? "–" : s.score.passed === null ? t("training.notFinished") : t(s.score.passed ? "training.passed" : "training.notPassed"),
                    s.history.length === 0 ? "–" : s.history.map((h) => t("training.historyItem", { n: n(h.number), rate: shareText(h.answers, language) })).join(" · "),
                  ]}
                />
              ))}
            </PrintTable>
          )}
        </Block>
      )}

      {learning && questions.length > 0 && (
        <Block title={t("trainingReport.questionsTitle")}>
          <Typography variant="body2" color="text.secondary">
            {t("trainingReport.questionsExplain")}
          </Typography>
          <PrintTable head={[t("training.colQuestion"), t("training.colAccuracy"), t("trainingReport.colAnswers")]}>
            {questions.map((q) => (
              <Row key={q.key} cells={[questionLabel(labels, q.key), shareText(q, language), `${n(q.agreeing)}/${n(q.compared)}`]} />
            ))}
          </PrintTable>
        </Block>
      )}

      {learning && plots.length > 0 && (
        <Block title={t("trainingReport.plotsTitle")}>
          <Typography variant="body2" color="text.secondary">
            {t("trainingReport.plotsExplain")}
          </Typography>
          <PrintTable head={[t("trainingReport.colPlot"), t("training.colAccuracy"), t("trainingReport.colAllRight")]}>
            {plots.map((p) => (
              <Row key={p.key} cells={[p.key, shareText(p, language), `${n(p.allRight ?? 0)}/${n(p.people ?? 0)}`]} />
            ))}
          </PrintTable>
        </Block>
      )}

      {answered && (
        <Block title={t("training.calibrationTitle")}>
          <Typography variant="body2" color="text.secondary">
            {t("training.calibrationExplain")}
          </Typography>
          <Typography>{t("training.overall", { rate: shareText(c.overall, language), agreeing: n(c.overall.agreeing), compared: n(c.overall.compared) })}</Typography>
          <PrintTable head={[t("training.colQuestion"), t("training.colPairs"), t("training.colKappa")]}>
            {c.questions.map((q) => (
              <Row key={q.key} cells={[q.label, `${shareText(q.pairs, language)} (${n(q.pairs.agreeing)}/${n(q.pairs.compared)})`, kappaText(q.kappa, language)]} />
            ))}
          </PrintTable>
          <Typography variant="body2" color="text.secondary">
            {t("training.kappaHelp")}
          </Typography>
          <Typography variant="h3">{t("training.peopleTitle")}</Typography>
          <PrintTable head={[t("training.colPerson"), t("training.colDone"), t("training.colWithConsensus")]}>
            {c.people.map((p) => (
              <Row key={p.username} cells={[p.username, `${n(p.plots)}/${n(view.plots.length)}`, shareText(p.withConsensus, language)]} />
            ))}
          </PrintTable>
          {!learning && (
            <>
              <Typography variant="h3">{t("trainingReport.spreadTitle")}</Typography>
              {c.plots
                .filter((p) => p.questions.some((q) => q.pairs.agreeing < q.pairs.compared))
                .map((p) => (
                  <Box key={p.plot} sx={{ breakInside: "avoid" }}>
                    <Typography sx={{ fontWeight: 600 }}>{t("training.goldenPlot", { plot: p.plot })}</Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                      {p.questions
                        .filter((q) => q.pairs.agreeing < q.pairs.compared)
                        .map((q) => (
                          <li key={q.key}>
                            {questionLabel(labels, q.key)}: {q.answers.map((a) => `${answerLabel(view.questions, q.key, a.value)} × ${n(a.count)}`).join(", ")}
                          </li>
                        ))}
                    </Box>
                  </Box>
                ))}
            </>
          )}
        </Block>
      )}

      {/* Printed, the golden answers start a page of their own (the heading never ends a page alone). */}
      <Paper variant="outlined" component="section" sx={{ p: { xs: 2, sm: 3 }, "@media print": { breakBefore: "page" } }}>
        <Stack spacing={1.5}>
          <Typography variant="h2">{t("training.goldenTitle")}</Typography>
          {view.golden.length === 0 ? (
            <Alert severity="info">{t("trainingReport.noGolden")}</Alert>
          ) : (
            view.plots
              .filter((plot) => golden.has(plot))
              .map((plot) => {
                const g = golden.get(plot)!;
                const keys = goldenKeys(view.questions, g.answers).filter((k) => (g.answers[k] ?? "").trim() !== "");
                return (
                  <Box key={plot} sx={{ breakInside: "avoid", borderTop: 1, borderColor: "divider", pt: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>{t("training.goldenPlot", { plot })}</Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                      {keys.map((k) => (
                        <li key={k}>
                          {questionLabel(labels, k)}: {answerLabel(view.questions, k, g.answers[k])}
                        </li>
                      ))}
                    </Box>
                    {g.note && (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        <strong>{t("training.why")}</strong> {g.note}
                      </Typography>
                    )}
                  </Box>
                );
              })
          )}
        </Stack>
      </Paper>
    </>
  );
}
