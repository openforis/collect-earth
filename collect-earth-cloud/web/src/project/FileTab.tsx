import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import { useState } from "react";
import { downloadOriginalCep, getOverview, getRoundInfo, setReassessmentCode, uploadCep, type RoundInfo } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { Loading } from "../components/Loading";
import { formatBytes, formatDate } from "../format";
import { useT } from "../i18n";
import { originalFileName, roundCodeLabel, roundMessage } from "../roundText";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";

/** The Select's value for "None" (a code is never empty). */
const NO_CODE = "";

/** Which code of the survey's own round marks a re-assessment. */
function ReassessmentChoice({ projectId, info, onSaved }: { projectId: string; info: RoundInfo; onSaved: (info: RoundInfo) => void }) {
  const t = useT();
  const [code, setCode] = useState(info.reassessmentCode ?? NO_CODE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const unchanged = code === (info.reassessmentCode ?? NO_CODE);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await setReassessmentCode(projectId, code === NO_CODE ? null : code);
      onSaved(result ?? { ...info, reassessmentCode: code === NO_CODE ? null : code });
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <FormControl fullWidth>
        <InputLabel id="reassessment-code" shrink>{t("file.round.which")}</InputLabel>
        <Select
          labelId="reassessment-code"
          label={t("file.round.which")}
          value={code}
          displayEmpty
          notched
          onChange={(e) => {
            setCode(e.target.value);
            setSaved(false);
          }}
        >
          {info.roundCodes.map((c) => (
            <MenuItem key={c.code} value={c.code}>
              {roundCodeLabel(c)}
            </MenuItem>
          ))}
          <MenuItem value={NO_CODE} sx={{ whiteSpace: "normal" }}>
            {t("file.round.noneOption")}
          </MenuItem>
        </Select>
        <FormHelperText>{t("file.round.whichHelp")}</FormHelperText>
      </FormControl>
      <ErrorAlert error={error} />
      {saved && (
        <Alert severity="success" role="status">
          {t("file.round.saved")}
        </Alert>
      )}
      <Box>
        <Button variant="contained" onClick={save} disabled={busy || unchanged}>
          {t("common.save")}
        </Button>
      </Box>
    </Stack>
  );
}

/** What the server did about round in the current project file. */
function RoundStatus({ projectId, projectName, info, onChange }: { projectId: string; projectName: string; info: RoundInfo; onChange: (info: RoundInfo) => void }) {
  const t = useT();
  const message = roundMessage(info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      saveBlob(await downloadOriginalCep(projectId), originalFileName(projectName));
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("file.round.title")}</Typography>
        <Alert severity={message.severity}>
          {message.keys.map((key, i) => (
            <Typography key={key} variant="body2" sx={{ mt: i === 0 ? 0 : 1 }}>
              {t(key)}
            </Typography>
          ))}
        </Alert>
        {message.download && (
          <Box>
            <Button variant="outlined" startIcon={<Download />} onClick={download} disabled={busy}>
              {t("file.round.downloadOriginal")}
            </Button>
          </Box>
        )}
        {done && (
          <Alert severity="success" role="status">
            {t("file.round.downloaded")}
          </Alert>
        )}
        <ErrorAlert error={error} />
        {message.choose && (
          <ReassessmentChoice projectId={projectId} info={info} onSaved={onChange} />
        )}
      </Stack>
    </Paper>
  );
}

export function FileTab({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const overview = useLoad(() => getOverview(projectId), [projectId]);
  const round = useLoad(() => getRoundInfo(projectId), [projectId]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [wrongType, setWrongType] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  // Counts uploads, so the round section starts again from what the server says about the new file.
  const [uploads, setUploads] = useState(0);

  const upload = async ([file]: File[]) => {
    setError(null);
    setUploaded(false);
    setWrongType(!file.name.toLowerCase().endsWith(".cep"));
    if (!file.name.toLowerCase().endsWith(".cep")) return;
    setProgress(0);
    try {
      const info = await uploadCep(projectId, file, setProgress);
      setUploaded(true);
      setUploads((n) => n + 1);
      overview.reload();
      if (info) round.setData(info);
      else round.reload();
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

      {round.error ? (
        <ErrorAlert error={round.error} onRetry={round.reload} />
      ) : round.data ? (
        <RoundStatus key={uploads} projectId={projectId} projectName={overview.data?.name ?? ""} info={round.data} onChange={round.setData} />
      ) : null}

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
