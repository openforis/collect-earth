import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import type { Project } from "../../settings";
import { listProjects, loadProject } from "../../settingsApi";
import { serverText, type Texts } from "../../serverTexts";

interface Props {
  texts: Texts | null;
  /** Collect Earth restarts with the project chosen */
  onRestarting: () => void;
  /** Something to say in passing, as when the project chosen is the loaded one already */
  onMessage: (message: string) => void;
}

/** The projects loaded before (GET /api/projects), the current one marked, each with Load, which restarts Collect Earth. */
export function ProjectsCard({ texts, onRestarting, onMessage }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listProjects(controller.signal).then(setProjects, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [t]);

  const load = (project: Project) => {
    setLoading(project.folder);
    setError(null);
    loadProject(project.folder).then((r) => {
      if (r.restart) onRestarting();
      else if (r.message) onMessage(r.message);
    }, (e) => setError(errorText(e, t("appBar.unreachable")))).finally(() => setLoading(null));
  };

  return (
    <Stack spacing={1.5} data-testid="projects">
      <Typography variant="subtitle2">{s("OptionWizard.57")}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {projects === null && !error && <LinearProgress />}
      {projects?.length === 0 && <Typography variant="body2" color="text.secondary">{s("SettingsPage.project.none")}</Typography>}
      {projects?.map((p) => (
        <Paper key={p.folder} variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Stack sx={{ flex: "1 1 200px", minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap title={p.name}>{p.name}</Typography>
              {p.active && <Chip label={s("SettingsPage.project.active")} color="success" size="small" />}
            </Stack>
            <Typography variant="caption" color="text.secondary" noWrap title={p.folder}>{p.folder}</Typography>
          </Stack>
          <Button variant={p.active ? "outlined" : "contained"} size="small" disabled={loading !== null} onClick={() => load(p)}>
            {loading === p.folder ? s("SettingsPage.project.loading") : s("OptionWizard.56")}
          </Button>
        </Paper>
      ))}
    </Stack>
  );
}
