import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { importProject } from "../../projectApi";
import { serverText, type Texts } from "../../serverTexts";
import { chooseFile } from "../../settingsApi";
import { RestartingOverlay } from "../settings/RestartingOverlay";

interface Props { open: boolean; texts: Texts | null; onClose: () => void; /** A dropped file, already on the server */ path?: string | null }

/** Import CEP file: the project file, then the import and the restart, as the Swing entry did. */
export function ImportCepDialog({ open, texts, onClose, path: given }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (open) { setPath(given ?? ""); setError(null); setBusy(false); }
  }, [open, given]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const choose = () => chooseFile("OPEN", ["cep"]).then((chosen) => { if (chosen) setPath(chosen); }, fail);
  const start = () => {
    setBusy(true);
    setError(null);
    importProject(path).then((r) => { if (r.restart) setRestarting(true); else setBusy(false); }, fail);
  };

  if (restarting) return <RestartingOverlay text={s("SettingsPage.restarting")} />;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="import-cep-dialog">
      <DialogTitle>{s("CollectEarthMenu.0")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" sx={{ whiteSpace: "pre-line" }}>{error}</Alert>}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="outlined" onClick={choose} disabled={busy}>{s("ProjectPage.import.choose")}</Button>
            {path && <Typography variant="body2" noWrap title={path} sx={{ minWidth: 0 }}>{path}</Typography>}
          </Stack>
          <Typography variant="body2" color="text.secondary">{s("ProjectPage.import.note")}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{s("OptionWizard.24")}</Button>
        <Button variant="contained" onClick={start} disabled={!path || busy}>{s("ProjectPage.import.start")}</Button>
      </DialogActions>
    </Dialog>
  );
}
