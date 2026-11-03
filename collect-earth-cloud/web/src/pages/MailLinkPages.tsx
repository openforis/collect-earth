import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useState } from "react";
import { ApiError, confirmEmail, errorMessageKey, unsubscribe, type DigestKind } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { FormCard } from "../components/FormCard";
import { useT, type MessageKey } from "../i18n";
import { linkProps } from "../router";

/** A link's error as a sentence: a link that is not one (404) says so. */
function linkError(error: unknown): MessageKey {
  return error instanceof ApiError && error.status === 404 ? "mail.linkInvalid" : errorMessageKey(error);
}

/**
 * The page a weekly email's "Stop these emails" link opens (/unsubscribe/<token>, no login). It asks
 * first: link checkers open links, and only a press turns the emails off. Mail programs' own
 * Unsubscribe button posts to the server directly (RFC 8058).
 */
export function UnsubscribePage({ token }: { token: string }) {
  const t = useT();
  const [done, setDone] = useState<DigestKind | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      setDone(await unsubscribe(token));
    } catch (err) {
      setError(linkError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell narrow bare>
      <FormCard title={t("mail.unsubscribeTitle")} intro={done ? undefined : t("mail.unsubscribeIntro")} onSubmit={() => void submit()}>
        {done ? (
          <Alert severity="success" role="status">
            {t(done === "coordinator" ? "mail.unsubscribedCoordinator" : "mail.unsubscribedCollector")}
          </Alert>
        ) : (
          <Box>
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {t("mail.unsubscribeSubmit")}
            </Button>
          </Box>
        )}
        {error && <Alert severity="error">{t(error)}</Alert>}
      </FormCard>
    </AppShell>
  );
}

/** The page an email confirmation link opens (/confirm-email/<token>, no login): a press confirms. */
export function ConfirmEmailPage({ token }: { token: string }) {
  const t = useT();
  const { me } = useApp();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await confirmEmail(token);
      setDone(true);
    } catch (err) {
      setError(linkError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell narrow bare={!me}>
      <FormCard title={t("mail.confirmTitle")} intro={done ? undefined : t("mail.confirmIntro")} onSubmit={() => void submit()}>
        {done ? (
          <>
            <Alert severity="success" role="status">
              {t("mail.confirmDone")}
            </Alert>
            <Box>
              <Button variant="contained" {...linkProps("/account")}>
                {t("mail.goAccount")}
              </Button>
            </Box>
          </>
        ) : (
          <Box>
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {t("mail.confirmSubmit")}
            </Button>
          </Box>
        )}
        {error && <Alert severity="error">{t(error)}</Alert>}
      </FormCard>
    </AppShell>
  );
}
