import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinkOff from "@mui/icons-material/LinkOff";
import { ApiError, previewInvite } from "../api";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { JoinSteps } from "../components/JoinSteps";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { pathFor } from "../router";
import { useLoad } from "../useLoad";

/** Public page an invitation link opens: what the invite is and how to use it in Collect Earth. */
export function JoinPage({ token }: { token: string }) {
  const t = useT();
  const preview = useLoad(() => previewInvite(token), [token]);
  const link = `${window.location.origin}${pathFor({ name: "join", token })}`;

  let body;
  if (preview.loading && !preview.data) {
    body = <Loading />;
  } else if ((preview.error instanceof ApiError && (preview.error.status === 404 || preview.error.status === 410)) || preview.data?.valid === false) {
    body = (
      <Paper variant="outlined">
        <EmptyState icon={<LinkOff color="error" />} title={t("join.invalidTitle")}>
          {t("join.invalid")}
        </EmptyState>
      </Paper>
    );
  } else if (preview.error || !preview.data) {
    body = <ErrorAlert error={preview.error} onRetry={preview.reload} />;
  } else {
    body = (
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Typography variant="h1">{t("join.title")}</Typography>
          <Typography sx={{ fontSize: "1.1rem" }}>
            {t("join.project", { project: preview.data.projectName, role: t(`role.${preview.data.role}`) })}
          </Typography>
          <Alert severity="info">{t("join.notHere")}</Alert>
          <Typography>{t("join.coordinatorsSee")}</Typography>
          <Typography variant="h2">{t("join.stepsTitle")}</Typography>
          <JoinSteps link={link} />
        </Stack>
      </Paper>
    );
  }

  return <AppShell>{body}</AppShell>;
}
