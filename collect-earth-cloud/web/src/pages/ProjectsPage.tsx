import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/Add";
import ContentCopy from "@mui/icons-material/ContentCopy";
import DesignServices from "@mui/icons-material/DesignServices";
import Description from "@mui/icons-material/Description";
import FolderOpen from "@mui/icons-material/FolderOpen";
import Public from "@mui/icons-material/Public";
import Unarchive from "@mui/icons-material/Unarchive";
import { useState, type FormEvent, type ReactNode } from "react";
import { copyProject, createProject, listProjects, type Membership } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { BackupImportDialog } from "./BackupImportDialog";
import { CeoImportDialog } from "./CeoImportDialog";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { linkProps, navigate, pathFor } from "../router";
import { useLoad } from "../useLoad";

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    try {
      const created = await createProject(name.trim());
      await refreshMe();
      // Started "from a project file": it opens where the .cep is dropped (which also adds its grid files and round).
      navigate(pathFor({ name: "project", projectId: created.projectId, tab: "file" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>{t("projects.fromCep")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t("projects.nameLabel")}
              helperText={empty ? t("error.required") : t("projects.nameHelp")}
              error={empty}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setEmpty(false);
              }}
              autoFocus
              required
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <ErrorAlert error={error} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("projects.create")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

type Start = "cep" | "backup" | "ceo" | "copy";

/** The New project button's question: how the new project starts. */
function StartDialog({ canCopy, onChoose, onClose }: { canCopy: boolean; onChoose: (start: Start) => void; onClose: () => void }) {
  const t = useT();
  const starts: { start: Start; icon: ReactNode; title: string; help: string }[] = [
    { start: "cep", icon: <Description />, title: t("projects.fromCep"), help: t("projects.fromCep.help") },
    { start: "backup", icon: <Unarchive />, title: t("projects.fromBackup"), help: t("projects.fromBackup.help") },
    { start: "ceo", icon: <Public />, title: t("projects.fromCeo"), help: t("projects.fromCeo.help") },
    ...(canCopy ? [{ start: "copy" as const, icon: <ContentCopy />, title: t("projects.fromCopy"), help: t("projects.fromCopy.help") }] : []),
  ];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("projects.startTitle")}</DialogTitle>
      <DialogContent sx={{ px: 1 }}>
        <List>
          {starts.map((s) => (
            <ListItemButton key={s.start} onClick={() => onChoose(s.start)} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ color: "primary.main" }}>{s.icon}</ListItemIcon>
              <ListItemText primary={s.title} secondary={s.help} />
            </ListItemButton>
          ))}
          {/* The survey designer in the dashboard: announced, not there yet */}
          <ListItemButton disabled sx={{ borderRadius: 1, "&.Mui-disabled": { opacity: 0.75 } }} data-testid="start-designer">
            <ListItemIcon sx={{ color: "text.secondary" }}><DesignServices /></ListItemIcon>
            <ListItemText
              primary={
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <span>{t("projects.fromDesigner")}</span>
                  <Chip size="small" color="info" variant="outlined" label={t("projects.comingSoon")} />
                </Stack>
              }
              secondary={t("projects.fromDesigner.help")}
            />
          </ListItemButton>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** A new draft project from one the user coordinates: the same request as Settings › Copy this project. */
