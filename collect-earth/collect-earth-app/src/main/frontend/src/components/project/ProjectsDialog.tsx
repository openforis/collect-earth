import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { cloudProjects, openCloudProject, type CloudProject } from "../../projectApi";
import { serverText, type Texts } from "../../serverTexts";
import { ProjectsCard } from "../settings/ProjectsCard";

interface Props {
  open: boolean;
  texts: Texts | null;
  onClose: () => void;
  /** A project loaded: Collect Earth restarts with it */
  onRestarting: () => void;
}

/**
 * Project > Switch project: the projects loaded on this computer, as the Settings page lists them, and the cloud
 * projects of the user signed in here, each opened with a click.
 */
export function ProjectsDialog({ open, texts, onClose, onRestarting }: Props) {
  const s = (key: string) => serverText(texts, key);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (open) setMessage(null); }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="projects-dialog">
      <DialogContent>
        {message && <Alert severity="info" sx={{ mb: 1.5 }}>{message}</Alert>}
        {/* Mounted only while open, so the lists are fresh each time */}
        {open && <ProjectsCard texts={texts} onRestarting={onRestarting} onMessage={setMessage} />}
        {open && <CloudProjects texts={texts} onRestarting={onRestarting} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{s("OptionWizard.24")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** The cloud projects of the user signed in here; nothing at all when nobody is, or they have none. */
function CloudProjects({ texts, onRestarting }: { texts: Texts | null; onRestarting: () => void }) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    cloudProjects(controller.signal).then(setProjects, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [t]);

  const openProject = (p: CloudProject) => {
    setOpening(p.projectId);
    setError(null);
    openCloudProject(p.projectId).then((r) => { if (r.restart) onRestarting(); },
      (e) => { setError(errorText(e, t("appBar.unreachable"))); setOpening(null); });
  };

  if (!error && projects.length === 0) return null;
  return (
    <Stack spacing={1.5} sx={{ mt: 2 }} data-testid="cloud-projects">
      <Divider />
      <Typography variant="subtitle2">{s("CloudProjects.title")}</Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {projects.map((p) => (
        <Paper key={p.projectId} variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <CloudOutlinedIcon fontSize="small" color="action" />
          <Stack direction="row" spacing={1} sx={{ flex: "1 1 200px", minWidth: 0, alignItems: "center" }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap title={p.projectName}>{p.projectName}</Typography>
            {p.active && <Chip label={s("SettingsPage.project.active")} color="success" size="small" />}
          </Stack>
          <Button variant={p.active ? "outlined" : "contained"} size="small" disabled={opening !== null || p.active} onClick={() => openProject(p)}>
            {opening === p.projectId ? s("SettingsPage.project.loading") : s("OptionWizard.56")}
          </Button>
        </Paper>
      ))}
    </Stack>
  );
}
