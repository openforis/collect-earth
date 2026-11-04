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
import CheckCircle from "@mui/icons-material/CheckCircle";
import Cancel from "@mui/icons-material/Cancel";
import { getMyTraining, type MyTrainingSet, type ScoredPlot } from "../api";
import { useApp } from "../appContext";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";
import { shareText } from "../trainingView";
import { ErrorAlert } from "./ErrorAlert";

/**
 * My work's Training section: the calibration and learning sets the person takes part in. For a
 * learning set, each plot they submitted in the open attempt with their answers next to the golden
 * ones and the coordinator's explanation; nothing at all when they take part in none.
 */
export function MyTraining({ projectId }: { projectId: string }) {
  const t = useT();
  const state = useLoad(() => getMyTraining(projectId), [projectId]);
  if (state.error) return <ErrorAlert error={state.error} onRetry={state.reload} />;
  if (!state.data || state.data.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="my-training">
      <Typography variant="h2" id="my-training" gutterBottom>
        {t("training.mineTitle")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("training.mineExplain")}
      </Typography>
      <Stack spacing={3}>
        {state.data.map((set) => (
          <MySet key={set.id} set={set} />
        ))}
      </Stack>
    </Paper>
  );
}

function MySet({ set }: { set: MyTrainingSet }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const score = set.score;
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
      <Typography variant="h3" sx={{ overflowWrap: "anywhere" }}>
        {set.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("training.mineFile", { file: set.servedName })}
        {set.attempt.number > 1 && ` · ${t("training.mineAttempt", { n: n(set.attempt.number) })}`}
      </Typography>
      {set.attempt.number > 1 && set.submitted === 0 && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {t("training.mineNewAttempt", { n: n(set.attempt.number), date: formatDate(set.attempt.startedAt, language) })}
        </Alert>
      )}
      {set.kind === "calibration" || !score ? (
        <Typography>{t("training.mineCalibration", { done: n(set.submitted), plots: n(set.plotCount) })}</Typography>
      ) : (
        <Stack spacing={1.5}>
          <Typography>
            {score.submitted === 0
              ? t("training.mineStart", { plots: n(score.plots) })
              : t("training.mineScore", { rate: shareText(score.answers, language), agreeing: n(score.answers.agreeing), compared: n(score.answers.compared), done: n(score.submitted), plots: n(score.plots) })}
          </Typography>
          {set.passMark !== null && (
            <Alert severity={score.passed ? "success" : "info"}>
              {score.passed === true
                ? t("training.minePassed", { mark: n(set.passMark) })
                : score.passed === false
                  ? t("training.mineNotPassed", { mark: n(set.passMark) })
                  : t("training.minePassMark", { mark: n(set.passMark) })}
            </Alert>
          )}
          {score.byPlot.map((plot) => (
            <MyPlot key={plot.plot} plot={plot} />
          ))}
          {set.history && set.history.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("training.mineHistory", { list: set.history.map((h) => t("training.historyItem", { n: n(h.number), rate: shareText(h.answers, language) })).join(" · ") })}
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}

function MyPlot({ plot }: { plot: ScoredPlot }) {
  const t = useT();
  const { language } = useApp();
  return (
    <Box component="details" open={!plot.right} sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}>
      <Box component="summary" sx={{ cursor: "pointer" }}>
        {t("training.minePlot", { plot: plot.plot })}{" "}
        <Chip
          size="small"
          color={plot.right ? "success" : "warning"}
          variant="outlined"
          label={plot.right ? t("training.allRight") : t("training.someWrong", { rate: shareText(plot.answers, language) })}
          sx={{ ml: 1 }}
        />
      </Box>
      <Box sx={{ overflowX: "auto", mt: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("training.colQuestion")}</TableCell>
              <TableCell>{t("training.colYours")}</TableCell>
              <TableCell>{t("training.colGolden")}</TableCell>
              <TableCell>
                <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {t("training.colRight")}
                </Box>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plot.questions.map((q) => (
              <TableRow key={q.key}>
                <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                  {q.label}
                </TableCell>
                <TableCell>{q.given || t("training.noAnswer")}</TableCell>
                <TableCell>{q.golden}</TableCell>
                <TableCell>
                  {q.right ? (
                    <CheckCircle color="success" fontSize="small" titleAccess={t("training.right")} />
                  ) : (
                    <Cancel color="warning" fontSize="small" titleAccess={t("training.wrong")} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {plot.note && (
        <Alert severity="info" icon={false} sx={{ mt: 1 }}>
          <strong>{t("training.why")}</strong> {plot.note}
        </Alert>
      )}
    </Box>
  );
}
