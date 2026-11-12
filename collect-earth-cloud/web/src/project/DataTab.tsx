import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import PivotTableChart from "@mui/icons-material/PivotTableChart";
import { useState } from "react";
import { dayStartMs } from "../activityView";
import { labelIn } from "../analysisView";
import { downloadExport, EXPORT_FORMATS, getExportChoices, getOverview, listMembers, type ExportFormat, type ExportRecords } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain, MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { dataSections } from "../localMode";
import { linkProps, pathFor } from "../router";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";
import { CollectBackup } from "./CollectBackup";
import { CollectImport } from "./CollectImport";
import { ChangeCard } from "./RepeatSurvey";
import { IpccExports } from "./IpccExports";

const FORMAT_LABELS = { csv: "data.formatCsv", geojson: "data.formatGeojson", kml: "data.formatKml", "shp.zip": "data.formatShp" } as const;
const RECORDS_LABELS = { all: "data.records.all", last: "data.records.last", date: "data.records.date", answer: "data.records.answer" } as const;
type RecordsChoice = keyof typeof RECORDS_LABELS;

/** The pivot table and charts over the collected data (what replaces Saiku), on a page of its own. */
function Analysis({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("analysis.title")}</Typography>
        <Explain text={t("analysis.cardText.short")} more={t("analysis.cardText")} />
        <Box>
          <Button variant="contained" size="large" startIcon={<PivotTableChart />} {...linkProps(pathFor({ name: "analysis", projectId }))}>
            {t("analysis.open")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

export function DataTab({ projectId }: { projectId: string }) {
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
  const [noPositions, setNoPositions] = useState(false);
  // People left out of the results: their records are not in the download unless asked for.
  const excluded = useLoad(() => (local ? Promise.resolve([]) : listMembers(projectId).then((ms) => ms.filter((m) => m.excluded))), [projectId, local]);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [labels, setLabels] = useState(false);
  // Records to download: your last download and the survey's questions come from the server.
  const choices = useLoad(() => getExportChoices(projectId), [projectId]);
  const [which, setWhich] = useState<RecordsChoice>("all");
  const [from, setFrom] = useState("");
  const [questionKey, setQuestionKey] = useState("");
  const [value, setValue] = useState("");
  const question = choices.data?.questions.find((q) => q.key === questionKey);
  const chosen: ExportRecords | null =
    which === "date" ? (from ? { kind: "date", since: dayStartMs(from) } : null)
    : which === "answer" ? (question && value.trim() ? { kind: "answer", question: question.key, value: value.trim() } : null)
    : { kind: which };

  const download = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const { blob, filename } = await downloadExport(projectId, format, { language, withoutPositions: noPositions, includeExcluded, labels, records: chosen });
      saveBlob(blob, filename);
      setDone(true);
      choices.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const lastDownload = choices.data?.lastDownload ?? null;

  const records = overview.data?.records;
  return (
    <Stack spacing={3}>
      <Analysis projectId={projectId} />
      {/* A repeat survey: how the land changed since the earlier period (docs/plans/2026-11-11-repeat-survey.md) */}
      {!local && <ChangeCard projectId={projectId} />}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h2">{t("data.title")}</Typography>
          <Typography color="text.secondary">
            {t(local ? "data.explainLocal" : "data.explain")}
            {!local && <MoreInfo text={t("data.explain.more")} />}
          </Typography>
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
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }} useFlexGap>
            <TextField select size="small" label={t("data.records")} value={which} onChange={(e) => setWhich(e.target.value as RecordsChoice)} sx={{ minWidth: 240 }}>
              {(Object.keys(RECORDS_LABELS) as RecordsChoice[]).map((c) => (
                // the last download and the questions are known once the choices are read; no survey, no question
                <MenuItem key={c} value={c} disabled={(c === "last" && !choices.data) || (c === "answer" && !choices.data?.questions.length)}>
                  {c === "last" && lastDownload === null ? t("data.records.lastNone") : t(RECORDS_LABELS[c], { date: formatDate(lastDownload, language) })}
                </MenuItem>
              ))}
            </TextField>
            {which === "date" && (
              <TextField type="date" size="small" label={t("data.records.from")} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            )}
            {which === "answer" && choices.data && (
              <>
                <TextField
                  select
                  size="small"
                  label={t("data.records.question")}
                  value={questionKey}
                  onChange={(e) => {
                    setQuestionKey(e.target.value);
                    setValue("");
                  }}
                  sx={{ minWidth: 240 }}
                >
                  {choices.data.questions.map((q) => (
                    <MenuItem key={q.key} value={q.key}>
                      {labelIn(q.labels, language, choices.data!, q.name)}
                    </MenuItem>
                  ))}
                </TextField>
                {question?.list ? (
                  <TextField select size="small" label={t("data.records.value")} value={value} onChange={(e) => setValue(e.target.value)} sx={{ minWidth: 200 }}>
                    {(choices.data.lists[question.list] ?? []).map((i) => (
                      <MenuItem key={i.code} value={i.code}>
                        {labelIn(i.labels, language, choices.data!, i.code)}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  question && <TextField size="small" label={t("data.records.value")} value={value} onChange={(e) => setValue(e.target.value)} />
                )}
              </>
            )}
          </Stack>
          <Box>
            <FormControlLabel control={<Checkbox checked={labels} onChange={(e) => setLabels(e.target.checked)} />} label={t("data.labels")} />
            <Typography variant="body2" color="text.secondary">
              {t("data.labelsHelp")}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
            <TextField select size="small" label={t("data.format")} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} sx={{ minWidth: 240 }}>
              {EXPORT_FORMATS.map((f) => (
                <MenuItem key={f} value={f}>
                  {t(FORMAT_LABELS[f])}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Button variant="contained" size="large" startIcon={<Download />} onClick={download} disabled={busy || !chosen}>
                {busy ? t("data.downloading") : t("data.download")}
              </Button>
            </Box>
          </Stack>
          {format === "csv" ? (
            <Box>
              <FormControlLabel control={<Checkbox checked={noPositions} onChange={(e) => setNoPositions(e.target.checked)} />} label={t("data.noPositions")} />
              <Typography variant="body2" color="text.secondary">
                {t("data.noPositionsHelp")}
              </Typography>
            </Box>
          ) : (
            <Explain variant="body2" text={t("data.formatHint.short")} more={t("data.formatHint")} />
          )}
          {done && (
            <Alert severity="success" role="status">
              {t("data.downloaded")}
            </Alert>
          )}
          <ErrorAlert error={error} />
        </Stack>
      </Paper>
      {sections.includes("ipcc") && <IpccExports projectId={projectId} />}
      {sections.includes("backup") && <CollectBackup projectId={projectId} />}
      {sections.includes("import") && <CollectImport projectId={projectId} />}
    </Stack>
  );
}
