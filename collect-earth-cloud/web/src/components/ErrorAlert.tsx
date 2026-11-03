import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { ApiError, errorMessageKey } from "../api";
import { useT } from "../i18n";

/** Any error as a plain sentence, with an optional "Try again". */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  if (!error) return null;
  const key = errorMessageKey(error);
  // A generic sentence says little: the server's own reason (in English) tells what to fix.
  // Trying again cannot help when the answer is "not allowed" or "not there".
  const retry = onRetry && !(error instanceof ApiError && (error.status === 403 || error.status === 404)) ? onRetry : undefined;
  const reason = (key === "error.badRequest" || key === "error.unknown") && error instanceof ApiError ? error.reason : null;
  return (
    <Alert
      severity="error"
      role="alert"
      action={
        retry ? (
          <Button color="inherit" size="small" onClick={retry}>
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    >
      {t(key)}
      {reason && (
        <Box component="span" sx={{ display: "block", mt: 0.5 }}>
          {t("error.serverSaid", { reason })}
        </Box>
      )}
    </Alert>
  );
}
