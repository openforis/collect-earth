import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import { useState } from "react";
import { getOverview, uploadCep } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { Loading } from "../components/Loading";
import { formatBytes, formatDate } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

export function FileTab({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const overview = useLoad(() => getOverview(projectId), [projectId]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [wrongType, setWrongType] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const upload = async ([file]: File[]) => {
    setError(null);
    setUploaded(false);
    setWrongType(!file.name.toLowerCase().endsWith(".cep"));
    if (!file.name.toLowerCase().endsWith(".cep")) return;
    setProgress(0);
    try {
      await uploadCep(projectId, file, setProgress);
      setUploaded(true);
      overview.reload();
    } catch (err) {
      setError(err);
    } finally {
      setProgress(null);
    }
  };

  const cep = overview.data?.cep ?? null;

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("file.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("file.explain")}
        </Typography>
        {overview.loading && !overview.data ? (
          <Loading />
        ) : overview.error ? (
          <ErrorAlert error={overview.error} onRetry={overview.reload} />
        ) : cep ? (
          <Alert severity="success" icon={<InsertDriveFile />}>
            {cep.updatedAt !== null
              ? t("file.current", { size: formatBytes(cep.bytes, language), date: formatDate(cep.updatedAt, language) })
              : t("file.currentNoDate", { size: formatBytes(cep.bytes, language) })}
          </Alert>
        ) : (
          <Alert severity="info">{t("file.none")}</Alert>
        )}
      </Paper>

      <FileDrop
        label={t("file.drop")}
        buttonLabel={cep ? t("file.chooseNew") : t("file.choose")}
        accept=".cep"
        disabled={progress !== null}
        onFiles={upload}
      />
      {progress !== null && (
        <div>
          <Typography sx={{ mb: 1 }} role="status">
            {t("file.uploading", { pct: Math.round(progress * 100) })}
          </Typography>
          <LinearProgress variant="determinate" value={progress * 100} aria-label={t("file.uploading", { pct: Math.round(progress * 100) })} />
        </div>
      )}
      {wrongType && <Alert severity="warning" role="alert">{t("file.wrongType")}</Alert>}
      {uploaded && (
        <Alert severity="success" role="status">
          {t("file.uploaded")}
        </Alert>
      )}
      <ErrorAlert error={error} />
    </Stack>
  );
}
