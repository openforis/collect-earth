import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { helpText } from "../../projectApi";
import { serverText, type Texts } from "../../serverTexts";

interface Props { open: boolean; texts: Texts | null; name: "disclaimer" | "log"; onClose: () => void }

/** The disclaimer or the log in a dialog (OpenTextFileListener): the text of the file, and where it is. */
export function TextDialog({ open, texts, name, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [content, setContent] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setContent(null); setError(null);
    const controller = new AbortController();
    helpText(name, controller.signal).then(setContent, (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [open, name, t]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" data-testid={"text-dialog-" + name}>
      <DialogTitle>{s(name === "log" ? "CollectEarthWindow.53" : "CollectEarthWindow.4")}</DialogTitle>
      <DialogContent>
        {content && <Typography variant="caption" color="text.secondary" noWrap component="div" title={content.path}>{content.path}</Typography>}
        {error && <Alert severity="error">{error}</Alert>}
        {!content && !error && <CircularProgress size={24} />}
        {content && (
          <Box component="pre" sx={{ m: 0, mt: 1, p: 1, maxHeight: "60vh", overflow: "auto", fontSize: 12, bgcolor: "action.hover", borderRadius: 1, whiteSpace: name === "log" ? "pre" : "pre-wrap" }}>
            {content.text}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>{s("CollectEarthWindow.5")}</Button>
      </DialogActions>
    </Dialog>
  );
}
