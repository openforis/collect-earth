import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useState } from "react";
import { getBackupLink, getBackupSummary, type BackupCounts, type BackupRounds, type BackupSummary } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatBytes, formatNumber } from "../format";
import { useT } from "../i18n";
import { downloadUrl } from "../saveBlob";
import { useLoad } from "../useLoad";

/**
 * The Collect Earth backup on the Data tab (Task 17): the survey and the records in a zip that
 * Collect Earth imports, the first assessments or every round. The dialog says what the file will
 * hold; the browser then downloads it by itself from a one-use link, with its own progress.
 */
export function CollectBackup({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("backup.title")}</Typography>
        <Typography color="text.secondary">{t("backup.explain")}</Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={() => {
              setStarted(false);
              setOpen(true);
            }}
          >
            {t("backup.open")}
          </Button>
        </Box>
        {started && (
          <Alert severity="success" role="status">
            {t("backup.started")}
          </Alert>
        )}
      </Stack>
      {open && (
        <BackupDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onStarted={() => {
            setOpen(false);
            setStarted(true);
          }}
        />
      )}
    </Paper>
  );
}

function BackupDialog({ projectId, onClose, onStarted }: { projectId: string; onClose: () => void; onStarted: () => void }) {
  const t = useT();
  const summary = useLoad(() => getBackupSummary(projectId), [projectId]);
  const [rounds, setRounds] = useState<BackupRounds>("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const s = summary.data;
  const counts = s ? (rounds === "all" && s.all ? s.all : s.first) : null;
  const canDownload = !!s && s.projectFile && !!counts && counts.records > 0 && !busy;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await getBackupLink(projectId, rounds);
      downloadUrl(url);
      onStarted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="backup-title">
      <DialogTitle id="backup-title">{t("backup.dialogTitle")}</DialogTitle>
      <DialogContent>
        {summary.loading && !s ? (
          <Loading />
        ) : summary.error ? (
          <ErrorAlert error={summary.error} onRetry={summary.reload} />
        ) : s ? (
          <BackupChoice summary={s} counts={counts!} rounds={rounds} onRounds={setRounds} busy={busy} />
        ) : null}
        <ErrorAlert error={error} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.close")}</Button>
        <Button variant="contained" startIcon={<Download />} onClick={() => void download()} disabled={!canDownload}>
          {busy ? t("backup.downloading") : t("backup.download")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BackupChoice({
  summary,
  counts,
  rounds,
  onRounds,
  busy,
}: {
  summary: BackupSummary;
  counts: BackupCounts;
  rounds: BackupRounds;
  onRounds: (rounds: BackupRounds) => void;
  busy: boolean;
}) {
  const t = useT();
  const { language } = useApp();
  const n = (value: number) => formatNumber(value, language);
  if (!summary.projectFile) return <Alert severity="info">{t("backup.noProjectFile")}</Alert>;
  return (
    <Stack spacing={2}>
      <FormControl disabled={busy}>
        <FormLabel id="backup-rounds">{t("backup.which")}</FormLabel>
        <RadioGroup aria-labelledby="backup-rounds" value={rounds} onChange={(e) => onRounds(e.target.value as BackupRounds)}>
          <FormControlLabel
            value="1"
            control={<Radio slotProps={{ input: { "aria-describedby": "backup-first-help" } }} />}
            label={
              <Box>
                <Typography>{t("backup.first")}</Typography>
                <Typography variant="body2" color="text.secondary" id="backup-first-help">
                  {t("backup.firstHelp")}
                  {summary.firstCodes && summary.firstCodes.length > 0 && ` ${t("backup.firstCodes", { codes: summary.firstCodes.join(", ") })}`}
                </Typography>
              </Box>
            }
            sx={{ alignItems: "flex-start", mb: 1, "& .MuiRadio-root": { pt: 0.5 } }}
          />
          <FormControlLabel
            value="all"
            control={<Radio slotProps={{ input: { "aria-describedby": summary.roundKey ? "backup-all-help" : "backup-all-help backup-no-round-key" } }} />}
            disabled={!summary.roundKey}
            label={
              <Box>
                <Typography>{t("backup.all")}</Typography>
                <Typography variant="body2" color="text.secondary" id="backup-all-help">
                  {t("backup.allHelp")}
                </Typography>
              </Box>
            }
            sx={{ alignItems: "flex-start", "& .MuiRadio-root": { pt: 0.5 } }}
          />
        </RadioGroup>
      </FormControl>
      {!summary.roundKey && (
        <Alert severity="warning" id="backup-no-round-key">
          {t("backup.noRoundKey")}
        </Alert>
      )}
      {counts.records === 0 ? (
        <Alert severity="info">{t("backup.none")}</Alert>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.5 } }} aria-live="polite">
          <li>
            {t("backup.records", { count: n(counts.records) })} {t("backup.size", { size: formatBytes(counts.estimatedBytes, language) })}
          </li>
          {counts.drafts > 0 && <li>{t("backup.drafts", { count: n(counts.drafts) })}</li>}
          {rounds === "1" && counts.otherRounds > 0 && <li>{t("backup.otherRounds", { count: n(counts.otherRounds) })}</li>}
          {counts.measurements > 0 && <li>{t("backup.measurements", { count: n(counts.measurements) })}</li>}
          {counts.sameKey > 0 && <li>{t("backup.sameKey", { count: n(counts.sameKey), examples: counts.sameKeyExamples.slice(0, 3).join(", ") })}</li>}
          {counts.noXml > 0 && <li>{t("backup.noXml", { count: n(counts.noXml) })}</li>}
          {summary.note && <li>{t("backup.note")}</li>}
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {t("backup.howTo")} {t("backup.clientMode")}
      </Typography>
    </Stack>
  );
}
