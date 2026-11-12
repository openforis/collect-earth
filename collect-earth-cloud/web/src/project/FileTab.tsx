import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
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
import { ApiError, cepGridFiles, downloadOriginalCep, getOverview, getRoundInfo, listCsvFiles, mergeGridFiles, setReassessmentCode, uploadCep, uploadCsvFile, type RoundInfo } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain, MoreInfo } from "../components/Explain";
import { FileDrop } from "../components/FileDrop";
import { Loading } from "../components/Loading";
import { formatBytes, formatDate } from "../format";
import { CATALOGUES, useT, type MessageKey } from "../i18n";
import { PlotLayoutCard } from "./PlotLayoutCard";
import { noteMessage, originalFileName, roundCodeLabel, roundMessage } from "../roundText";
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
        <FormHelperText>
          {t("file.round.whichHelp.short")}
          <MoreInfo text={t("file.round.whichHelp")} />
        </FormHelperText>
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

/** One sentence of the round and note messages: its short form with the full one in a tip, when it has one. */
function RoundSentence({ messageKey, first }: { messageKey: MessageKey; first: boolean }) {
  const t = useT();
  const shortKey = `${messageKey}.short`;
  const short = Object.hasOwn(CATALOGUES.en, shortKey) ? (shortKey as MessageKey) : null;
  return (
    <Typography variant="body2" sx={{ mt: first ? 0 : 1 }}>
      {t(short ?? messageKey)}
      {short && <MoreInfo text={t(messageKey)} />}
    </Typography>
  );
}

/** What the server did about round in the current project file. */
function RoundStatus({ projectId, projectName, info, onChange }: { projectId: string; projectName: string; info: RoundInfo; onChange: (info: RoundInfo) => void }) {
  const t = useT();
  const message = roundMessage(info);
  const note = noteMessage(info);
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
            <RoundSentence key={key} messageKey={key} first={i === 0} />
          ))}
        </Alert>
        {note && (
          <Alert severity={note.severity} data-testid="file-note">
            {note.keys.map((key, i) => (
              <RoundSentence key={key} messageKey={key} first={i === 0} />
            ))}
          </Alert>
        )}
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
  // The plot files of the project file's grid folder: how many were added, and which were refused (and why).
  const [grid, setGrid] = useState<{ added: number; failed: { name: string; reason: string }[] } | null>(null);
  // Several new grid files wait for the coordinator's choice: one merged plot file, or each on its own.
  const [pendingGrid, setPendingGrid] = useState<{ files: File[]; mergedName: string } | null>(null);
  const [gridProgress, setGridProgress] = useState<{ done: number; total: number } | null>(null);

  const addPlotFiles = async (files: File[]) => {
    const result = { added: 0, failed: [] as { name: string; reason: string }[] };
    setGridProgress({ done: 0, total: files.length });
    for (const file of files) {
      try {
        await uploadCsvFile(projectId, file);
        result.added++;
      } catch (err) {
        result.failed.push({ name: file.name, reason: err instanceof ApiError ? err.reason ?? err.code : String(err) });
      }
      setGridProgress({ done: result.added + result.failed.length, total: files.length });
    }
    setGridProgress(null);
    setGrid(result);
  };

  // After the project file (its survey decides how plot files are read): the grid files the project lacks.
  // One of the same name is left alone, since replacing it could take plots away from people who hold them.
  const addGridFiles = async (cep: File) => {
    const existing = new Set((await listCsvFiles(projectId)).map((f) => f.filename));
    const mergedName = cep.name.replace(/\.cep$/i, ".csv");
    const files = (await cepGridFiles(cep)).filter((f) => !existing.has(f.name));
    if (files.length === 1) await addPlotFiles(files);
    else if (files.length > 1 && !existing.has(mergedName)) setPendingGrid({ files, mergedName });
  };

  const chooseGrid = async (merge: boolean) => {
    if (!pendingGrid) return;
    const { files, mergedName } = pendingGrid;
    setPendingGrid(null);
    try {
      if (!merge) return await addPlotFiles(files);
      const { merged, separate } = await mergeGridFiles(files, mergedName);
      await addPlotFiles(merged ? [merged, ...separate] : separate);
    } catch (err) {
      setGridProgress(null);
      setError(err);
    }
  };

  const upload = async ([file]: File[]) => {
    setError(null);
    setUploaded(false);
    setGrid(null);
    setPendingGrid(null);
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
      await addGridFiles(file);
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
        <Explain sx={{ mb: 2 }} text={t("file.explain.short")} more={t("file.explain")} />
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

      {/* Read again after an upload: the new file brings its own layout. */}
      {cep && <PlotLayoutCard key={uploads} projectId={projectId} />}

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
          {t("file.uploaded.short")}
          <MoreInfo text={t("file.uploaded")} />
        </Alert>
      )}
      {/* No close on Escape or outside clicks: the grid files wait for one of the two answers. */}
      <Dialog open={pendingGrid !== null} aria-labelledby="grid-choice" maxWidth="sm" fullWidth>
        <DialogContent>
          <Typography id="grid-choice">
            {pendingGrid && t("file.gridChoice", { count: pendingGrid.files.length, name: pendingGrid.mergedName })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 3, pb: 2 }}>
          <Button variant="outlined" onClick={() => void chooseGrid(false)}>
            {t("file.gridSeparate", { count: pendingGrid?.files.length ?? 0 })}
          </Button>
          <Button variant="contained" autoFocus onClick={() => void chooseGrid(true)}>
            {t("file.gridMerge")}
          </Button>
        </DialogActions>
      </Dialog>
      {gridProgress && (
        <Typography role="status">{t("file.gridAdding", { done: gridProgress.done, total: gridProgress.total })}</Typography>
      )}
      {grid && grid.added > 0 && (
        <Alert severity="success" role="status">
          {t("file.gridAdded", { count: grid.added })}
        </Alert>
      )}
      {grid && grid.failed.length > 0 && (
        <Alert severity="warning" role="alert">
          {t("file.gridFailed")}
          <ul>
            {grid.failed.map((f) => (
              <li key={f.name}>
                {f.name}: {f.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <ErrorAlert error={error} />
    </Stack>
  );
}
