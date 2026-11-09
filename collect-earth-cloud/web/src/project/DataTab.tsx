import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Download from "@mui/icons-material/Download";
import PivotTableChart from "@mui/icons-material/PivotTableChart";
import { useState } from "react";
import { downloadExport, EXPORT_FORMATS, getOverview, listMembers, type ExportFormat } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { dataSections } from "../localMode";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";
import { CollectBackup } from "./CollectBackup";

const FORMAT_LABELS = { csv: "data.formatCsv", geojson: "data.formatGeojson", kml: "data.formatKml", "shp.zip": "data.formatShp" } as const;

/** The pivot table and charts over the collected data (what replaces Saiku), on a page of its own. */
function Analysis({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("analysis.title")}</Typography>
        <Typography color="text.secondary">{t("analysis.cardText")}</Typography>
        <Box>
          <Button variant="contained" size="large" startIcon={<PivotTableChart />} {...linkProps(pathFor({ name: "analysis", projectId }))}>
            {t("analysis.open")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

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
  // The local mode (one person): the data download only (src/localMode.ts, dataSections).
  const local = useLocalMode();
  const sections = dataSections(local);
  const overview = useLoad(() => getOverview(projectId), [projectId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("csv");
  // People left out of the results: their records are not in the download unless asked for.
  const excluded = useLoad(() => (local ? Promise.resolve([]) : listMembers(projectId).then((ms) => ms.filter((m) => m.excluded))), [projectId, local]);
  const [includeExcluded, setIncludeExcluded] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const { blob, filename } = await downloadExport(projectId, format, includeExcluded);
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
      <Analysis projectId={projectId} />
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h2">{t("data.title")}</Typography>
          <Typography color="text.secondary">{t(local ? "data.explainLocal" : "data.explain")}</Typography>
          {overview.loading && !overview.data ? (
            <Loading />
          ) : overview.error ? (
            <ErrorAlert error={overview.error} onRetry={overview.reload} />
          ) : records && records.total === 0 ? (
            <Alert severity="info">{t(local ? "data.emptyLocal" : "data.empty")}</Alert>
          ) : records ? (
            <Typography>
              {t("data.summary", { submitted: formatNumber(records.submitted, language), total: formatNumber(records.total, language) })}
            </Typography>
          ) : null}
          {(excluded.data?.length ?? 0) > 0 && (
            <FormControlLabel
              control={<Checkbox checked={includeExcluded} onChange={(e) => setIncludeExcluded(e.target.checked)} />}
              label={t("data.includeExcluded", { names: (excluded.data ?? []).map((m) => m.username).join(", ") })}
            />
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
            <TextField select size="small" label={t("data.format")} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} sx={{ minWidth: 240 }}>
              {EXPORT_FORMATS.map((f) => (
                <MenuItem key={f} value={f}>
                  {t(FORMAT_LABELS[f])}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Button variant="contained" size="large" startIcon={<Download />} onClick={download} disabled={busy}>
                {busy ? t("data.downloading") : t("data.download")}
              </Button>
            </Box>
          </Stack>
          {format !== "csv" && (
            <Typography variant="body2" color="text.secondary">
              {t("data.formatHint")}
            </Typography>
          )}
          {done && (
            <Alert severity="success" role="status">
              {t("data.downloaded")}
            </Alert>
          )}
          <ErrorAlert error={error} />
        </Stack>
      </Paper>
      {sections.includes("backup") && <CollectBackup projectId={projectId} />}
      {sections.includes("qualityCheck") && <QualityCheck onGo={onGo} />}
    </Stack>
  );
}
