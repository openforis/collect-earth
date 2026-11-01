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
import { serverText, type Texts } from "../../serverTexts";
import { chooseFile } from "../../settingsApi";
import { kmlCsvName } from "../../tools";
import { loadKml } from "../../toolsApi";
import { RestartingOverlay } from "../settings/RestartingOverlay";

interface Props { open: boolean; texts: Texts | null; onClose: () => void; /** A KML dropped on the page, already on the server */ kml?: string | null }

/**
 * Load points from KML: the KML, where to save the plots file made from it, then the one call that writes it, makes
 * it the plots file and restarts Collect Earth, under the restart overlay of the settings.
 */
export function LoadKmlDialog({ open, texts, onClose, kml: given }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [kml, setKml] = useState("");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (open) { setKml(given ?? ""); setCsv(""); setError(null); setBusy(false); }
  }, [open, given]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const chooseKml = () => chooseFile("OPEN", ["kml", "kmz"]).then((chosen) => { if (chosen) setKml(chosen); }, fail);
  const chooseCsv = () => chooseFile("SAVE", ["csv"], csv || kmlCsvName(kml)).then((chosen) => { if (chosen) setCsv(chosen); }, fail);
  const load = () => {
    setBusy(true);
    setError(null);
    loadKml(kml, csv).then((r) => { if (r.restart) setRestarting(true); else setBusy(false); }, fail);
  };

  if (restarting) return <RestartingOverlay text={s("SettingsPage.restarting")} />;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="load-kml-dialog">
      <DialogTitle>{s("ToolsPage.kml.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="outlined" onClick={chooseKml} disabled={busy}>{s("ToolsPage.kml.chooseKml")}</Button>
            {kml && <Typography variant="body2" noWrap title={kml} sx={{ minWidth: 0 }}>{kml}</Typography>}
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="outlined" onClick={chooseCsv} disabled={!kml || busy}>{s("ToolsPage.kml.csv")}</Button>
            {csv && <Typography variant="body2" noWrap title={csv} sx={{ minWidth: 0 }}>{csv}</Typography>}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{s("OptionWizard.24")}</Button>
        <Button variant="contained" onClick={load} disabled={!kml || !csv || busy}>{s("ToolsPage.kml.load")}</Button>
      </DialogActions>
    </Dialog>
  );
}
