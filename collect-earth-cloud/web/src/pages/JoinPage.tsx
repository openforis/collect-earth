import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinkOff from "@mui/icons-material/LinkOff";
import { ApiError, previewInvite } from "../api";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { HeroPanel, WEBSITE_HEADING } from "../components/HeroPanel";
import { JoinSteps } from "../components/JoinSteps";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { pathFor } from "../router";
import { useLoad } from "../useLoad";

/** Public page an invitation link opens: what the invite is and how to use it in Collect Earth. */
export function JoinPage({ token }: { token: string }) {
  const t = useT();
  const preview = useLoad(["app", "previewInvite", token], () => previewInvite(token));
  const link = `${window.location.origin}${pathFor({ name: "join", token })}`;

  let body;
  // the steps of a usable invitation need a wider box than a message
  let steps = false;
  if (preview.loading && !preview.data) {
    body = <Loading />;
  } else if ((preview.error instanceof ApiError && (preview.error.status === 404 || preview.error.status === 410)) || preview.data?.valid === false) {
    body = (
      <EmptyState icon={<LinkOff color="error" />} title={t("join.invalidTitle")}>
        {t("join.invalid")}
      </EmptyState>
    );
  } else if (preview.error || !preview.data) {
    body = <ErrorAlert error={preview.error} onRetry={preview.reload} />;
  } else {
    steps = true;
    body = (
      <Stack spacing={2.5}>
        <Typography variant="h1" sx={WEBSITE_HEADING}>
          {t("join.title")}
        </Typography>
        <Typography sx={{ fontSize: "1.1rem" }}>
          {t("join.project", { project: preview.data.projectName, role: t(`role.${preview.data.role}`) })}
        </Typography>
        <Alert severity="info">{t("join.notHere")}</Alert>
        <Explain color="text.primary" text={t("join.coordinatorsSee.short")} more={t("join.coordinatorsSee")} />
        <Typography variant="h2" sx={WEBSITE_HEADING}>
          {t("join.stepsTitle")}
        </Typography>
        <JoinSteps link={link} />
      </Stack>
    );
  }

  // The website's look, as the log-in page (see HeroPanel): the invitation is often the first page a collector sees
  return (
    <AppShell hero>
      <HeroPanel wide={steps}>{body}</HeroPanel>
    </AppShell>
  );
}
