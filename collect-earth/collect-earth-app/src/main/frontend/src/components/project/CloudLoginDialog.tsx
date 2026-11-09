import { useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";

export interface Credentials { username: string; password: string; register: boolean }

/** The shortest password a new account may have: the cloud server's rule (CloudService.MIN_PASSWORD_LENGTH) */
export const MIN_PASSWORD_LENGTH = 8;

interface Props {
  open: boolean;
  texts: Texts | null;
  /** Said over the fields: the join's project, or why the login is asked for */
  intro?: string | null;
  /** The invitation offers to register as well (CloudLoginDialog of the Swing menu) */
  canRegister?: boolean;
  /** What to do with the credentials; rejects with the server's refusal, which the dialog shows */
  onSubmit: (credentials: Credentials) => Promise<void>;
  onCancel: () => void;
}

/** The cloud login (CloudLoginDialog): the user name and the password, Log in and, with an invitation, Register. */
export function CloudLoginDialog({ open, texts, intro, canRegister = false, onSubmit, onCancel }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setPassword(""); setError(null); setBusy(false); }
  }, [open]);

  const submit = (register: boolean) => {
    if (!username.trim() || !password) { setError(s("CloudLoginDialog.emptyFields")); return; }
    // Said before the server is asked, in the user's language: it refuses the same
    if (register && password.length < MIN_PASSWORD_LENGTH) { setError(s("CloudLoginDialog.passwordTooShort")); return; }
    setBusy(true);
    setError(null);
    onSubmit({ username: username.trim(), password, register }).catch((e) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); });
  };
  const onEnter = (e: FormEvent) => { e.preventDefault(); submit(false); };

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs" data-testid="cloud-login-dialog">
      <Box component="form" onSubmit={onEnter}>
        <DialogTitle>{s("CloudLoginDialog.title")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {intro && <DialogContentText sx={{ whiteSpace: "pre-line" }}>{intro}</DialogContentText>}
            {error && <Alert severity="error">{error}</Alert>}
            <TextField autoFocus label={s("CloudLoginDialog.usernameLabel")} value={username} onChange={(e) => setUsername(e.target.value)} size="small" autoComplete="username" />
            {/* With an invitation the password may be a new account's: its rule said under it */}
            <TextField label={s("CloudLoginDialog.passwordLabel")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="current-password"
              helperText={canRegister ? s("CloudLoginDialog.passwordHint") : undefined} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel} disabled={busy}>{s("CloudLoginDialog.cancelButton")}</Button>
          {canRegister && <Button onClick={() => submit(true)} disabled={busy}>{s("CloudLoginDialog.registerButton")}</Button>}
          <Button type="submit" variant="contained" disabled={busy}>{s("CloudLoginDialog.loginButton")}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
