import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { ApiError, setup } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { PasswordField } from "../components/PasswordField";
import { useT, type MessageKey } from "../i18n";
import { navigate } from "../router";
import { passwordProblem, usernameProblem } from "../validation";

/** First run: the owner of the server creates the server administrator account. */
export function SetupPage() {
  const t = useT();
  const { loggedIn, refreshInfo } = useApp();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const found = !code.trim() ? "error.noSetupCode" : (usernameProblem(username) ?? passwordProblem(password, repeated));
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      const session = await setup(code.trim(), username.trim(), password);
      await refreshInfo();
      await loggedIn(session);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.code === "already_set_up") await refreshInfo();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell narrow>
      <FormCard title={t("setup.title")} intro={t("setup.intro")} onSubmit={submit}>
        <Alert severity="info" icon={false}>
          <AlertTitle>{t("setup.whereTitle")}</AlertTitle>
          <p style={{ margin: "0 0 8px" }}>{t("setup.whereGoogle")}</p>
          <p style={{ margin: 0 }}>{t("setup.whereOther")}</p>
        </Alert>
        <TextField
          label={t("setup.codeLabel")}
          helperText={t("setup.codeHelp")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          required
          error={problem === "error.noSetupCode"}
        />
        <TextField
          label={t("setup.adminUsername")}
          helperText={problem === "error.badUsername" ? t(problem) : t("signup.usernameHelp")}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          error={problem === "error.badUsername"}
        />
        <PasswordField
          label={t("common.password")}
          helperText={problem === "error.weakPassword" ? t(problem) : t("signup.passwordHelp")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          error={problem === "error.weakPassword"}
        />
        <PasswordField
          label={t("common.repeatPassword")}
          helperText={problem === "error.passwordsDiffer" ? t(problem) : " "}
          value={repeated}
          onChange={(e) => setRepeated(e.target.value)}
          autoComplete="new-password"
          required
          error={problem === "error.passwordsDiffer"}
        />
        {problem === "error.noSetupCode" && <Alert severity="warning" role="alert">{t(problem)}</Alert>}
        <ErrorAlert error={error} />
        <Button type="submit" variant="contained" size="large" disabled={busy}>
          {t("setup.submit")}
        </Button>
      </FormCard>
    </AppShell>
  );
}
