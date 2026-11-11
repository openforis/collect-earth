import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { base64Of, importBackup, previewBackupImport, type BackupFiles, type BackupImportPreview, type PlotLayout } from "../api";
import { useApp } from "../appContext";
import { layoutProblem, layoutSize, MAX_BACKUP_BYTES, megabytes, round2 } from "../backupImportView";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { useT } from "../i18n";
import { navigate, pathFor } from "../router";

/**
 * A new project from a Collect Earth backup (docs/plans/2026-11-11-backup-import.md): the zip of its data (the survey
 * and the records), the project's plot file when the coordinator has it, the plot layout the backup does not hold
 * (suggested from the survey's plot area and points), and whose the records are; then the project, which opens on its
 * getting-started checklist.
 */
export function BackupImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [files, setFiles] = useState<BackupFiles | null>(null);
  const [preview, setPreview] = useState<BackupImportPreview | null>(null);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<PlotLayout | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [empty, setEmpty] = useState(false);
  const [tooLarge, setTooLarge] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const working = async (work: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Shows what the files make; the first preview gives the survey's name and layout. */
  const show = async (next: BackupFiles) => {
    const shown = await previewBackupImport(next);
    if (preview === null) {
      setName(shown.name);
      setLayout(shown.layout);
    }
    setPreview(shown);
    setFiles(next);
  };

  const readBackup = ([file]: File[]) => {
    setTooLarge(null);
    if (file.size > MAX_BACKUP_BYTES) {
      setTooLarge(file.size);
      return;
    }
    return working(async () => show({ backup: base64Of(new Uint8Array(await file.arrayBuffer())), plotFile: null, plotFileName: null }));
  };

  const readPlotFile = ([file]: File[]) => working(async () => show({ ...files!, plotFile: await file.text(), plotFileName: file.name }));

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!files || !layout) return;
    setError(null);
    if (!name.trim()) {
      setEmpty(true);
      return;
    }
    if (layoutProblem(layout)) return;
    setBusy(true);
    try {
      const collectors = Object.fromEntries(Object.entries(accounts).map(([typed, username]) => [typed, username.trim()]).filter(([, username]) => username !== ""));
      const created = await importBackup(files, name.trim(), layout, collectors);
      await refreshMe();
      navigate(pathFor({ name: "project", projectId: created.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const startAgain = () => {
    setPreview(null);
    setFiles(null);
    setLayout(null);
    setAccounts({});
    setError(null);
  };

  const plots = preview?.plots;
  const size = layout ? layoutSize(layout) : null;
  const problem = layout ? layoutProblem(layout) : null;
  const number = (key: keyof PlotLayout, value: string) => setLayout({ ...layout!, [key]: value === "" ? Number.NaN : Number(value) });
  const field = (key: "points" | "distance" | "boundary", label: string) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={Number.isNaN(layout![key]) ? "" : layout![key]}
      onChange={(e) => number(key, e.target.value)}
      error={key === "points" && problem === "backupImport.squarePoints"}
      slotProps={{ htmlInput: { min: key === "points" ? 0 : 0.1, step: key === "points" ? 1 : 0.1 } }}
      sx={{ width: { xs: "100%", sm: 170 } }}
    />
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <form onSubmit={create} noValidate>
        <DialogTitle>{t("backupImport.title")}</DialogTitle>
        <DialogContent>
          {preview === null || !layout || !plots ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>{t("backupImport.intro")}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t("backupImport.how")}
              </Typography>
              <FileDrop label={t("backupImport.drop")} buttonLabel={t("backupImport.choose")} accept=".zip,application/zip" disabled={busy} onFiles={readBackup} />
              {tooLarge !== null && <Alert severity="error">{t("backupImport.tooLarge", { size: megabytes(tooLarge), max: megabytes(MAX_BACKUP_BYTES) })}</Alert>}
              {busy && <LinearProgress aria-label={t("backupImport.reading")} />}
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label={t("projects.nameLabel")}
                helperText={empty ? t("error.required") : preview.surveyName}
                error={empty}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setEmpty(false);
                }}
                required
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              <List dense disablePadding aria-label={t("ceoImport.summary")}>
                <ListItem disableGutters>
                  <ListItemText
                    primary={preview.records.total === 1 ? t("backupImport.recordsOne") : t("backupImport.records", { count: String(preview.records.total) })}
                    secondary={t("backupImport.recordsDetail", { submitted: String(preview.records.submitted), drafts: String(preview.records.drafts) })}
                  />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemText primary={t("backupImport.plots", { count: String(plots.withRecords) })} secondary={t("backupImport.plotsDetail", { done: String(plots.done) })} />
                </ListItem>
              </List>
              {preview.records.unreadable > 0 && (
                <Alert severity="warning">{t("backupImport.unreadable", { count: String(preview.records.unreadable), examples: preview.records.unreadableExamples.join(", ") })}</Alert>
              )}
              {plots.withoutPlace > 0 && (
                <Alert severity="warning">{t("backupImport.withoutPlace", { count: String(plots.withoutPlace), examples: plots.withoutPlaceExamples.join(", ") })}</Alert>
              )}

              <Typography variant="h3" component="h3">
                {t("backupImport.plotFile")}
              </Typography>
              {plots.inFile === null ? (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {t("backupImport.plotFileHelp")}
                  </Typography>
                  <FileDrop label={t("backupImport.dropPlotFile")} buttonLabel={t("backupImport.choosePlotFile")} accept=".csv,text/csv" disabled={busy} onFiles={readPlotFile} />
                  <Alert severity="info">{t("backupImport.noPlotFile", { toDo: String(plots.toDo) })}</Alert>
                </>
              ) : (
                <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography sx={{ flex: 1, wordBreak: "break-word" }}>
                    {t("backupImport.plotFileIn", { name: files?.plotFileName ?? "", count: String(plots.inFile), toDo: String(plots.toDo) })}
                  </Typography>
                  <Button disabled={busy} onClick={() => void working(() => show({ ...files!, plotFile: null, plotFileName: null }))}>
                    {t("backupImport.removePlotFile")}
                  </Button>
                  {(plots.notInFile ?? 0) > 0 && (
                    <Alert severity="warning" sx={{ width: "100%" }}>
                      {t("backupImport.notInFile", { count: String(plots.notInFile) })}
                    </Alert>
                  )}
                </Stack>
              )}

              <Typography variant="h3" component="h3">
                {t("backupImport.layout")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {preview.survey.plotAreaHa !== null && preview.survey.samplePoints !== null
                  ? t("backupImport.layoutHelp", { area: round2(preview.survey.plotAreaHa), points: String(preview.survey.samplePoints) })
                  : t("backupImport.layoutHelpNone")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  select
                  size="small"
                  label={t("backupImport.shape")}
                  value={layout.shape}
                  onChange={(e) => setLayout({ ...layout, shape: e.target.value as PlotLayout["shape"] })}
                  sx={{ width: { xs: "100%", sm: 150 } }}
                >
                  <MenuItem value="SQUARE">{t("backupImport.square")}</MenuItem>
                  <MenuItem value="CIRCLE">{t("backupImport.circle")}</MenuItem>
                </TextField>
                {field("points", t("backupImport.points"))}
                {field("distance", layout.shape === "CIRCLE" ? t("backupImport.radius") : t("backupImport.spacing"))}
                {layout.shape === "SQUARE" && field("boundary", t("backupImport.boundary"))}
              </Stack>
              {problem ? (
                <Alert severity="error">{t(problem)}</Alert>
              ) : (
                size && (
                  <Typography variant="body2" color="text.secondary">
                    {size.side !== null ? t("backupImport.side", { side: round2(size.side), area: round2(size.areaHa) }) : `${round2(size.areaHa)} ha`}
                  </Typography>
                )
              )}

              {preview.collectors.length > 0 && (
                <Stack spacing={1}>
                  <Typography variant="h3" component="h3">
                    {t("backupImport.collectors")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("backupImport.collectorsHelp")}
                  </Typography>
                  {preview.collectors.map((c) => (
                    <Stack key={c.name} direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                      <ListItemText primary={c.name || "—"} secondary={c.records === 1 ? t("backupImport.recordsOne") : t("backupImport.collectorRecords", { count: String(c.records) })} sx={{ flex: 1, wordBreak: "break-word" }} />
                      <TextField
                        size="small"
                        label={t("backupImport.accountLabel")}
                        value={accounts[c.name] ?? ""}
                        onChange={(e) => setAccounts({ ...accounts, [c.name]: e.target.value })}
                        slotProps={{ htmlInput: { maxLength: 100, autoCapitalize: "none", spellCheck: false } }}
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
              <Alert severity="info">{t("backupImport.next")}</Alert>
              {busy && <LinearProgress aria-label={t("backupImport.creating")} />}
            </Stack>
          )}
          <Stack sx={{ mt: error ? 2 : 0 }}>
            <ErrorAlert error={error} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          {preview !== null && (
            <>
              <Button onClick={startAgain} disabled={busy}>
                {t("backupImport.another")}
              </Button>
              <Button type="submit" variant="contained" disabled={busy || problem !== null}>
                {t("projects.create")}
              </Button>
            </>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
