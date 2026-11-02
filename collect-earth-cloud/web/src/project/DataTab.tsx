import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Download from "@mui/icons-material/Download";
import { useState } from "react";
import { downloadExport, getOverview } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import type { ProjectTab } from "../router";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";
import { CollectBackup } from "./CollectBackup";

/** The comparison of first assessments and checks moved to the Quality tab: a pointer to it. */
function QualityCheck({ onGo }: { onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("data.checkTitle")}</Typography>
        <Typography color="text.secondary">{t("data.checkMoved")}</Typography>
        <Box>
          <Button variant="outlined" endIcon={<ArrowForward />} onClick={() => onGo("quality")}>
            {t("data.checkOpen")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

export function DataTab({ projectId, onGo }: { projectId: string; onGo: (tab: ProjectTab) => void }) {
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
      <CollectBackup projectId={projectId} />
      <QualityCheck onGo={onGo} />
    </Stack>
  );
}
