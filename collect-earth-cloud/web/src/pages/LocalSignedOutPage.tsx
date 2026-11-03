import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Public from "@mui/icons-material/Public";
import { AppShell } from "../components/AppShell";
import { useT } from "../i18n";

/**
 * The local mode (the dashboard on the person's own computer), not signed in: there is no
 * password to log in with. Collect Earth opens the dashboard signed in, with a one-time link.
 */
export function LocalSignedOutPage() {
  const t = useT();
  return (
    <AppShell narrow bare>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
          <Public color="primary" sx={{ fontSize: 48 }} aria-hidden />
          <Typography variant="h1">{t("local.signedOutTitle")}</Typography>
          <Typography color="text.secondary">{t("local.signedOut")}</Typography>
        </Stack>
      </Paper>
    </AppShell>
  );
}