function CopyDialog({ projects, onClose }: { projects: Membership[]; onClose: () => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [sourceId, setSourceId] = useState(projects[0].projectId);
  const sourceName = projects.find((p) => p.projectId === sourceId)?.projectName ?? "";
  // null until typed: the default name follows the project chosen.
  const [name, setName] = useState<string | null>(null);
  const value = name ?? t("copy.defaultName", { name: sourceName });
  const [members, setMembers] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const copy = await copyProject(sourceId, value.trim(), members);
      await refreshMe();
      navigate(pathFor({ name: "project", projectId: copy.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>{t("projects.fromCopy")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography color="text.secondary">{t("projects.fromCopy.help")}</Typography>
            <TextField select label={t("projects.copyFrom")} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {projects.map((p) => (
                <MenuItem key={p.projectId} value={p.projectId}>
                  {p.projectName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t("copy.nameLabel")}
              value={value}
              onChange={(e) => setName(e.target.value)}
              error={value.trim() === ""}
              helperText={value.trim() === "" ? t("error.required") : undefined}
              required
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <FormControlLabel control={<Checkbox checked={members} onChange={(e) => setMembers(e.target.checked)} />} label={t("copy.members")} />
            <ErrorAlert error={error} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={busy || value.trim() === ""}>
            {t("copy.submit")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function ProjectsPage() {
  const t = useT();
  const { me, info } = useApp();
  const projects = useLoad(listProjects, []);
  const [choosing, setChoosing] = useState(false);
  const [start, setStart] = useState<Start | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archived = projects.data?.filter((p) => p.status === "archived").length ?? 0;
  const shown = projects.data?.filter((p) => showArchived || p.status !== "archived");
  const canCreate = me?.isPlatformAdmin === true || info.projectCreation === "anyone";
  const coordinated = projects.data?.filter((p) => p.role === "admin") ?? [];

  return (
    <AppShell>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 3, gap: 2, flexWrap: "wrap" }}>
        <Typography variant="h1">{t("projects.title")}</Typography>
        {canCreate && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setChoosing(true)}>
            {t("projects.new")}
          </Button>
        )}
      </Stack>
      {archived > 0 && (
        <FormControlLabel
          sx={{ mb: 2 }}
          control={<Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
          label={`${t("projects.showArchived")} (${archived})`}
        />
      )}
      {projects.loading && !projects.data ? (
        <Loading />
      ) : projects.error ? (
        <ErrorAlert error={projects.error} onRetry={projects.reload} />
      ) : projects.data && projects.data.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState icon={<FolderOpen />} title={t("projects.empty.title")}>
            {canCreate ? t("projects.empty.create") : t("projects.empty.ask")}
          </EmptyState>
        </Paper>
      ) : shown && shown.length === 0 ? (
        <Typography color="text.secondary">{t("projects.onlyArchived")}</Typography>
      ) : (
        <Grid container spacing={2}>
          {shown?.map((p) => (
            <Grid key={p.projectId} size={{ xs: 12, sm: 6 }}>
              <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <CardActionArea {...linkProps(pathFor({ name: "project", projectId: p.projectId, tab: "progress" }))} sx={{ flex: 1 }}>
                  <CardContent>
                    <Typography variant="h3" component="h2" gutterBottom sx={{ wordBreak: "break-word" }}>
                      {p.projectName}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Chip size="small" label={t(`role.${p.role}`)} color={p.role === "admin" ? "primary" : "default"} />
                      {p.status !== "active" && <Chip size="small" variant="outlined" label={t(`project.status.${p.status}`)} />}
                    </Stack>
                  </CardContent>
                </CardActionArea>
                {/* Every member can see how their own plots fared in the checks; collectors and reviewers also their work, as on the project page. */}
                <CardActions sx={{ pt: 0 }}>
                  {p.role !== "admin" && (
                    <Button size="small" {...linkProps(pathFor({ name: "myWork", projectId: p.projectId }))}>
                      {t("myWork.link")}
                    </Button>
                  )}
                  <Button size="small" {...linkProps(pathFor({ name: "myQuality", projectId: p.projectId }))}>
                    {t("myQuality.link")}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {choosing && (
        <StartDialog
          canCopy={coordinated.length > 0}
          onClose={() => setChoosing(false)}
          onChoose={(chosen) => {
            setChoosing(false);
            setStart(chosen);
          }}
        />
      )}
      {start === "cep" && <NewProjectDialog open onClose={() => setStart(null)} />}
      {/* A project collected in Collect Earth, from a backup of its data (docs/plans/2026-11-11-backup-import.md) */}
      {start === "backup" && <BackupImportDialog onClose={() => setStart(null)} />}
      {/* For organizations moving from Collect Earth Online: its survey and rules (docs/plans/2026-11-09-ceo-bridge.md) */}
      {start === "ceo" && <CeoImportDialog onClose={() => setStart(null)} />}
      {start === "copy" && coordinated.length > 0 && <CopyDialog projects={coordinated} onClose={() => setStart(null)} />}
    </AppShell>
  );
}
