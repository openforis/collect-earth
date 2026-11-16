import { useState } from "react";
import { Box, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { getAnalysisSummary } from "../../api";
import { ApiError } from "../../api";
import { questionLabel, summaryTable } from "../../analysisSummaryView";
import { formatNumber } from "../../format";
import { useT } from "../../i18n";
import { useLoad } from "../../useLoad";
import { EmptyState } from "../EmptyState";
import { ErrorAlert } from "../ErrorAlert";
import { Loading } from "../Loading";

const NONE = "__none";

/**
 * A reviewer's analysis: the plots of the whole project counted by one question, or by two, on the server. No row per
 * plot reaches the page (the pivot of the coordinators' page works on such rows), and nobody is named.
 */
export function TeamSummary({ projectId, language }: { projectId: string; language: string }) {
  const t = useT();
  const [row, setRow] = useState<string | null>(null);
  const [column, setColumn] = useState<string | null>(null);
  const summary = useLoad(["project", projectId, "getAnalysisSummary", row, column], () => getAnalysisSummary(projectId, row, column));
  const data = summary.data;
  if (summary.error && !data) {
    return summary.error instanceof ApiError && summary.error.status === 404 ? (
      <Paper variant="outlined">
        <EmptyState heading title={t("analysis.noProjectFile")} />
      </Paper>
    ) : (
      <ErrorAlert error={summary.error} onRetry={summary.reload} />
    );
  }
  if (!data) return <Loading />;
  const table = summaryTable(data, language, { yes: t("common.yes"), no: t("common.no"), none: t("analysis.noAnswer") });
  const share = (n: number, of: number) => (of > 0 ? `${formatNumber(Math.round((n / of) * 1000) / 10, language)} %` : "");
  const area = (n: number | null) => (n === null ? "" : formatNumber(Math.round(n * 100) / 100, language));
  const pick = (label: string, value: string | null, onChange: (v: string | null) => void, optional: boolean, without: string | null) => (
    <TextField select size="small" label={label} value={value ?? NONE} onChange={(e) => onChange(e.target.value === NONE ? null : e.target.value)} sx={{ minWidth: 260 }}>
      <MenuItem value={NONE}>{optional ? t("analysis.summary.noSecond") : t("analysis.summary.choose")}</MenuItem>
      {data.questions
        .filter((q) => q.name !== without)
        .map((q) => (
          <MenuItem key={q.name} value={q.name}>
            {questionLabel(data, q.name, language)}
          </MenuItem>
        ))}
    </TextField>
  );
  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">{t("analysis.summary.explain")}</Typography>
      {data.questions.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState heading title={t("analysis.summary.noQuestions")} />
        </Paper>
      ) : (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          {pick(t("analysis.summary.row"), row, (v) => { setRow(v); if (v === null || v === column) setColumn(null); }, false, null)}
          {row !== null && pick(t("analysis.summary.column"), column, setColumn, true, row)}
        </Stack>
      )}
      {table && table.plots === 0 && (
        <Paper variant="outlined">
          <EmptyState heading title={t("analysis.empty")} />
        </Paper>
      )}
      {table && table.plots > 0 && (
        <Box sx={{ opacity: summary.loading ? 0.6 : 1 }} aria-busy={summary.loading}>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label={t("analysis.title")}>
              <TableHead>
                <TableRow>
                  <TableCell>{questionLabel(data, data.row!, language)}</TableCell>
                  {table.columns.map((c) => (
                    <TableCell key={c.code} align="right">
                      {c.label}
                    </TableCell>
                  ))}
                  <TableCell align="right">{t("analysis.m.plots")}</TableCell>
                  <TableCell align="right">{t("analysis.summary.share")}</TableCell>
                  {table.area !== null && <TableCell align="right">{t("analysis.m.area")}</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {table.rows.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell component="th" scope="row">
                      {r.label}
                    </TableCell>
                    {r.cells.map((n, i) => (
                      <TableCell key={table.columns[i].code} align="right">
                        {n === 0 ? "" : formatNumber(n, language)}
                      </TableCell>
                    ))}
                    <TableCell align="right">{formatNumber(r.plots, language)}</TableCell>
                    <TableCell align="right">{share(r.plots, table.plots)}</TableCell>
                    {table.area !== null && <TableCell align="right">{area(r.area)}</TableCell>}
                  </TableRow>
                ))}
                <TableRow sx={{ "& td, & th": { fontWeight: 600 } }}>
                  <TableCell component="th" scope="row">
                    {t("analysis.summary.total")}
                  </TableCell>
                  {table.columns.map((c, i) => (
                    <TableCell key={c.code} align="right">
                      {formatNumber(table.rows.reduce((sum, r) => sum + r.cells[i], 0), language)}
                    </TableCell>
                  ))}
                  <TableCell align="right">{formatNumber(table.plots, language)}</TableCell>
                  <TableCell />
                  {table.area !== null && <TableCell align="right">{area(table.area)}</TableCell>}
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Stack>
  );
}
