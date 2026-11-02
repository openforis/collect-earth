import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { ApiError, getSurveyHealth, type HealthRow, type SurveyHealthData } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { agreementText, changedText, emptyText, noneText, orderText, otherText, reasonText } from "../healthView";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto", maxHeight: 560 } as const;

function Row({ row, data, showNone }: { row: HealthRow; data: SurveyHealthData; showNone: boolean }) {
  const t = useT();
  const { language } = useApp();
  return (
    <TableRow sx={{ verticalAlign: "top" }}>
      <TableCell component="th" scope="row" sx={{ minWidth: 130, wordBreak: "break-word" }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {row.label}
        </Typography>
        {row.required && (
          <Typography variant="caption" color="text.secondary" component="div">
            {t("health.required")}
          </Typography>
        )}
        {row.conditional && (
          <Typography variant="caption" color="text.secondary" component="div">
            {t("health.conditional")}
          </Typography>
        )}
        {row.calculated && (
          <Typography variant="caption" color="text.secondary" component="div">
            {t("health.calculated")}
          </Typography>
        )}
      </TableCell>
      <TableCell sx={{ minWidth: 200 }}>
        {row.reasons.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("health.noReason")}
          </Typography>
        ) : (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
            {row.reasons.map((r) => (
              <Typography component="li" variant="body2" key={r}>
                {reasonText(t, r, row, data, language)}
              </Typography>
            ))}
          </Stack>
        )}
      </TableCell>
      <TableCell sx={{ minWidth: 100 }}>{emptyText(t, row, data, language)}</TableCell>
      <TableCell sx={{ minWidth: 130, wordBreak: "break-word" }}>{otherText(t, row, language) || "—"}</TableCell>
      {showNone && <TableCell sx={{ minWidth: 120, wordBreak: "break-word" }}>{noneText(t, row, language) || "—"}</TableCell>}
      <TableCell sx={{ minWidth: 110 }}>{agreementText(t, row, language)}</TableCell>
      <TableCell sx={{ minWidth: 90 }}>{changedText(t, row, data, language)}</TableCell>
    </TableRow>
  );
}

/**
 * The Quality tab's survey health (Task 6; coordinators and reviewers, never collectors):
 * how each question works in practice, for the next version of the survey, the questions
 * worth rewording first with their reasons.
 */
export function QualitySurvey({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useLoad(() => getSurveyHealth(projectId), [projectId]);
  const busy = error instanceof ApiError && error.code === "busy";
  // Newer figures are being worked out (or the server is busy): ask again in a while.
  useEffect(() => {
    if (loading || !(data?.stale || busy)) return;
    const id = window.setTimeout(reload, busy ? 15_000 : 20_000);
    return () => window.clearTimeout(id);
  }, [loading, data?.stale, busy, reload]);

  const worth = data ? data.questions.filter((q) => q.reasons.length > 0) : [];
  const shown = data ? (all ? data.questions : worth) : [];
  const n = (v: number) => formatNumber(v, language);
  const showNone = data ? data.questions.some((q) => (q.none?.count ?? 0) > 0) : false;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="health-title">
      <Stack spacing={2}>
        <Typography variant="h2" id="health-title">
          {t("health.title")}
        </Typography>
        <Typography color="text.secondary">{t("health.explain")}</Typography>
        {!data && loading && <Loading />}
        {busy && (
          <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={reload}>{t("common.retry")}</Button>}>
            {t("quality.busy")}
          </Alert>
        )}
        {error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />}
        {data && (
          <Box sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                <span aria-live="polite">{t("health.count", { plots: n(data.plots), checked: n(data.plotsChecked), decided: n(data.decidedForCheck) })}</span>
                {data.computedAt !== null && ` ${t(data.stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.computedAt, language) })}`}
              </Typography>
              {data.questions.length === 0 ? (
                <Typography>{t("health.noData")}</Typography>
              ) : (
                <>
                  {worth.length === 0 && <Typography>{t("health.none")}</Typography>}
                  {shown.length > 0 && (
                    <TableContainer sx={tableFrame} id="health-table">
                      <Table size="small" stickyHeader aria-labelledby="health-title">
                        <TableHead>
                          <TableRow>
                            <TableCell>{t("health.colQuestion")}</TableCell>
                            <TableCell>{t("health.colReasons")}</TableCell>
                            <TableCell>{t("health.colEmpty")}</TableCell>
                            <TableCell>{t("health.colOther")}</TableCell>
                            {showNone && <TableCell>{t("health.colNone")}</TableCell>}
                            <TableCell>{t("health.colAgreement")}</TableCell>
                            <TableCell>{t("health.colChanged")}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {shown.map((row) => (
                            <Row key={row.key} row={row} data={data} showNone={showNone} />
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                  {data.questions.length > worth.length && (
                    <Box>
                      <Button size="small" onClick={() => setAll(!all)} aria-expanded={all} aria-controls={shown.length > 0 ? "health-table" : undefined}>
                        {all ? t("health.showFewer") : t("health.showAll", { n: n(data.questions.length) })}
                      </Button>
                    </Box>
                  )}
                  {data.questionsTotal > data.questions.length && (
                    <Typography variant="body2" color="text.secondary">
                      {t("health.capped", { n: n(data.questions.length), total: n(data.questionsTotal) })}
                    </Typography>
                  )}
                </>
              )}
              <Box component="details">
                <Typography component="summary" variant="body2" sx={{ cursor: "pointer", fontWeight: 500 }}>
                  {t("health.notesTitle")}
                </Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {(["health.noteEmpty", "health.noteOther", "health.noteAgreement", "health.noteChanged"] as const).map((k) => (
                    <Typography key={k} variant="body2" color="text.secondary">
                      {t(k)}
                    </Typography>
                  ))}
                  <Typography variant="body2" color="text.secondary">
                    {orderText(t, data, language)}
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
