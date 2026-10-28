import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useState } from "react";
import { downloadExport, getOverview } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  );
}
