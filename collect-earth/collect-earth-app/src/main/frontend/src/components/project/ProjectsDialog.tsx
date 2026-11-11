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
import Tooltip from "@mui/material/Tooltip";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";
import PersonIcon from "@mui/icons-material/Person";
import { errorText } from "../../appBar";
import { cloudProjectServers, roleOf } from "../../cloud";
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
 * Project > Switch project: the projects loaded on this computer, as the Settings page lists them (each marked on this
 * computer or cloud), and the cloud projects of the user signed in here, with your role, their server when they are on
 * several, and those already on this computer; each opened with a click.
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
  // The server once for the list, or by each project when they are on several (cloud.ts)
  const servers = cloudProjectServers(projects);
  const serverMark = (server: string) => (
    <Chip size="small" variant="outlined" icon={<CloudOutlinedIcon />} label={t("cloud.cloud", { server })} data-testid="cloud-project-server" />
  );
  return (
    <Stack spacing={1.5} sx={{ mt: 2 }} data-testid="cloud-projects">
      <Divider />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
        <Typography variant="subtitle2">{s("CloudProjects.title")}</Typography>
        {servers.list && serverMark(servers.list)}
      </Stack>
      {error && <Alert severity="warning">{error}</Alert>}
      {projects.map((p, i) => {
        const role = roleOf(p.role, t);
        const server = servers.each[i];
        return (
        <Paper key={p.projectId} variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <CloudOutlinedIcon fontSize="small" color="action" />
          <Stack direction="row" spacing={1} sx={{ flex: "1 1 200px", minWidth: 0, alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap title={p.projectName}>{p.projectName}</Typography>
            {p.active && <Chip label={s("SettingsPage.project.active")} color="success" size="small" />}
            {/* Your role there, by the dashboard's name, what it does on hover */}
            {role && (
              <Tooltip title={role.help} describeChild>
                <Chip size="small" variant="outlined" icon={<PersonIcon />} label={role.name} data-testid="cloud-project-role" />
              </Tooltip>
            )}
            {server && serverMark(server)}
            {p.onThisComputer && !p.active && (
              <Chip size="small" variant="outlined" icon={<ComputerOutlinedIcon />} label={t("cloud.alreadyHere")} data-testid="cloud-project-here" />
            )}
          </Stack>
          <Button variant={p.active ? "outlined" : "contained"} size="small" disabled={opening !== null || p.active} onClick={() => openProject(p)}>
            {opening === p.projectId ? s("SettingsPage.project.loading") : s("OptionWizard.56")}
          </Button>
        </Paper>
        );
      })}
    </Stack>
  );
}
