import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import Security from "@mui/icons-material/Security";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { disableTwoFactor, enableTwoFactor, newRecoveryCodes, startTwoFactor } from "../api";
import { useApp } from "../appContext";
import { useT } from "../i18n";
import { saveBlob } from "../saveBlob";
import { ErrorAlert } from "./ErrorAlert";
import { PasswordField } from "./PasswordField";

type Step = { kind: "idle" } | { kind: "scan"; secret: string; uri: string; qr: string | null } | { kind: "codes"; codes: string[] } | { kind: "password"; action: "disable" | "codes" };

/** The secret in groups of four, easier to type into an app by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * Two-step sign-in on the account page: set up with an authenticator app (a QR code, or the key to type), confirmed by
 * the app's first code; then ten recovery codes, shown once, to print or download. Afterwards: new recovery codes, or
 * off (both with the password; off is refused while the server requires it of the person).
 */
export function TwoFactorCard() {
  const t = useT();
  const { me, refreshMe, info } = useApp();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const enabled = me?.twoFactor.enabled ?? false;
  const required = me?.twoFactor.required ?? false;

  useEffect(() => {
    if (step.kind !== "scan" || step.qr) return;
    let live = true;
    QRCode.toDataURL(step.uri, { margin: 1, width: 220 }).then(
      (qr) => live && setStep((s) => (s.kind === "scan" ? { ...s, qr } : s)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [step]);

  const run = async (task: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const begin = () => run(async () => setStep({ kind: "scan", ...(await startTwoFactor()), qr: null }));
  const confirm = () =>
    run(async () => {
      const codes = await enableTwoFactor(code.replace(/\s/g, ""));
      setCode("");
      setStep({ kind: "codes", codes });
      await refreshMe();
    });
  const withPassword = (action: "disable" | "codes") =>
    run(async () => {
      if (action === "disable") {
        await disableTwoFactor(password);
        setStep({ kind: "idle" });
        await refreshMe();
      } else {
        setStep({ kind: "codes", codes: await newRecoveryCodes(password) });
      }
      setPassword("");
    });
  const download = (codes: string[]) =>
    saveBlob(
      new Blob([`${t("twoFactor.codesFileTitle", { server: info.serverName ?? t("app.title"), name: me?.username ?? "" })}\n\n${codes.join("\n")}\n\n${t("twoFactor.codesFileNote")}\n`], { type: "text/plain;charset=utf-8" }),
      "recovery-codes.txt",
    );

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Security color="primary" /> {t("twoFactor.title")}
        </Typography>
        <Typography color="text.secondary">{t("twoFactor.explain")}</Typography>
        {required && !enabled && <Alert severity="warning">{t("twoFactor.requiredNow")}</Alert>}
        {enabled && step.kind === "idle" && <Alert severity="success">{t("twoFactor.on")}</Alert>}

        {step.kind === "idle" && !enabled && (
          <Box>
            <Button variant="contained" onClick={() => void begin()} disabled={busy}>
              {t("twoFactor.start")}
            </Button>
          </Box>
        )}

        {step.kind === "scan" && (
          <Stack spacing={2}>
            <Typography>{t("twoFactor.scan")}</Typography>
            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
              {step.qr ? <img src={step.qr} width={220} height={220} alt={t("twoFactor.qrAlt")} /> : <Box sx={{ width: 220, height: 220 }} />}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary">
                  {t("twoFactor.typeKey")}
                </Typography>
                <Typography sx={{ fontFamily: "monospace", fontSize: "1.1rem", wordBreak: "break-all", mt: 0.5 }} aria-label={t("twoFactor.keyLabel")}>
                  {grouped(step.secret)}
                </Typography>
              </Box>
            </Box>
            <Box
              component="form"
              onSubmit={(e) => {
                e.preventDefault();
                void confirm();
              }}
              sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}
            >
              <TextField
                label={t("twoFactor.firstCode")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 7 } }}
                autoFocus
                sx={{ width: 200 }}
              />
              <Button type="submit" variant="contained" disabled={busy || code.replace(/\s/g, "").length !== 6} sx={{ mt: 1 }}>
                {t("twoFactor.confirm")}
              </Button>
              <Button onClick={() => setStep({ kind: "idle" })} sx={{ mt: 1 }}>
                {t("common.cancel")}
              </Button>
            </Box>
          </Stack>
        )}

        {step.kind === "codes" && (
          <Stack spacing={2}>
            <Alert severity="warning">{t("twoFactor.codesWarning")}</Alert>
            <Box component="ol" sx={{ fontFamily: "monospace", fontSize: "1.05rem", columns: 2, m: 0, pl: 4 }} aria-label={t("twoFactor.codesLabel")}>
              {step.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<Download />} onClick={() => download(step.codes)}>
                {t("twoFactor.downloadCodes")}
              </Button>
              <Button variant="contained" onClick={() => setStep({ kind: "idle" })}>
                {t("twoFactor.codesSaved")}
              </Button>
            </Box>
          </Stack>
        )}

        {step.kind === "idle" && enabled && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button variant="outlined" onClick={() => setStep({ kind: "password", action: "codes" })}>
              {t("twoFactor.newCodes")}
            </Button>
            {!required && (
              <Button color="error" onClick={() => setStep({ kind: "password", action: "disable" })}>
                {t("twoFactor.turnOff")}
              </Button>
            )}
          </Box>
        )}
        {enabled && required && step.kind === "idle" && (
          <Typography variant="body2" color="text.secondary">
            {t("twoFactor.cannotTurnOff")}
          </Typography>
        )}

        {step.kind === "password" && (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void withPassword(step.action);
            }}
            sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}
          >
            <PasswordField label={t("account.current")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
            <Button type="submit" variant="contained" color={step.action === "disable" ? "error" : "primary"} disabled={busy || !password} sx={{ mt: 1 }}>
              {t(step.action === "disable" ? "twoFactor.turnOff" : "twoFactor.newCodes")}
            </Button>
            <Button onClick={() => setStep({ kind: "idle" })} sx={{ mt: 1 }}>
              {t("common.cancel")}
            </Button>
          </Box>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Paper>
  );
}
