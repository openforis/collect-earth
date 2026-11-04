import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTrainingFigures, type TrainingFiguresSet, type TrainingQuestion } from "../api";
import { useApp } from "../appContext";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { answerLabel, kappaText, questionLabel, shareText } from "../trainingView";
import { useLoad } from "../useLoad";
import { EmptyState } from "./EmptyState";
import { ErrorAlert } from "./ErrorAlert";
import { Loading } from "./Loading";

/**
 * The reviewers' Training tab: how much the participants of each training set agree, without
 * anyone's name (as for reference plots, no one's agreement by name), read-only. A set the
 * reviewer takes part in shows once they submitted all its plots.
 */
export function TrainingFigures({ projectId }: { projectId: string }) {
  const t = useT();
  const state = useLoad(() => getTrainingFigures(projectId), [projectId]);
  if (state.loading && !state.data) return <Loading />;
  if (state.error || !state.data) return <ErrorAlert error={state.error} onRetry={state.reload} />;
  return (
    <Stack spacing={3}>
      <Typography color="text.secondary">{t("trainingFigures.explain")}</Typography>
      {state.data.sets.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState title={t("training.none")} />
        </Paper>
      ) : (
        state.data.sets.map((set) => <SetFigures key={set.id} set={set} questions={state.data!.questions} />)
      )}
    </Stack>
  );
}

function SetFigures({ set, questions }: { set: TrainingFiguresSet; questions: TrainingQuestion[] }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const c = set.calibration;
  const answered = c ? c.plots.filter((p) => p.people > 0) : [];
  const labels = [...questions, ...(c?.questions ?? [])];
  return (
    <Paper variant="outlined" component="section" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <Typography variant="h2" sx={{ overflowWrap: "anywhere" }}>
            {set.name}
          </Typography>
          <Chip size="small" variant="outlined" label={t(set.kind === "learning" ? "training.kindLearning" : "training.kindCalibration")} />
        </Stack>
        {set.takingPart ? (
          <Alert severity="info">{t("trainingFigures.takingPart", { done: n(set.takingPart.submitted), plots: n(set.plotCount) })}</Alert>
        ) : !c || answered.length === 0 ? (
          <Typography color="text.secondary">{t("training.calibrationNone")}</Typography>
        ) : (
          <>
            <Typography>
              {t("trainingFigures.people", { count: n(c.participants), plots: n(set.plotCount) })}{" "}
              {t("training.overall", { rate: shareText(c.overall, language), agreeing: n(c.overall.agreeing), compared: n(c.overall.compared) })}
            </Typography>
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("training.colQuestion")}</TableCell>
                    <TableCell align="right">{t("training.colPairs")}</TableCell>
                    <TableCell align="right">{t("training.colKappa")}</TableCell>
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
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t("training.kappaHelp")}
            </Typography>
            <Typography variant="h3">{t("training.plotsTitle")}</Typography>
            <Stack spacing={1}>
              {answered.map((plot) => {
                const differs = plot.questions.some((q) => q.pairs.agreeing < q.pairs.compared);
                return (
                  <Box key={plot.plot} component="details" sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}>
                    <Box component="summary" sx={{ cursor: "pointer" }}>
                      {t("training.plotLine", { plot: plot.plot, count: n(plot.people) })}
                      {differs && ` · ${t("training.plotDiffers")}`}
                    </Box>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {plot.questions.map((q) => (
                        <Box key={q.key}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {questionLabel(labels, q.key)}
                          </Typography>
                          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", my: 0.5 }}>
                            {q.answers.map((a) => (
                              <Chip key={a.value} size="small" variant={q.answers.length > 1 ? "outlined" : "filled"} label={`${answerLabel(questions, q.key, a.value)} × ${n(a.count)}`} />
                            ))}
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {q.consensus === null
                              ? t("trainingFigures.tie")
                              : t(c.questions.find((x) => x.key === q.key)?.kind === "number" ? "trainingFigures.median" : "trainingFigures.mostGiven", {
                                  value: answerLabel(questions, q.key, q.consensus),
                                })}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}
