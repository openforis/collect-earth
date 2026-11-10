import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { importCeoProject, previewCeoImport, type CeoImportPreview, type CeoReportEntry } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { useT } from "../i18n";
import { navigate, pathFor } from "../router";

/** CEO answers its project's file at this address, to anyone for a public project and to its admins when signed in. */
export const ceoProjectUrl = (id: string) => `https://app.collect.earth/get-project-by-id?projectId=${encodeURIComponent(id)}`;

const OUTCOME_COLOR = { imported: "success", changed: "warning", skipped: "error", info: "default" } as const;

/** What the coordinator should read before creating: what changed, was left out, or is a note. */
export const needsAttention = (e: CeoReportEntry) => e.outcome !== "imported";

/**
 * A new project from Collect Earth Online (docs/plans/2026-11-09-ceo-bridge.md, B4 and B5): the file saved from CEO,
 * the report of what comes across, then the project, which opens on its getting-started checklist (the plots next).
 */
export function CeoImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [ceoId, setCeoId] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<CeoImportPreview | null>(null);
  const [name, setName] = useState("");
  const [empty, setEmpty] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const read = async (files: File[]) => {
    setError(null);
    setBusy(true);
    try {
      const text = await files[0].text();
      const shown = await previewCeoImport(text);
      setFile(text);
      setPreview(shown);
      setName(shown.name);
      setShowAll(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (file === null) return;
    setError(null);
    if (!name.trim()) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    try {
      const created = await importCeoProject(file, name.trim());
      await refreshMe();
      navigate(pathFor({ name: "project", projectId: created.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const entries = preview ? preview.report.filter((e) => showAll || needsAttention(e)) : [];
  const validId = /^\d+$/.test(ceoId.trim());

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <form onSubmit={create} noValidate>
        <DialogTitle>{t("ceoImport.title")}</DialogTitle>
        <DialogContent>
          {preview === null ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>{t("ceoImport.intro")}</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
                <TextField
                  label={t("ceoImport.idLabel")}
                  helperText={t("ceoImport.idHelp")}
                  value={ceoId}
                  onChange={(e) => setCeoId(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 12 } }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  component="a"
                  aria-disabled={!validId}
                  disabled={!validId}
                  href={ceoProjectUrl(ceoId.trim())}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ mt: { sm: 1 } }}
                >
                  {t("ceoImport.open")}
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("ceoImport.save")}
              </Typography>
              <FileDrop label={t("ceoImport.drop")} buttonLabel={t("ceoImport.choose")} accept=".json,application/json" disabled={busy} onFiles={read} />
              {busy && <LinearProgress aria-label={t("ceoImport.reading")} />}
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label={t("projects.nameLabel")}
                helperText={empty ? t("error.required") : preview.ceoProjectId !== null ? t("ceoImport.fromProject", { id: String(preview.ceoProjectId) }) : " "}
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
                    primary={t("ceoImport.questions", { count: String(preview.counts.questions) })}
                    secondary={t("ceoImport.questionsDetail", { changed: String(preview.counts.questionsChanged), skipped: String(preview.counts.questionsSkipped) })}
                  />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemText primary={t("ceoImport.rules", { count: String(preview.counts.rules) })} secondary={t("ceoImport.rulesDetail", { skipped: String(preview.counts.rulesSkipped) })} />
                </ListItem>
              </List>
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="h3" component="h3">
                  {showAll ? t("ceoImport.everything") : t("ceoImport.attention")}
                </Typography>
                <Link component="button" type="button" onClick={() => setShowAll(!showAll)}>
                  {showAll ? t("ceoImport.hideAll") : t("ceoImport.showAll")}
                </Link>
              </Stack>
              {entries.length === 0 ? (
                <Typography color="text.secondary">{t("ceoImport.nothingChanged")}</Typography>
              ) : (
                <List dense disablePadding sx={{ maxHeight: 320, overflowY: "auto" }} lang="en">
                  {entries.map((e, i) => (
                    <ListItem key={i} disableGutters sx={{ alignItems: "flex-start", gap: 1 }}>
                      <Chip size="small" variant="outlined" color={OUTCOME_COLOR[e.outcome]} label={t(`ceoImport.outcome.${e.outcome}`)} sx={{ mt: 0.5 }} />
                      <ListItemText primary={e.subject} secondary={e.message} slotProps={{ primary: { sx: { wordBreak: "break-word" } } }} />
                    </ListItem>
                  ))}
                </List>
              )}
              <Typography variant="body2" color="text.secondary">
                {t("ceoImport.english")}
              </Typography>
              <Alert severity="info">{t("ceoImport.next")}</Alert>
              {busy && <LinearProgress aria-label={t("ceoImport.creating")} />}
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
              <Button
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                  setError(null);
                }}
                disabled={busy}
              >
                {t("ceoImport.another")}
              </Button>
              <Button type="submit" variant="contained" disabled={busy}>
                {t("projects.create")}
              </Button>
            </>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
