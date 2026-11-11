import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import { errorText } from "../../appBar";
import type { CloudAccount } from "../../cloud";
import { useT } from "../../i18n";
import { APP_INFO_CHANGED } from "../../notices";
import { cloudSignOut, cloudState } from "../../projectApi";

/**
 * The cloud servers this computer is signed in to (GET /api/cloud/state), one account each, with Sign out, asked first:
 * the plots of the cloud projects on that server wait on this computer until the next sign-in.
 */
export function CloudAccountsCard() {
  const t = useT();
  const [accounts, setAccounts] = useState<CloudAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The account asked about: kept while the question fades out, so its title does not change meanwhile
  const [asked, setAsked] = useState<CloudAccount | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    cloudState(controller.signal).then((s) => setAccounts(s.accounts), (e) => { if (!controller.signal.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    return () => controller.abort();
  }, [t]);

  const signOut = (account: CloudAccount) => {
    setBusy(true);
    setError(null);
    cloudSignOut(account.server).then((s) => {
      setAccounts(s.accounts);
      // The app bar reads again who is signed in, and the project chip its state
      window.dispatchEvent(new Event(APP_INFO_CHANGED));
    }, (e) => setError(errorText(e, t("appBar.unreachable")))).finally(() => { setBusy(false); setAsking(false); });
  };
  const serverOf = (a: CloudAccount) => a.serverName || a.server;

  return (
    <Stack spacing={1.5} data-testid="cloud-accounts">
      <Typography variant="subtitle2">{t("cloud.accounts.title")}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {accounts === null && !error && <LinearProgress />}
      {accounts?.length === 0 && <Typography variant="body2" color="text.secondary">{t("cloud.accounts.none")}</Typography>}
      {accounts?.map((a) => (
        <Paper key={a.server} variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ flex: "1 1 200px", minWidth: 0, wordBreak: "break-word" }} title={a.server}>
            {t("cloud.accounts.signedIn", { server: serverOf(a), username: a.username })}
          </Typography>
          <Button variant="outlined" size="small" startIcon={<LogoutOutlinedIcon />} disabled={busy}
            onClick={() => { setAsked(a); setAsking(true); }}>
            {t("cloud.accounts.signOut")}
          </Button>
        </Paper>
      ))}
      <Dialog open={asking} onClose={busy ? undefined : () => setAsking(false)} maxWidth="xs" data-testid="cloud-sign-out">
        <DialogTitle>{t("cloud.accounts.confirmTitle", { server: asked ? serverOf(asked) : "" })}</DialogTitle>
        <DialogContent><DialogContentText>{t("cloud.accounts.confirm")}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(false)} disabled={busy} autoFocus>{t("appBar.cancel")}</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => { if (asked) signOut(asked); }}>{t("cloud.accounts.signOut")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
