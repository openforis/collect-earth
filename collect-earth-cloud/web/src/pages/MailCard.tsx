import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { getNotifications, sendEmailConfirmation, setEmail, setNotifications, type DigestKind, type Notifications } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { PasswordField } from "../components/PasswordField";
import { Loading } from "../components/Loading";
import { isLanguage, LANGUAGE_NAMES, useT } from "../i18n";
import { useLoad } from "../useLoad";
import { weekRangeText } from "../activityView";

/** The browser's time zone (the mails' days), or null when it cannot be had. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** The weekly emails (Task 19): the account's address, its confirmation and the digests, off by default. */
export function MailCard() {
  const t = useT();
  const { language } = useApp();
  const loaded = useLoad(getNotifications, []);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // A change of address asks for the password (the reset links go to it); Remove first asks for it too.
  const [password, setPassword] = useState("");
  const [removing, setRemoving] = useState(false);
  // The address field takes the focus back when the button pressed goes away (Remove, Send again).
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (loaded.loading && !loaded.data) return <Loading />;
  if (loaded.error || !loaded.data) return <ErrorAlert error={loaded.error} onRetry={loaded.reload} />;
  const n: Notifications = loaded.data;
  const typed = address ?? n.email ?? "";
  const changed = typed.trim() !== (n.email ?? "");
  const askPassword = changed || removing;

  // One change at a time; the buttons and switches stay enabled (a disabled control drops the keyboard focus).
  const run = async (action: () => Promise<string | null>) => {
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      setStatus(await action());
    } catch (err) {
      setError(err);
      // A refusal may come after a change (an address saved, its mail not sent): show what is stored.
      loaded.reload();
    } finally {
      setBusy(false);
    }
  };

  const saveAddress = (remove: boolean) => {
    if (!remove && !changed) return Promise.resolve();
    // Remove shows the password field first; the form's own check asks for it on Save
    if (remove && !password) {
      setRemoving(true);
      window.setTimeout(() => passwordRef.current?.focus(), 0);
      return Promise.resolve();
    }
    return run(async () => {
      const email = remove ? null : typed.trim() || null;
      const next = await setEmail(email, language, password);
      loaded.setData(next);
      setAddress(null);
      setPassword("");
      setRemoving(false);
      if (next.email === null) {
        window.setTimeout(() => emailRef.current?.focus(), 0);
        return t("mail.removed");
      }
      if (next.email === n.email) return t("mail.changed");
      return next.sends ? t("mail.saved", { email: next.email }) : t("mail.savedNotSent");
    });
  };

  const resend = () =>
    run(async () => {
      await sendEmailConfirmation(language);
      return t("mail.resent", { email: n.email ?? "" });
    });

  const toggle = (kind: DigestKind, on: boolean) =>
    run(async () => {
      // No zone from the browser: none is sent, and the stored one stays.
      loaded.setData(await setNotifications({ [kind]: on, language, timeZone: browserTimeZone() ?? undefined }));
      return t("mail.changed");
    });

  const kinds: { kind: DigestKind; label: string; help: string }[] = [
    { kind: "coordinator", label: t("mail.coordinator"), help: t("mail.coordinatorHelp") },
    { kind: "collector", label: t("mail.collector"), help: t("mail.collectorHelp") },
  ];
  const shown = kinds.filter((k) => n.roles[k.kind] || n.digests[k.kind].on || n.digests[k.kind].stopped);
  const anyOn = n.digests.coordinator.on || n.digests.collector.on;
  const writtenIn = n.language && isLanguage(n.language) ? LANGUAGE_NAMES[n.language] : LANGUAGE_NAMES.en;

  return (
    <FormCard title={t("mail.title")} intro={t("mail.intro")} onSubmit={() => void saveAddress(false)} level={2}>
      {!n.sends && <Alert severity="info">{t("mail.notSending")}</Alert>}
      <TextField
        label={t("mail.emailLabel")}
        type="email"
        autoComplete="email"
        value={typed}
        onChange={(e) => setAddress(e.target.value)}
        helperText={t("mail.emailHelp")}
        inputRef={emailRef}
        slotProps={{ htmlInput: { maxLength: 254 } }}
      />
      {askPassword && (
        <PasswordField
          label={t("account.current")}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helperText={t("mail.passwordHelp")}
          inputRef={passwordRef}
        />
      )}
      {n.email !== null && address === null && !n.emailValid && <Alert severity="warning">{t("mail.invalidStored")}</Alert>}
      {n.email !== null && address === null && n.emailValid && (
        <Alert severity={n.emailConfirmed ? "success" : "warning"}>
          {n.emailConfirmed ? t("mail.confirmed") : t("mail.notConfirmed", { email: n.email })}
        </Alert>
      )}
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <Button type="submit" variant="contained" aria-disabled={busy || typed.trim() === (n.email ?? "")}>
          {t("mail.save")}
        </Button>
        {n.email !== null && n.emailValid && !n.emailConfirmed && (
          <Button onClick={() => void resend()} aria-disabled={busy}>
            {t("mail.resend")}
          </Button>
        )}
        {n.email !== null && (
          <Button color="error" onClick={() => void saveAddress(true)} aria-disabled={busy}>
            {t("mail.remove")}
          </Button>
        )}
      </Stack>

      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
        <Typography component="legend" variant="h3" sx={{ mb: 1 }}>
          {t("mail.choose")}
        </Typography>
        {shown.length === 0 && <Typography color="text.secondary">{t("mail.noProjects")}</Typography>}
        <Stack spacing={1.5}>
          {shown.map(({ kind, label, help }) => (
            <Box key={kind}>
              <FormControlLabel
                control={
                  <Switch
                    checked={n.digests[kind].on}
                    disabled={(n.email === null || !n.emailValid) && !n.digests[kind].on}
                    onChange={(e) => void toggle(kind, e.target.checked)}
                    slotProps={{ input: { "aria-describedby": `mail-${kind}-help` } }}
                  />
                }
                label={label}
              />
              <FormHelperText id={`mail-${kind}-help`} sx={{ ml: 0 }}>
                {n.email === null ? t("mail.needEmail") : help}
                {/* Only a week a mail actually went for (a week with nothing to tell is not one). */}
                {n.digests[kind].lastMailedWeek && ` ${t("mail.lastSent", { range: weekRangeText(n.digests[kind].lastMailedWeek ?? "", language) })}`}
              </FormHelperText>
              {n.digests[kind].stopped && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {t("mail.stopped")}
                </Alert>
              )}
            </Box>
          ))}
        </Stack>
      </Box>
      {anyOn && (
        <Typography variant="body2" color="text.secondary">
          {t("mail.written", { language: writtenIn, zone: n.timeZone ?? "UTC" })} {t("mail.stopAny")}
        </Typography>
      )}
      {/* Mounted from the start, so screen readers announce what is put in it. */}
      <Box role="status" aria-live="polite">
        {/* role none: the box around it is the live region (an Alert is one of its own, said twice). */}
        {status && (
          <Alert severity="success" role="none">
            {status}
          </Alert>
        )}
      </Box>
      <ErrorAlert error={error} />
    </FormCard>
  );
}
