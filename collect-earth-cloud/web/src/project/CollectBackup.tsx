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
import { downloadCollectBackup, getBackupSummary, type BackupCounts, type BackupRounds, type BackupSummary } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";

/**
 * The Collect Earth backup on the Data tab (Task 17): the survey and the records in a zip that
 * Collect Earth imports, round 1 only or every round. The dialog says what the file will hold.
 */
export function CollectBackup({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
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
              setDone(false);
              setOpen(true);
            }}
          >
            {t("backup.open")}
          </Button>
        </Box>
        {done && (
          <Alert severity="success" role="status">
            {t("backup.downloaded")}
          </Alert>
        )}
      </Stack>
      {open && (
        <BackupDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      )}
    </Paper>
  );
}

function BackupDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
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
      const { blob, filename } = await downloadCollectBackup(projectId, rounds);
      saveBlob(blob, filename);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm" aria-labelledby="backup-title">
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
        <Button onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
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
            control={<Radio />}
            label={
              <Box>
                <Typography>{t("backup.first")}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("backup.firstHelp")}
                </Typography>
              </Box>
            }
            sx={{ alignItems: "flex-start", mb: 1, "& .MuiRadio-root": { pt: 0.5 } }}
          />
          <FormControlLabel
            value="all"
            control={<Radio />}
            disabled={!summary.roundKey}
            label={
              <Box>
                <Typography>{t("backup.all")}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("backup.allHelp")}
                </Typography>
              </Box>
            }
            sx={{ alignItems: "flex-start", "& .MuiRadio-root": { pt: 0.5 } }}
          />
        </RadioGroup>
      </FormControl>
      {!summary.roundKey && <Alert severity="warning">{t("backup.noRoundKey")}</Alert>}
      {counts.records === 0 ? (
        <Alert severity="info">{t("backup.none")}</Alert>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.5 } }} aria-live="polite">
          <li>{t("backup.records", { count: n(counts.records) })}</li>
          {counts.drafts > 0 && <li>{t("backup.drafts", { count: n(counts.drafts) })}</li>}
          {rounds === "1" && counts.otherRounds > 0 && <li>{t("backup.otherRounds", { count: n(counts.otherRounds) })}</li>}
          {counts.sameKey > 0 && <li>{t("backup.sameKey", { count: n(counts.sameKey), examples: counts.sameKeyExamples.slice(0, 3).join(", ") })}</li>}
          {rounds === "all" && counts.reference > 0 && <li>{t("backup.reference", { count: n(counts.reference) })}</li>}
          {counts.sameKeyReference > 0 && <li>{t("backup.referenceSameKey", { count: n(counts.sameKeyReference) })}</li>}
          {summary.note && <li>{t("backup.note")}</li>}
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {t("backup.howTo")}
      </Typography>
    </Stack>
  );
}
