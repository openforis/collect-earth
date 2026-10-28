import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { useState } from "react";
import { resetPassword } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { PasswordField } from "../components/PasswordField";
import { useT, type MessageKey } from "../i18n";
import { linkProps } from "../router";
import { passwordProblem } from "../validation";

/** Public page a password reset link opens. */
export function ResetPage({ token }: { token: string }) {
  const t = useT();
  const { me, refreshMe } = useApp();
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const found = passwordProblem(password, repeated);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      // The reset ends every session of that account: if it was ours, the check below
      // finds the session gone and the page goes back to logging in.
      if (me) await refreshMe().catch(() => undefined);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell narrow>
      <FormCard title={t("reset.title")} intro={done ? undefined : t("reset.intro")} onSubmit={submit}>
        {done ? (
          <>
            <Alert severity="success" role="status">
              {t("reset.done")}
            </Alert>
            <Button variant="contained" size="large" {...linkProps("/login")}>
              {t("reset.goLogin")}
            </Button>
          </>
        ) : (
          <>
            <PasswordField
              label={t("common.newPassword")}
              helperText={problem === "error.weakPassword" ? t(problem) : t("signup.passwordHelp")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              required
              error={problem === "error.weakPassword"}
            />
            <PasswordField
              label={t("common.repeatPassword")}
              helperText={problem === "error.passwordsDiffer" ? t(problem) : undefined}
              value={repeated}
              onChange={(e) => setRepeated(e.target.value)}
              autoComplete="new-password"
              required
              error={problem === "error.passwordsDiffer"}
            />
            <ErrorAlert error={error} />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {t("reset.submit")}
            </Button>
          </>
        )}
      </FormCard>
    </AppShell>
  );
}
