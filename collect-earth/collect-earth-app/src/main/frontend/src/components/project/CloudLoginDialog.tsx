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
import { ApiError } from "../../apiClient";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";

/** `code`: two-step sign-in's code, once the server asked for it (cloud.secondStepRequired) */
export interface Credentials { username: string; password: string; register: boolean; code?: string }

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
  // Two-step sign-in: the server said this account needs its authenticator app's code after the password
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (open) { setPassword(""); setError(null); setBusy(false); setNeedsCode(false); setCode(""); }
  }, [open]);

  const submit = (register: boolean) => {
    if (!username.trim() || !password) { setError(s("CloudLoginDialog.emptyFields")); return; }
    if (needsCode && !register && !code.trim()) { setError(s("CloudLoginDialog.secondStepRequired")); return; }
    setBusy(true);
    setError(null);
    onSubmit({ username: username.trim(), password, register, ...(needsCode && !register ? { code: code.trim() } : {}) }).catch((e) => {
      if (e instanceof ApiError && e.code === "cloud.secondStepRequired") {
        // Not an error: the password was right, the code comes next
        setNeedsCode(true);
      } else {
        setError(errorText(e, t("appBar.unreachable")));
        if (needsCode) setCode("");
      }
      setBusy(false);
    });
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
            <TextField label={s("CloudLoginDialog.passwordLabel")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="current-password" />
            {needsCode && (
              <>
                <Alert severity="info">{s("CloudLoginDialog.secondStepRequired")}</Alert>
                <TextField autoFocus label={s("CloudLoginDialog.code")} helperText={s("CloudLoginDialog.codeHelp")} value={code} onChange={(e) => setCode(e.target.value)}
                  size="small" autoComplete="one-time-code" slotProps={{ htmlInput: { maxLength: 20, spellCheck: false } }} data-testid="cloud-login-code" />
              </>
            )}
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
