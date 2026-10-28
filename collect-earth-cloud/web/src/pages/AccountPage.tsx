import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Logout from "@mui/icons-material/Logout";
import { useState } from "react";
import { changePassword } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { PasswordField } from "../components/PasswordField";
import { useT, type MessageKey } from "../i18n";
import { passwordProblem } from "../validation";

export function AccountPage() {
  const t = useT();
  const { me, logOut } = useApp();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setDone(false);
    const found = !current ? "error.noCurrentPassword" : passwordProblem(password, repeated);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      await changePassword(current, password);
      setDone(true);
      setCurrent("");
      setPassword("");
      setRepeated("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell narrow>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h1" gutterBottom>
            {t("account.title")}
          </Typography>
          <Stack direction="row" sx={{ alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Typography color="text.secondary">{me && t("account.loggedInAs", { name: me.username })}</Typography>
            <Button startIcon={<Logout />} onClick={() => void logOut()}>
              {t("nav.logout")}
            </Button>
          </Stack>
        </Box>
        <FormCard title={t("account.changeTitle")} onSubmit={submit}>
          <PasswordField
            label={t("account.current")}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            error={problem === "error.noCurrentPassword"}
            helperText={problem === "error.noCurrentPassword" ? t(problem) : undefined}
          />
          <PasswordField
            label={t("common.newPassword")}
            helperText={problem === "error.weakPassword" ? t(problem) : t("signup.passwordHelp")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
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
          {done && (
            <Alert severity="success" role="status">
              {t("account.changed")}
            </Alert>
          )}
          <ErrorAlert error={error} />
          <Box>
            <Button type="submit" variant="contained" disabled={busy}>
              {t("account.changeSubmit")}
            </Button>
          </Box>
        </FormCard>
      </Stack>
    </AppShell>
  );
}
