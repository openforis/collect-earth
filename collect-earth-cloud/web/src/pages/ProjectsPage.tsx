import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/Add";
import FolderOpen from "@mui/icons-material/FolderOpen";
import { useState, type FormEvent } from "react";
import { createProject, listProjects } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
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
      // A new project starts on its getting-started checklist.
      navigate(pathFor({ name: "project", projectId: created.projectId, tab: "setup" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>{t("projects.newTitle")}</DialogTitle>
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

export function ProjectsPage() {
  const t = useT();
  const { me, info } = useApp();
  const projects = useLoad(listProjects, []);
  const [creating, setCreating] = useState(false);
  const canCreate = me?.isPlatformAdmin === true || info.projectCreation === "anyone";

  return (
    <AppShell>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 3, gap: 2, flexWrap: "wrap" }}>
        <Typography variant="h1">{t("projects.title")}</Typography>
        {canCreate && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
            {t("projects.new")}
          </Button>
        )}
      </Stack>
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
      ) : (
        <Grid container spacing={2}>
          {projects.data?.map((p) => (
            <Grid key={p.projectId} size={{ xs: 12, sm: 6 }}>
              <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <CardActionArea {...linkProps(pathFor({ name: "project", projectId: p.projectId, tab: "progress" }))} sx={{ flex: 1 }}>
                  <CardContent>
                    <Typography variant="h3" component="h2" gutterBottom sx={{ wordBreak: "break-word" }}>
                      {p.projectName}
                    </Typography>
                    <Chip size="small" label={t(`role.${p.role}`)} color={p.role === "admin" ? "primary" : "default"} />
                  </CardContent>
                </CardActionArea>
                {/* Every member can see how their own plots fared in the checks. */}
                <CardActions sx={{ pt: 0 }}>
                  <Button size="small" {...linkProps(pathFor({ name: "myQuality", projectId: p.projectId }))}>
                    {t("myQuality.link")}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {creating && <NewProjectDialog open onClose={() => setCreating(false)} />}
    </AppShell>
  );
}
