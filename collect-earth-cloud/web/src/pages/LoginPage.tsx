import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { login, signup } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { PasswordField } from "../components/PasswordField";
import { useT, type MessageKey } from "../i18n";
import { linkProps } from "../router";
import { passwordProblem, usernameProblem } from "../validation";

/**
 * Log in, or create an account when the server allows sign-up. Shown in place of any
 * page that needs an account, so after logging in the person lands where they meant to go.
 */
export function LoginPage({ mode, sessionEnded }: { mode: "login" | "signup"; sessionEnded?: boolean }) {
  const t = useT();
  const { info, loggedIn } = useApp();
  const signingUp = mode === "signup" && info.signupOpen;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    let found: MessageKey | null;
    if (signingUp) found = usernameProblem(username) ?? passwordProblem(password, repeated);
    else found = !username.trim() || !password ? "error.fillBoth" : null;
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      const session = signingUp ? await signup(username.trim(), password, email.trim() || undefined) : await login(username.trim(), password);
      await loggedIn(session);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell narrow>
      <FormCard
        title={signingUp ? t("signup.title") : t("login.title")}
        intro={signingUp ? t("signup.intro") : t("login.intro")}
        onSubmit={submit}
      >
        {sessionEnded && !signingUp && <Alert severity="info">{t("error.sessionEnded")}</Alert>}
        {mode === "signup" && !info.signupOpen && <Alert severity="info">{t("error.signupClosed")}</Alert>}
        <TextField
          label={t("common.username")}
          helperText={problem === "error.badUsername" ? t(problem) : signingUp ? t("signup.usernameHelp") : undefined}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          error={problem === "error.badUsername" || (problem === "error.fillBoth" && !username.trim())}
        />
        <PasswordField
          label={t("common.password")}
          helperText={problem === "error.weakPassword" ? t(problem) : signingUp ? t("signup.passwordHelp") : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={signingUp ? "new-password" : "current-password"}
          required
          error={problem === "error.weakPassword" || (problem === "error.fillBoth" && !password)}
        />
        {signingUp && (
          <>
            <PasswordField
              label={t("common.repeatPassword")}
              helperText={problem === "error.passwordsDiffer" ? t(problem) : undefined}
              value={repeated}
              onChange={(e) => setRepeated(e.target.value)}
              autoComplete="new-password"
              required
              error={problem === "error.passwordsDiffer"}
            />
            <TextField
              label={t("signup.email")}
              helperText={t("signup.emailHelp")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </>
        )}
        {problem === "error.fillBoth" && <Alert severity="warning" role="alert">{t(problem)}</Alert>}
        <ErrorAlert error={error} />
        <Button type="submit" variant="contained" size="large" disabled={busy}>
          {signingUp ? t("signup.submit") : t("login.submit")}
        </Button>
        {signingUp ? (
          <Typography>
            {t("signup.haveAccount")} <Link {...linkProps("/login")}>{t("login.submit")}</Link>
          </Typography>
        ) : (
          <>
            {info.signupOpen && (
              <Typography>
                {t("login.noAccount")} <Link {...linkProps("/signup")}>{t("login.createAccount")}</Link>
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {t("login.forgot")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("login.collectorHint")}
            </Typography>
          </>
        )}
      </FormCard>
    </AppShell>
  );
}
