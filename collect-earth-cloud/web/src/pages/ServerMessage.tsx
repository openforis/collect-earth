import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { ApiError, previewServerMessage, sendServerMessage, type MessageAudience, type MessagePreview } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { formatNumber } from "../format";
import { useT } from "../i18n";

const MAX_SUBJECT = 150;
const MAX_TEXT = 5000;

/**
 * A message from the server's administrators to every coordinator, or everyone (POST /v1/admin/messages): written, then
 * previewed as the people will read it with how many get it, then sent. One an hour, said before it is written in vain.
 */
export function MessageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { language } = useApp();
  const [audience, setAudience] = useState<MessageAudience>("coordinators");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<{ sent: number; failed: number } | null>(null);
  const n = (v: number) => formatNumber(v, language);
  const time = (ms: number) => new Intl.DateTimeFormat(language, { timeStyle: "short" }).format(ms);
  const ready = subject.trim() !== "" && text.trim() !== "";

  const close = () => {
    if (busy) return;
    onClose();
    // what was sent is not kept; a draft stays until the page goes
    if (sent !== null) {
      setSubject("");
      setText("");
      setSent(null);
    }
    setPreview(null);
    setError(null);
    setNotice(null);
  };

  const look = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setPreview(await previewServerMessage({ audience, subject, text }, language));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await sendServerMessage({ audience, subject, text }, preview.recipients));
      setPreview(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === "recipients_changed") {
        setNotice(t("message.changed"));
        setPreview({ ...preview, recipients: Number(err.details.recipients) || 0 });
      } else if (err instanceof ApiError && err.code === "message_too_soon" && typeof err.details.nextAllowedAt === "number") {
        setPreview({ ...preview, nextAllowedAt: err.details.nextAllowedAt });
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const blocked = preview !== null && (!preview.delivers || preview.recipients === 0 || preview.nextAllowedAt !== null);
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" aria-labelledby="server-message-title">
      <DialogTitle id="server-message-title">{t("message.title")}</DialogTitle>
      <DialogContent>
        {sent !== null ? (
          <Stack spacing={1} role="status">
            <Alert severity="success">{t("message.sent", { count: n(sent.sent) })}</Alert>
            {sent.failed > 0 && <Alert severity="warning">{t("message.failed", { count: n(sent.failed) })}</Alert>}
          </Stack>
        ) : preview ? (
          <Stack spacing={2}>
            {!preview.delivers && <Alert severity="warning">{t("message.notReady")}</Alert>}
            {preview.nextAllowedAt !== null && <Alert severity="warning">{t("message.tooSoon", { time: time(preview.nextAllowedAt) })}</Alert>}
            {notice && <Alert severity="info">{notice}</Alert>}
            <Typography sx={{ fontWeight: 600 }} role="status">
              {preview.recipients === 0 ? t("message.recipientsNone") : preview.recipients === 1 ? t("message.recipientsOne") : t("message.recipients", { count: n(preview.recipients) })}
            </Typography>
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }} aria-label={t("message.preview")}>
              <Typography sx={{ fontWeight: 600, mb: 1, wordBreak: "break-word" }}>{preview.subject}</Typography>
              <Typography component="div" variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{preview.text}</Typography>
            </Paper>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <DialogContentText>{t("message.intro")}</DialogContentText>
            <FormControl>
              <FormLabel id="server-message-audience">{t("message.audience")}</FormLabel>
              <RadioGroup row aria-labelledby="server-message-audience" value={audience} onChange={(e) => setAudience(e.target.value as MessageAudience)}>
                <FormControlLabel value="coordinators" control={<Radio />} label={t("message.audience.coordinators")} />
                <FormControlLabel value="everyone" control={<Radio />} label={t("message.audience.everyone")} />
              </RadioGroup>
            </FormControl>
            <TextField label={t("message.subject")} value={subject} onChange={(e) => setSubject(e.target.value)} required slotProps={{ htmlInput: { maxLength: MAX_SUBJECT } }} />
            <TextField label={t("message.text")} value={text} onChange={(e) => setText(e.target.value)} required multiline minRows={6}
              helperText={`${t("message.textHelp")} ${n(text.length)} / ${n(MAX_TEXT)}`} slotProps={{ htmlInput: { maxLength: MAX_TEXT } }} />
          </Stack>
        )}
        <Box sx={{ mt: 2 }}><ErrorAlert error={error} /></Box>
      </DialogContent>
      <DialogActions>
        {sent !== null ? (
          <Button onClick={close} variant="contained">{t("common.close")}</Button>
        ) : preview ? (
          <>
            <Button onClick={() => { setPreview(null); setNotice(null); }} disabled={busy}>{t("message.edit")}</Button>
            <Button variant="contained" onClick={() => void send()} disabled={busy || blocked}>{t("message.send", { count: n(preview.recipients) })}</Button>
          </>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>{t("common.cancel")}</Button>
            <Button variant="contained" onClick={() => void look()} disabled={busy || !ready}>{t("message.preview")}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
