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
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useState } from "react";
import { getBackupLink, getBackupSummary, type BackupCounts, type BackupFormat, type BackupRounds, type BackupSummary } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { CardFrame } from "../components/FoldingCard";
import { Explain, MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatBytes, formatNumber } from "../format";
import { useT } from "../i18n";
import { downloadUrl } from "../saveBlob";
import { useLoad } from "../useLoad";

/**
 * The Collect Earth backup on the Data tab (Task 17): the survey and the records in a zip that
 * Collect Earth imports, or in OpenForis Collect's own backup (.collect-backup), the first assessments
 * or every round. The dialog says what the file will hold; the browser then downloads it by itself
 * from a one-use link, with its own progress.
 */
export function CollectBackup({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  return (
    <CardFrame title={t("backup.title")} fold={t("backup.explain.short")}>
      <Stack spacing={2}>
        <Explain text={t("backup.explain.short")} more={t("backup.explain")} />
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
    </CardFrame>
  );
}

function BackupDialog({ projectId, onClose, onStarted }: { projectId: string; onClose: () => void; onStarted: () => void }) {
  const t = useT();
  const summary = useLoad(["project", projectId, "getBackupSummary"], () => getBackupSummary(projectId));
  const [rounds, setRounds] = useState<BackupRounds>("1");
  const [format, setFormat] = useState<BackupFormat>("zip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const s = summary.data;
  const counts = s ? (rounds === "all" && s.rounds.all ? s.rounds.all : s.rounds["1"]) : null;
  const canDownload = !!s && s.projectFile && !!counts && counts.records > 0 && !busy;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await getBackupLink(projectId, rounds, format);
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
          <BackupChoice summary={s} counts={counts!} rounds={rounds} onRounds={setRounds} format={format} onFormat={setFormat} busy={busy} />
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

const FORMATS = [
  { value: "zip", label: "backup.format.zip", help: "backup.format.zipHelp" },
  { value: "collect", label: "backup.format.collect", help: "backup.format.collectHelp" },
] as const;

function BackupChoice({
  summary,
  counts,
  rounds,
  onRounds,
  format,
  onFormat,
  busy,
}: {
  summary: BackupSummary;
  counts: BackupCounts;
  rounds: BackupRounds;
  onRounds: (rounds: BackupRounds) => void;
  format: BackupFormat;
  onFormat: (format: BackupFormat) => void;
  busy: boolean;
}) {
  const t = useT();
  const { language } = useApp();
  const n = (value: number) => formatNumber(value, language);
  if (!summary.projectFile) return <Alert severity="info">{t("backup.noProjectFile")}</Alert>;
  return (
    <Stack spacing={2}>
      <FormControl disabled={busy}>
        <FormLabel id="backup-format">{t("backup.format")}</FormLabel>
        <RadioGroup aria-labelledby="backup-format" value={format} onChange={(e) => onFormat(e.target.value as BackupFormat)}>
          {FORMATS.map((f) => (
            <FormControlLabel
              key={f.value}
              value={f.value}
              control={<Radio slotProps={{ input: { "aria-describedby": `backup-${f.value}-help` } }} />}
              label={
                <Box>
                  <Typography>{t(f.label)}</Typography>
                  <Typography variant="body2" color="text.secondary" id={`backup-${f.value}-help`}>
                    {t(f.help)}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: "flex-start", mb: 1, "& .MuiRadio-root": { pt: 0.5 } }}
            />
          ))}
        </RadioGroup>
      </FormControl>
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
                  {t("backup.firstHelp.short")}
                  {summary.firstCodes && summary.firstCodes.length > 0 && ` ${t("backup.firstCodes", { codes: summary.firstCodes.join(", ") })}`}
                  <MoreInfo text={t("backup.firstHelp")} />
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
          {t("backup.noRoundKey.short")}
          <MoreInfo text={t("backup.noRoundKey")} />
        </Alert>
      )}
      {counts.records === 0 ? (
        <Alert severity="info">{t("backup.none")}</Alert>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.5 } }} aria-live="polite">
          <li>
            {t("backup.records", { count: n(counts.records) })} {t("backup.size", { size: formatBytes(counts.estimatedBytes, language) })}
          </li>
          {counts.drafts > 0 && <li>{t(format === "collect" ? "backup.drafts.collect" : "backup.drafts", { count: n(counts.drafts) })}</li>}
          {rounds === "1" && counts.otherRounds > 0 && <li>{t("backup.otherRounds", { count: n(counts.otherRounds) })}</li>}
          {counts.measurements > 0 && (
            <li>
              {t("backup.measurements.short", { count: n(counts.measurements) })}
              <MoreInfo text={t("backup.measurements", { count: n(counts.measurements) })} />
            </li>
          )}
          {counts.sameKey > 0 && (
            <li>
              {t("backup.sameKey.short", { count: n(counts.sameKey), examples: counts.sameKeyExamples.slice(0, 3).join(", ") })}
              <MoreInfo text={t("backup.sameKey", { count: n(counts.sameKey), examples: counts.sameKeyExamples.slice(0, 3).join(", ") })} />
            </li>
          )}
          {counts.noXml > 0 && <li>{t("backup.noXml", { count: n(counts.noXml) })}</li>}
          {summary.note && <li>{t("backup.note")}</li>}
        </Box>
      )}
      {format === "collect" ? (
        <Explain variant="body2" text={t("backup.howTo.collect.short")} more={t("backup.howTo.collect")} />
      ) : (
        <Explain variant="body2" text={t("backup.howTo.short")} more={`${t("backup.howTo")}\n\n${t("backup.clientMode")}`} />
      )}
    </Stack>
  );
}
