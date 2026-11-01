import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { setLanguage } from "../../projectApi";
import { serverText, type Texts } from "../../serverTexts";

interface Props {
  open: boolean;
  texts: Texts | null;
  languages: { code: string; label: string }[];
  /** The language now, as a two-letter code */
  current: string;
  onClose: () => void;
  /** Saved: the page reloads itself in the new language, as the Swing window was opened again */
  onChanged?: () => void;
}

/** The Language entry of the Swing menu: a radio per language; the page reloads once it is saved. */
export function LanguageDialog({ open, texts, languages, current, onClose, onChanged = () => window.location.reload() }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [code, setCode] = useState(current.toUpperCase());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(current.toUpperCase()); setError(null); setBusy(false); } }, [open, current]);

  const apply = () => {
    setBusy(true);
    setError(null);
    setLanguage(code).then(onChanged, (e) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); });
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth data-testid="language-dialog">
      <DialogTitle>{s("CollectEarthWindow.2")}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        <RadioGroup value={code} onChange={(e) => setCode(e.target.value)}>
          {languages.map((l) => <FormControlLabel key={l.code} value={l.code} control={<Radio size="small" />} label={l.label} />)}
        </RadioGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{s("ProjectPage.language.note")}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{s("OptionWizard.24")}</Button>
        <Button variant="contained" onClick={apply} disabled={busy || code === current.toUpperCase()}>{s("ProjectPage.language.apply")}</Button>
      </DialogActions>
    </Dialog>
  );
}
