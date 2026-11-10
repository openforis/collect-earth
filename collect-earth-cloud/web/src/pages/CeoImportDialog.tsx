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
import { fetchCeoProject, importCeoProject, previewCeoImport, type CeoFiles, type CeoImportPreview, type CeoReportEntry } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { useT } from "../i18n";
import { navigate, pathFor } from "../router";

/** CEO answers these to anyone for a public project, and to its members when signed in. */
export const ceoProjectUrl = (id: string) => `https://app.collect.earth/get-project-by-id?projectId=${encodeURIComponent(id)}`;
export const ceoPlotsUrl = (id: string) => `https://app.collect.earth/get-project-plots?projectId=${encodeURIComponent(id)}`;
/** The project's "Download Sample Data": CEO gives it to the project's administrators only. */
export const ceoAnswersUrl = (id: string) => `https://app.collect.earth/dump-project-raw-data?projectId=${encodeURIComponent(id)}`;

/** The project number in what was typed or pasted: the number itself, or any CEO address with ?projectId=1234. */
export function ceoProjectIdOf(text: string): string | null {
  const typed = text.trim();
  if (/^\d{1,12}$/.test(typed)) return typed;
  return /[?&#]projectId=(\d{1,12})(?!\d)/i.exec(typed)?.[1] ?? null;
}

/** Which of CEO's three files a text is: its plot list is a JSON array, its sample data a CSV, its project an object. */
export function ceoFileKind(text: string): keyof CeoFiles {
  const start = text.replace(/^﻿/, "").trimStart();
  if (start.startsWith("[")) return "plots";
  if (start.startsWith("plotid")) return "answers";
  return "project";
}

const OUTCOME_COLOR = { imported: "success", changed: "warning", skipped: "error", info: "default" } as const;

/** What the coordinator should read before creating: what changed, was left out, or is a note. */
export const needsAttention = (e: CeoReportEntry) => e.outcome !== "imported";

const NO_FILES = { project: null as string | null, plots: null as string | null, answers: null as string | null };

/**
 * A new project from Collect Earth Online (docs/plans/2026-11-09-ceo-bridge.md, B3 to C): the files saved from CEO (the
 * project; its plots and its answers when wanted), the report of what comes across, whose the answers are, then the
 * project, which opens on its getting-started checklist.
 */
export function CeoImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [ceoId, setCeoId] = useState("");
  const [files, setFiles] = useState(NO_FILES);
  const [preview, setPreview] = useState<CeoImportPreview | null>(null);
  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [empty, setEmpty] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /** Shows what the files make, once the project is there. */
  const show = async (next: typeof files) => {
    if (next.project !== null) {
      const shown = await previewCeoImport({ project: next.project, plots: next.plots, answers: next.answers });
      // A name typed already stays; the first preview gives CEO's
      if (preview === null) setName(shown.name);
      setPreview(shown);
      setShowAll(false);
    }
    setFiles(next);
  };

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

  /** Takes the files dropped (any of the three, in any order). */
  const read = (dropped: File[]) =>
    working(async () => {
      const next = { ...files };
      for (const file of dropped) {
        const text = await file.text();
        next[ceoFileKind(text)] = text;
      }
      await show(next);
    });

  /** The project and its plots, read from CEO by the server: only the answers are left to drop as a file. */
  const readFromCeo = () =>
    working(async () => {
      const fetched = await fetchCeoProject(ceoProjectIdOf(ceoId)!);
      await show({ ...files, project: fetched.project, plots: fetched.plots });
    });

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (files.project === null) return;
    setError(null);
    if (!name.trim()) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    try {
      const collectors = Object.fromEntries(Object.entries(accounts).map(([email, username]) => [email, username.trim()]).filter(([, username]) => username !== ""));
      const created = await importCeoProject({ project: files.project, plots: files.plots, answers: files.answers }, name.trim(), collectors);
      await refreshMe();
      navigate(pathFor({ name: "project", projectId: created.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const startAgain = () => {
    setPreview(null);
    setFiles(NO_FILES);
    setAccounts({});
    setError(null);
  };

  const entries = preview ? preview.report.filter((e) => showAll || needsAttention(e)) : [];
  const id = ceoProjectIdOf(ceoId) ?? "";
  const validId = id !== "";
  const plotCount = preview?.counts.plots ?? null;
  const answers = preview?.answers ?? null;
  const link = (href: string, text: string) => (
    <Button variant="outlined" component="a" aria-disabled={!validId} disabled={!validId} href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </Button>
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <form onSubmit={create} noValidate>
        <DialogTitle>{t("ceoImport.title")}</DialogTitle>
        <DialogContent>
          {preview === null ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>{t("ceoImport.intro")}</Typography>
              <TextField
                label={t("ceoImport.idLabel")}
                helperText={t("ceoImport.idHelp")}
                value={ceoId}
                onChange={(e) => setCeoId(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 2000, spellCheck: false, autoCapitalize: "none" } }}
              />
              <Stack direction="row">
                <Button variant="contained" disabled={!validId || busy} onClick={readFromCeo}>
                  {t("ceoImport.fetch")}
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("ceoImport.fetchHelp")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                {link(ceoProjectUrl(id), t("ceoImport.open"))}
                {link(ceoPlotsUrl(id), t("ceoImport.openPlots"))}
                {link(ceoAnswersUrl(id), t("ceoImport.openAnswers"))}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("ceoImport.save")}
              </Typography>
              <FileDrop label={t("ceoImport.drop")} buttonLabel={t("ceoImport.choose")} accept=".json,.csv,application/json,text/csv" multiple disabled={busy} onFiles={read} />
              {(files.plots !== null || files.answers !== null) && files.project === null && <Alert severity="info">{t("ceoImport.plotsOnly")}</Alert>}
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
                <ListItem disableGutters>
                  <ListItemText primary={plotCount !== null ? t("ceoImport.plots", { count: String(plotCount) }) : t("ceoImport.noPlots")} />
                </ListItem>
                {plotCount !== null && (
                  <ListItem disableGutters>
                    <ListItemText
                      primary={answers ? t("ceoImport.answers", { count: String(answers.plots), collectors: String(answers.collectors.length) }) : t("ceoImport.noAnswers")}
                      secondary={answers && answers.flagged > 0 ? t("ceoImport.answersFlagged", { count: String(answers.flagged) }) : undefined}
                    />
                  </ListItem>
                )}
              </List>
              {plotCount === null && (
                <FileDrop label={t("ceoImport.dropPlots")} buttonLabel={t("ceoImport.choosePlots")} accept=".json,application/json" disabled={busy} onFiles={read} />
              )}
              {plotCount !== null && answers === null && (
                <FileDrop label={t("ceoImport.dropAnswers")} buttonLabel={t("ceoImport.chooseAnswers")} accept=".csv,text/csv" disabled={busy} onFiles={read} />
              )}
              {answers && answers.collectors.length > 0 && (
                <Stack spacing={1}>
                  <Typography variant="h3" component="h3">
                    {t("ceoImport.collectors")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("ceoImport.collectorsHelp")}
                  </Typography>
                  {answers.collectors.map((c, i) => (
                    <Stack key={c.email} direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                      <ListItemText primary={c.email} secondary={t("ceoImport.collectorPlots", { count: String(c.plots) })} sx={{ flex: 1, wordBreak: "break-all" }} />
                      <TextField
                        size="small"
                        label={t("ceoImport.accountLabel")}
                        placeholder={`ceo-collector-${i + 1}`}
                        value={accounts[c.email] ?? ""}
                        onChange={(e) => setAccounts({ ...accounts, [c.email]: e.target.value })}
                        slotProps={{ htmlInput: { maxLength: 100, autoCapitalize: "none", spellCheck: false } }}
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
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
              <Alert severity="info">{answers ? t("ceoImport.nextWithAnswers") : plotCount !== null ? t("ceoImport.nextWithPlots") : t("ceoImport.next")}</Alert>
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
              <Button onClick={startAgain} disabled={busy}>
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
