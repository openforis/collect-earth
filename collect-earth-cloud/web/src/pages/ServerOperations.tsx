import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import Download from "@mui/icons-material/Download";
import Send from "@mui/icons-material/Send";
import WarningAmber from "@mui/icons-material/WarningAmber";
import { useState, type ReactNode } from "react";
import {
  ApiError,
  downloadServerActivity,
  getMailCheck,
  getServerActivity,
  sendTestMail,
  SERVER_ACTION_KINDS,
  type CollectEarthVersions,
  type ServerActionKind,
  type ServerActivityQuery,
} from "../api";
import { useApp } from "../appContext";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, pathFor } from "../router";
import { saveBlob } from "../saveBlob";
import { sinceText } from "../serverAccountsView";
import { activitySentence } from "../serverOpsView";
import type { Loaded } from "../useLoad";
import { useLoad } from "../useLoad";

function Card({ id, title, intro, action, children }: { id: string; title: string; intro?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby={id}>
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
          <Typography variant="h2" id={id}>{title}</Typography>
          {action}
        </Stack>
        {intro && <Typography color="text.secondary" variant="body2">{intro}</Typography>}
        {children}
      </Stack>
    </Paper>
  );
}

/** The Collect Earth versions the accounts use (GET /v1/admin/versions), loaded by the page for its health line too. */
export function VersionsCard({ versions }: { versions: Loaded<CollectEarthVersions> }) {
  const t = useT();
  const { language } = useApp();
  const v = versions.data;
  const n = (x: number) => formatNumber(x, language);
  return (
    <Card id="server-versions" title={t("versions.title")} intro={v ? t("versions.intro", { days: n(v.days) }) : undefined}>
      {versions.loading && !v ? (
        <Loading />
      ) : versions.error || !v ? (
        <ErrorAlert error={versions.error} onRetry={versions.reload} />
      ) : v.versions.length === 0 ? (
        <Typography>{t("versions.none", { days: n(v.days) })}</Typography>
      ) : (
        <>
          {v.outdatedAccounts > 0 ? (
            <Alert severity="warning">{t("versions.outdatedHelp", { count: n(v.outdatedAccounts) })}</Alert>
          ) : (
            <Alert severity="success" icon={<CheckCircleOutline />}>{t("versions.allCurrent")}</Alert>
          )}
          {v.latest && <Typography variant="body2">{t(v.latestConfigured ? "versions.latestSet" : "versions.latest", { version: v.latest })}</Typography>}
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("versions.version")}</TableCell>
                  <TableCell align="right">{t("versions.accounts")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {v.versions.map((row) => (
                  <TableRow key={`${row.kind}:${row.version ?? ""}`}>
                    <TableCell component="th" scope="row">
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                        <span>{row.kind === "old" ? t("versions.old") : row.kind === "unnamed" ? t("versions.unnamed") : row.version}</span>
                        {row.outdated && <Chip size="small" color="warning" icon={<WarningAmber />} label={t("versions.outdated")} />}
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{n(row.accounts)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Card>
  );
}

/** Whether the server sends mail, a test email to oneself, and the weekly emails stopped by refusals. */
export function MailCard() {
  const t = useT();
  const { language } = useApp();
  const check = useLoad(() => getMailCheck(), []);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ severity: "success" | "error"; text: string } | null>(null);
  const m = check.data;

  const test = async () => {
    setSending(true);
    setResult(null);
    try {
      const { to } = await sendTestMail(language);
      setResult({ severity: "success", text: t("mailCheck.testSent", { email: to }) });
    } catch (err) {
      if (err instanceof ApiError && err.code === "mail_refused") {
        const code = String(err.details.responseCode ?? err.details.code ?? "?");
        setResult({ severity: "error", text: err.details.senderLimit === true ? t("mailCheck.testSenderLimit") : t("mailCheck.testRefused", { code }) });
      } else {
        setResult({ severity: "error", text: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Card id="server-mail" title={t("mailCheck.title")}>
      {check.loading && !m ? (
        <Loading />
      ) : check.error || !m ? (
        <ErrorAlert error={check.error} onRetry={check.reload} />
      ) : (
        <>
          {m.delivers ? <Alert severity="success" icon={<CheckCircleOutline />}>{t("mailCheck.ready")}</Alert> : <Alert severity="warning">{t("mailCheck.notReady")}</Alert>}
          {m.delivers && (
            <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "max-content 1fr" }, columnGap: 2, rowGap: 0.5, "& dt": { color: "text.secondary" }, "& dd": { m: 0, wordBreak: "break-word" } }}>
              {m.from && (<><dt>{t("mailCheck.from")}</dt><dd>{m.from}</dd></>)}
              {m.server && (<><dt>{t("mailCheck.server")}</dt><dd>{m.server.host}{m.server.port ? `:${m.server.port}` : ""}</dd></>)}
              <dt>{t("mailCheck.weekly")}</dt>
              <dd>{t(m.digestJob ? "mailCheck.weeklyOn" : "mailCheck.weeklyOff")}</dd>
            </Box>
          )}
          {m.delivers && (
            <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
              {m.ownAddress ? (
                <Typography variant="body2">{t("mailCheck.testTo", { email: m.ownAddress })}</Typography>
              ) : (
                <Typography variant="body2">
                  <Link {...linkProps(pathFor({ name: "account" }))}>{t("mailCheck.testNoAddress")}</Link>
                </Typography>
              )}
              <Button variant="outlined" startIcon={<Send />} disabled={sending || !m.ownAddress} onClick={() => void test()}>{t("mailCheck.test")}</Button>
              {result && <Alert severity={result.severity} role="status" onClose={() => setResult(null)} sx={{ alignSelf: "stretch" }}>{result.text}</Alert>}
            </Stack>
          )}
          <section aria-labelledby="server-mail-stopped">
            <Typography variant="h3" id="server-mail-stopped" sx={{ fontSize: "1rem", fontWeight: 600, mb: 0.5 }}>{t("mailCheck.stoppedTitle")}</Typography>
            {m.stopped.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t("mailCheck.stoppedNone")}</Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">{t("mailCheck.stoppedIntro")}</Typography>
                <List dense disablePadding>
                  {m.stopped.map((s) => (
                    <ListItem key={`${s.userId}:${s.kind}`} divider sx={{ px: 0 }}>
                      <ListItemText
                        primary={`${s.username} · ${s.email ?? t("mailCheck.noAddress")}`}
                        secondary={`${t(`mailCheck.kind.${s.kind}`)} · ${t("mailCheck.stoppedOn", { when: sinceText(s.stoppedAt, Date.now(), language), count: formatNumber(s.failures, language) })}`}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </section>
        </>
      )}
    </Card>
  );
}

const ACTIVITY_PAGE = 25;

/** The server activity log (GET /v1/admin/activity): by person and kind, in pages, as CSV. */
export function ActivityCard() {
  const t = useT();
  const { language } = useApp();
  const [query, setQuery] = useState<ServerActivityQuery>({ actor: "", kind: "", page: 1, pageSize: ACTIVITY_PAGE });
  const log = useLoad(() => getServerActivity(query), [query]);
  const [error, setError] = useState<unknown>(null);
  const page = log.data;
  const n = (x: number) => formatNumber(x, language);

  const download = async () => {
    setError(null);
    try {
      const { blob, filename } = await downloadServerActivity({ actor: query.actor, kind: query.kind });
      saveBlob(blob, filename);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card id="server-activity" title={t("serverLog.title")} intro={t("serverLog.intro")}
      action={<Button variant="outlined" startIcon={<Download />} onClick={() => void download()} disabled={!page || page.total === 0}>{t("serverLog.csv")}</Button>}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField select size="small" label={t("serverLog.by")} value={query.actor} onChange={(e) => setQuery({ ...query, actor: e.target.value, page: 1 })} sx={{ minWidth: 200 }}
          slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">{t("serverLog.anyone")}</MenuItem>
          {(page?.actors ?? []).map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
        </TextField>
        <TextField select size="small" label={t("serverLog.kind")} value={query.kind} onChange={(e) => setQuery({ ...query, kind: e.target.value as ServerActionKind | "", page: 1 })} sx={{ minWidth: 200 }}
          slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">{t("serverLog.kind.all")}</MenuItem>
          {SERVER_ACTION_KINDS.map((k) => <MenuItem key={k} value={k}>{t(`serverLog.kind.${k}`)}</MenuItem>)}
        </TextField>
      </Stack>
      <ErrorAlert error={error} />
      {log.loading && !page ? (
        <Loading />
      ) : log.error || !page ? (
        <ErrorAlert error={log.error} onRetry={log.reload} />
      ) : page.entries.length === 0 ? (
        <EmptyState title={query.actor || query.kind ? t("serverLog.noneFound") : t("serverLog.none")} />
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" role="status">
            {t("serverLog.shown", { from: n((page.page - 1) * page.pageSize + 1), to: n((page.page - 1) * page.pageSize + page.entries.length), total: n(page.total) })}
          </Typography>
          <List dense disablePadding sx={{ opacity: log.loading ? 0.6 : 1 }}>
            {page.entries.map((e) => (
              <ListItem key={e.id} divider sx={{ px: 0 }}>
                <ListItemText
                  primary={activitySentence(t, e, language)}
                  secondary={<time dateTime={new Date(e.at).toISOString()} title={formatDate(e.at, language)}>{sinceText(e.at, Date.now(), language)} · {formatDate(e.at, language)}</time>}
                  slotProps={{ primary: { sx: { wordBreak: "break-word" } } }}
                />
              </ListItem>
            ))}
          </List>
          {page.pages > 1 && (
            <Pagination count={page.pages} page={page.page} onChange={(_, p) => setQuery({ ...query, page: p })} sx={{ alignSelf: "center" }}
              getItemAriaLabel={(type, p) => (type === "page" ? t("accounts.page", { page: String(p) }) : t(`accounts.pageNav.${type}`))} />
          )}
        </>
      )}
    </Card>
  );
}
