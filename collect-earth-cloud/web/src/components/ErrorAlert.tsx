import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { errorMessageKey } from "../api";
import { useT } from "../i18n";

/** Any error as a plain sentence, with an optional "Try again". */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  if (!error) return null;
  return (
    <Alert
      severity="error"
      role="alert"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    >
      {t(errorMessageKey(error))}
    </Alert>
  );
}
