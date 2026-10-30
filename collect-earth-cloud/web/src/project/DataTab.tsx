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
import Download from "@mui/icons-material/Download";
import { useState } from "react";
import { downloadExport, getOverlap, getOverview } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";

/** Plots submitted by two or more people, and where their answers differ. */
function QualityCheck({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const report = useLoad(() => getOverlap(projectId), [projectId]);
  const data = report.data;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("data.checkTitle")}</Typography>
        <Typography color="text.secondary">{t("data.checkExplain")}</Typography>
        {report.loading && !data ? (
          <Loading />
        ) : report.error || !data ? (
          <ErrorAlert error={report.error} onRetry={report.reload} />
        ) : data.plots === 0 ? (
          <Alert severity="info">{t("data.checkNone")}</Alert>
        ) : (
          <>
            <Typography>
              {t("data.checkSummary", { plots: formatNumber(data.plots, language), differing: formatNumber(data.differing, language) })}
            </Typography>
            {data.items.length > 0 && (
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 520 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("data.checkPlot")}</TableCell>
                      <TableCell>{t("data.checkPeople")}</TableCell>
                      <TableCell>{t("data.checkDifferences")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.recordKey} sx={{ verticalAlign: "top" }}>
                        <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                          {item.recordKey}
                        </TableCell>
                        <TableCell sx={{ wordBreak: "break-word" }}>{item.operators.join(", ")}</TableCell>
                        <TableCell sx={{ wordBreak: "break-word" }}>
                          {item.fields.map((field) => (
                            <Box key={field.key} sx={{ mb: 0.5 }}>
                              <strong>{field.key}:</strong>{" "}
                              {item.operators
                                .filter((who) => who in field.values)
                                .map((who) => `${who}: ${field.values[who]}`)
                                .join(" · ")}
                            </Box>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {data.items.length < data.differing && (
              <Typography variant="body2" color="text.secondary">
                {t("data.checkMore", { count: formatNumber(data.items.length, language) })}
              </Typography>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}

export function DataTab({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const overview = useLoad(() => getOverview(projectId), [projectId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const { blob, filename } = await downloadExport(projectId);
      saveBlob(blob, filename);
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const records = overview.data?.records;
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h2">{t("data.title")}</Typography>
          <Typography color="text.secondary">{t("data.explain")}</Typography>
          {overview.loading && !overview.data ? (
            <Loading />
          ) : overview.error ? (
            <ErrorAlert error={overview.error} onRetry={overview.reload} />
          ) : records && records.total === 0 ? (
            <Alert severity="info">{t("data.empty")}</Alert>
          ) : records ? (
            <Typography>
              {t("data.summary", { submitted: formatNumber(records.submitted, language), total: formatNumber(records.total, language) })}
            </Typography>
          ) : null}
          <Box>
            <Button variant="contained" size="large" startIcon={<Download />} onClick={download} disabled={busy}>
              {busy ? t("data.downloading") : t("data.download")}
            </Button>
          </Box>
          {done && (
            <Alert severity="success" role="status">
              {t("data.downloaded")}
            </Alert>
          )}
          <ErrorAlert error={error} />
        </Stack>
      </Paper>
      <QualityCheck projectId={projectId} />
    </Stack>
  );
}
