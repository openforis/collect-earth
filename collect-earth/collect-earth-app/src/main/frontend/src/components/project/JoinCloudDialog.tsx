import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
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
import { joinPreviewText } from "../../cloud";
import { looksLikeInvitation } from "../../project";
import { cloudJoin, cloudPreview, type CloudPreview } from "../../projectApi";
import { serverText, type Texts } from "../../serverTexts";
import { RestartingOverlay } from "../settings/RestartingOverlay";
import { CloudLoginDialog } from "./CloudLoginDialog";

interface Props { open: boolean; texts: Texts | null; onClose: () => void }

type Step = "link" | "confirm" | "login";

/**
 * Join cloud project, in the steps of the Swing menu: the invitation link, what it is for (the project and the role,
 * from the server), the login or the registration, then the join and the restart.
 */
export function JoinCloudDialog({ open, texts, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("link");
  const [preview, setPreview] = useState<CloudPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [signInAgain, setSignInAgain] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setUrl(""); setStep("link"); setPreview(null); setError(null); setBusy(false); setSignInAgain(null); }
  }, [open]);

  const fail = (e: unknown) => { setError(errorText(e, t("appBar.unreachable"))); setBusy(false); };
  const check = () => {
    setBusy(true);
    setError(null);
    cloudPreview(url.trim()).then((p) => { setPreview(p); setStep("confirm"); setBusy(false); }, fail);
  };
  const join = async (credentials: { username: string; password: string; register: boolean; useAccount?: boolean }) => {
    if (!preview) return;
    const r = await cloudJoin({ baseUrl: preview.baseUrl, inviteToken: preview.inviteToken, projectId: preview.projectId, ...credentials });
    if (r.restart) setRestarting(true);
  };
  // Signed in to that server already: its account joins, no password; its sign-in ended, the login is asked for
  const joinAsAccount = () => {
    setBusy(true);
    setError(null);
    join({ username: "", password: "", register: false, useAccount: true }).catch((e) => {
      if (e instanceof ApiError && e.code === "cloud.signInAgain") { setSignInAgain(e.message); setStep("login"); setBusy(false); } else fail(e);
    });
  };

  if (restarting) return <RestartingOverlay text={s("SettingsPage.restarting")} />;
  if (step === "login" && preview) {
    return <CloudLoginDialog open={open} texts={texts} canRegister onSubmit={join} onCancel={onClose}
      intro={signInAgain ?? joinPreviewText(s("CloudJoin.previewMessage"), preview, t).split("\n")[0]} />;
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="join-cloud-dialog">
      <DialogTitle>{s("CloudJoin.urlPromptTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {step === "link" && (
            <TextField autoFocus fullWidth size="small" label={s("ProjectPage.join.link")} helperText={s("CloudJoin.urlPrompt")} value={url}
              onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && looksLikeInvitation(url)) check(); }} />
          )}
          {step === "confirm" && preview && (
            <DialogContentText sx={{ whiteSpace: "pre-line" }} data-testid="join-preview">
              {joinPreviewText(s("CloudJoin.previewMessage"), preview, t)}
            </DialogContentText>
          )}
          {step === "confirm" && preview?.account && (
            <Alert severity="info" data-testid="join-as-account">{t("cloud.join.as", { account: preview.account })}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{s("OptionWizard.24")}</Button>
        {step === "link" && <Button variant="contained" onClick={check} disabled={!looksLikeInvitation(url) || busy}>{s("ProjectPage.join.check")}</Button>}
        {step === "confirm" && preview?.account && <Button onClick={() => setStep("login")} disabled={busy}>{t("cloud.join.otherAccount")}</Button>}
        {step === "confirm" && preview?.account && <Button variant="contained" onClick={joinAsAccount} disabled={busy}>{t("cloud.join.join")}</Button>}
        {step === "confirm" && !preview?.account && <Button variant="contained" onClick={() => setStep("login")}>{s("ProjectPage.join.continue")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
