import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { ApiError, forgotPassword, login, signup } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { FormCard } from "../components/FormCard";
import { PasswordField } from "../components/PasswordField";
import { useT, type MessageKey } from "../i18n";
import { linkProps } from "../router";
import { passwordProblem, usernameProblem } from "../validation";

/**
 * Log in, or create an account when the server allows sign-up. Shown in place of any
 * page that needs an account, so after logging in the person lands where they meant to go.
 */
export function LoginPage({ mode, sessionEnded }: { mode: "login" | "signup"; sessionEnded?: boolean }) {
  const t = useT();
  const { info, loggedIn, language } = useApp();
  const signingUp = mode === "signup" && info.signupOpen;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const needsTerms = signingUp && info.termsUrl !== null;
  const usernameRef = useRef<HTMLInputElement>(null);
  // Two-step sign-in: the server said this account needs a code after the password
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setError(null);
    let found: MessageKey | null;
    if (signingUp) {
      found = usernameProblem(username) ?? passwordProblem(password, repeated) ?? (needsTerms && !acceptTerms ? "error.termsNotAccepted" : null);
    } else found = !username.trim() || !password ? "error.fillBoth" : needsCode && !code.trim() ? "login.codeMissing" : null;
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      const session = signingUp
        ? await signup(username.trim(), password, email.trim() || undefined, needsTerms && acceptTerms, language)
        : await login(username.trim(), password, needsCode ? code.trim() : undefined);
      await loggedIn(session);
    } catch (err) {
      if (err instanceof ApiError && err.code === "second_step_required") {
        // Not an error: the password was right, the code comes next
        setNeedsCode(true);
        window.setTimeout(() => codeRef.current?.focus(), 0);
        return;
      }
      setError(err);
      if (needsCode) {
        setCode("");
        window.setTimeout(() => codeRef.current?.focus(), 0);
        return;
      }
      // The button pressed is disabled while busy and loses the focus: give it back to the form,
      // from the top (the error is announced as an alert).
      window.setTimeout(() => usernameRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell narrow>
      <FormCard
        title={signingUp ? t("signup.title") : t("login.title")}
        intro={signingUp ? t("signup.intro") : t("login.intro")}
        onSubmit={submit}
      >
        {sessionEnded && !signingUp && <Alert severity="info">{t("error.sessionEnded")}</Alert>}
        {mode === "signup" && !info.signupOpen && <Alert severity="info">{t("error.signupClosed")}</Alert>}
        <TextField
          label={t("common.username")}
          helperText={problem === "error.badUsername" ? t(problem) : signingUp ? t("signup.usernameHelp") : undefined}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          inputRef={usernameRef}
          autoFocus
          required
          error={problem === "error.badUsername" || (problem === "error.fillBoth" && !username.trim())}
        />
        <PasswordField
          label={t("common.password")}
          helperText={problem === "error.weakPassword" ? t(problem) : signingUp ? t("signup.passwordHelp") : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={signingUp ? "new-password" : "current-password"}
          required
          error={problem === "error.weakPassword" || (problem === "error.fillBoth" && !password)}
        />
        {needsCode && !signingUp && (
          <>
            <Alert severity="info">{t("login.codeIntro")}</Alert>
            <TextField
              label={t("login.code")}
              helperText={problem === "login.codeMissing" ? t(problem) : t("login.codeHelp")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputRef={codeRef}
              required
              error={problem === "login.codeMissing"}
              slotProps={{ htmlInput: { autoCapitalize: "characters", spellCheck: false, maxLength: 20 } }}
            />
          </>
        )}
        {signingUp && (
          <>
            <PasswordField
              label={t("common.repeatPassword")}
              helperText={problem === "error.passwordsDiffer" ? t(problem) : undefined}
              value={repeated}
              onChange={(e) => setRepeated(e.target.value)}
              autoComplete="new-password"
              required
              error={problem === "error.passwordsDiffer"}
            />
            <TextField
              label={t("signup.email")}
              helperText={t("signup.emailHelp")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {needsTerms && (
              <FormControl error={problem === "error.termsNotAccepted"} required>
                <FormControlLabel
                  control={<Checkbox checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required />}
                  label={t("signup.acceptTerms")}
                />
                <FormHelperText sx={{ ml: 0 }}>
                  <Link href={info.termsUrl!} target="_blank" rel="noopener noreferrer">
                    {t("signup.readTerms")}
                  </Link>
                </FormHelperText>
              </FormControl>
            )}
          </>
        )}
        {(problem === "error.fillBoth" || problem === "error.termsNotAccepted") && (
          <Alert severity="warning" role="alert">
            {t(problem)}
          </Alert>
        )}
        <ErrorAlert error={error} />
        <Button type="submit" variant="contained" size="large" disabled={busy}>
          {signingUp ? t("signup.submit") : t("login.submit")}
        </Button>
        {signingUp ? (
          <Typography>
            {t("signup.haveAccount")} <Link {...linkProps("/login")}>{t("login.submit")}</Link>
          </Typography>
        ) : (
          <>
            {info.signupOpen && (
              <Typography>
                {t("login.noAccount")} <Link {...linkProps("/signup")}>{t("login.createAccount")}</Link>
              </Typography>
            )}
            <div>
              <Link component="button" type="button" variant="body2" onClick={() => setForgotOpen((open) => !open)} aria-expanded={forgotOpen}>
                {t("login.forgotLink")}
              </Link>
              <Collapse in={forgotOpen}>
                {forgotOpen && <ForgotPassword initial={username.trim()} />}
              </Collapse>
            </div>
            <Typography variant="body2" color="text.secondary">
              {t("login.collectorHint")}
            </Typography>
          </>
        )}
      </FormCard>
    </AppShell>
  );
}

/** "Ask the person who runs this server", with their address when the server gives one. */
function ContactLink() {
  const t = useT();
  const { info } = useApp();
  if (!info.contactEmail) return null;
  return (
    <>
      {" "}
      <Link href={`mailto:${info.contactEmail}`}>{t("login.forgotContact", { email: info.contactEmail })}</Link>
    </>
  );
}

/**
 * "Forgot your password?": where the server sends email, a small form (username or email address)
 * asks for a reset link, mailed to the account's confirmed address; the answer never says whether
 * the account exists. Asking the person who runs the server stays as the other way. Elsewhere only
 * that. Inside the log-in form, so not a form of its own: Enter in its field sends it.
 */
function ForgotPassword({ initial }: { initial: string }) {
  const t = useT();
  const { info, language } = useApp();
  const [login, setLogin] = useState(initial);
  const [empty, setEmpty] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (!info.selfServiceReset) {
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        {t("login.forgotText")}
        <ContactLink />
      </Alert>
    );
  }

  const send = async () => {
    setError(null);
    if (!login.trim()) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    try {
      await forgotPassword(login.trim(), language);
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5} sx={{ mt: 1 }}>
      {sent ? (
        <Alert severity="success" role="status">
          {t("login.forgotSent")}
        </Alert>
      ) : (
        <>
          <Typography variant="body2">{t("login.forgotIntro")}</Typography>
          <TextField
            label={t("login.forgotLogin")}
            value={login}
            onChange={(e) => {
              setLogin(e.target.value);
              setEmpty(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            autoComplete="username"
            size="small"
            error={empty}
            helperText={empty ? t("login.forgotEmpty") : undefined}
          />
          <ErrorAlert error={error} />
          <Box>
            <Button type="button" variant="outlined" onClick={() => void send()} disabled={busy}>
              {t("login.forgotSend")}
            </Button>
          </Box>
        </>
      )}
      <Alert severity="info">
        {t("login.forgotOther")}
        <ContactLink />
      </Alert>
    </Stack>
  );
}
