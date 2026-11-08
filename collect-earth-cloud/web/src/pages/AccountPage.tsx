import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DeleteForever from "@mui/icons-material/DeleteForever";
import Logout from "@mui/icons-material/Logout";
import { useState } from "react";
import { ApiError, changePassword, deleteAccount, getAccountDeletion, type ProjectRef } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { Loading } from "../components/Loading";
import { PasswordField } from "../components/PasswordField";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { MailCard } from "./MailCard";
import { TwoFactorCard } from "../components/TwoFactorCard";
import { useLoad } from "../useLoad";
import { passwordProblem } from "../validation";

export function AccountPage() {
  const t = useT();
  const { me, logOut, language } = useApp();
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
      // The server ends the other sessions (Collect Earth's too) and mails a notice in this language.
      await changePassword(current, password, language);
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
        <TwoFactorCard />
        <FormCard title={t("account.changeTitle")} onSubmit={submit} level={2}>
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
        <MailCard />
        <DeleteAccountCard />
      </Stack>
    </AppShell>
  );
}

function ProjectLinks({ projects, tab }: { projects: ProjectRef[]; tab: ProjectTab }) {
  return (
    <Box component="ul" sx={{ my: 1, pl: 3 }}>
      {projects.map((p) => (
        <li key={p.projectId}>
          <Link {...linkProps(pathFor({ name: "project", projectId: p.projectId, tab }))} sx={{ wordBreak: "break-word" }}>
            {p.name}
          </Link>
        </li>
      ))}
    </Box>
  );
}

/** Deleting one's own account, with what it would do said first. */
function DeleteAccountCard() {
  const t = useT();
  const { logOut } = useApp();
  const plan = useLoad(getAccountDeletion, []);
  const [password, setPassword] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!password) {
      setMissing(true);
      return;
    }
    setBusy(true);
    try {
      await deleteAccount(password);
      await logOut();
    } catch (err) {
      setError(err);
      setBusy(false);
      // The projects may have changed since the page opened: show the refusal's reasons.
      if (err instanceof ApiError && err.status === 409) plan.reload();
    }
  };

  let body;
  if (plan.loading && !plan.data) body = <Loading />;
  else if (plan.error || !plan.data) body = <ErrorAlert error={plan.error} onRetry={plan.reload} />;
  else if (plan.data.lastPlatformAdmin) body = <Alert severity="info">{t("account.deleteLastAdmin")}</Alert>;
  else if (plan.data.soleCoordinator.length > 0)
    body = (
      <Alert severity="warning">
        {t("account.deleteBlocked")}
        <ProjectLinks projects={plan.data.soleCoordinator} tab="people" />
      </Alert>
    );
  else
    body = (
      <>
        {plan.data.deletedWithAccount.length > 0 && (
          <Alert severity="warning">
            {t("account.deleteWithProjects")}
            <ProjectLinks projects={plan.data.deletedWithAccount} tab="data" />
          </Alert>
        )}
        <PasswordField
          label={t("account.deletePassword")}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setMissing(false);
          }}
          autoComplete="current-password"
          required
          error={missing}
          helperText={missing ? t("error.noCurrentPassword") : undefined}
        />
        <ErrorAlert error={error} />
        <Box>
          <Button type="submit" variant="contained" color="error" startIcon={<DeleteForever />} disabled={busy}>
            {t("account.deleteSubmit")}
          </Button>
        </Box>
      </>
    );

  return (
    <FormCard title={t("account.deleteTitle")} intro={t("account.deleteText")} onSubmit={submit} level={2}>
      {body}
    </FormCard>
  );
}
