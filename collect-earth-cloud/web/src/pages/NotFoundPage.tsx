import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n";
import { linkProps } from "../router";

export function NotFoundPage() {
  const t = useT();
  return (
    <AppShell>
      <Paper variant="outlined">
        <EmptyState
          heading
          title={t("notFound.title")}
          action={
            <Button variant="contained" {...linkProps("/")}>
              {t("notFound.home")}
            </Button>
          }
        >
          {t("notFound.text")}
        </EmptyState>
      </Paper>
    </AppShell>
  );
}
