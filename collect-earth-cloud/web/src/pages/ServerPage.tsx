import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Key from "@mui/icons-material/Key";
import Block from "@mui/icons-material/Block";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "@mui/material/Link";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import Dns from "@mui/icons-material/Dns";
import FolderOpen from "@mui/icons-material/FolderOpen";
import Insights from "@mui/icons-material/Insights";
import People from "@mui/icons-material/People";
import Tune from "@mui/icons-material/Tune";
import {
  getAiUsage,
  getServerOverview,
  listUsers,
  makeResetLink,
  resetUserTwoFactor,
  getOwnerAlerts,
  type OwnerAlert,
  setUserDisabled,
  type AdminUser,
  type AiUsageCounts,
  type ResetLink,
  type ServerOverview,
} from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { CopyField } from "../components/CopyField";
import { ChartOrTable, ColumnChart, ValuesTable } from "../components/PeopleCharts";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain, MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatBytes, formatDate, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { useLoad } from "../useLoad";
import { linkProps, navigate, pathFor, setLeaveGuard, SERVER_SECTIONS, type ServerSection } from "../router";
import { serverHealth, type HealthItem } from "../serverView";
import { clearUnsaved, useUnsavedGroups } from "../unsavedChanges";
import { ServerSettingsSection } from "./ServerSettings";

/** The assistant's use this month, by project id only (no names, questions or answers). */
function AiUsageCard() {
  const t = useT();
  const { language } = useApp();
  const usage = useLoad(getAiUsage, []);
  const n = (value: number) => formatNumber(value, language);
  const columns: { key: keyof AiUsageCounts; label: MessageKey }[] = [
    { key: "runs", label: "server.aiRuns" },
    { key: "reports", label: "server.aiReportsCol" },
    { key: "followUps", label: "server.aiFollowUpsCol" },
    { key: "questions", label: "server.aiQuestionsCol" },
    { key: "failed", label: "server.aiFailedCol" },
    { key: "refused", label: "server.aiRefusedCol" },
    { key: "tokens", label: "server.aiTokensCol" },
  ];
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="server-ai-usage">
      <Typography variant="h2" gutterBottom id="server-ai-usage">
        {t("server.aiUsageTitle")}
      </Typography>
      {usage.loading && !usage.data ? (
        <Loading />
      ) : usage.error || !usage.data ? (
        <ErrorAlert error={usage.error} onRetry={usage.reload} />
      ) : (
        <Stack spacing={2}>
          <Typography color="text.secondary" variant="body2">
            {t("server.aiUsageIntro", { month: usage.data.month })}
          </Typography>
          {usage.data.projects.length === 0 ? (
            <Typography>{t("server.aiUsageEmpty")}</Typography>
          ) : (
            <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t("server.aiProject")}</TableCell>
                    {columns.map((c) => (
                      <TableCell key={c.key} align="right">
                        {t(c.label)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {usage.data.projects.map((row) => (
                    <TableRow key={row.projectId}>
                      <TableCell component="th" scope="row" sx={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all", minWidth: 140 }}>
                        {row.projectId}
                      </TableCell>
                      {columns.map((c) => (
                        <TableCell key={c.key} align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                          {n(row[c.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell component="th" scope="row" sx={{ fontWeight: 600 }}>
                      {t("server.aiTotal")}
                    </TableCell>
                    {columns.map((c) => (
                      <TableCell key={c.key} align="right" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {n(usage.data!.totals[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      )}
    </Paper>
  );
}

/** A day of the server's UTC figures, in the person's language. */
function utcDayText(ms: number, language: string, style: "medium" | "short" = "medium"): string {
  try {
    return style === "short"
      ? new Intl.DateTimeFormat(language, { day: "numeric", timeZone: "UTC" }).format(new Date(ms))
      : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** One headline figure with what it counts. */
function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: "1.75rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>{value}</Typography>
      {help && (
        <Typography variant="body2" color="text.secondary">
          {help}
        </Typography>
      )}
    </Paper>
  );
}

type Overview = ReturnType<typeof useLoad<ServerOverview>>;

/** A card of the server's figures: its title, and its body once the figures are in. */
function FiguresCard({ id, title, overview, children }: { id: string; title: string; overview: Overview; children: (o: ServerOverview) => ReactNode }) {
  const t = useT();
  const { language } = useApp();
  const o = overview.data;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby={id}>
      <Typography variant="h2" gutterBottom id={id}>
        {title}
      </Typography>
      {overview.loading && !o ? (
        <Loading />
      ) : overview.error || !o ? (
        <ErrorAlert error={overview.error} onRetry={overview.reload} />
      ) : (
        <Stack spacing={3}>
          <Typography color="text.secondary" variant="body2">
            {t("server.overviewIntro.short")} {t("server.asOf", { time: formatDate(o.asOf, language) })}
            <MoreInfo text={t("server.overviewIntro")} />
          </Typography>
          {children(o)}
        </Stack>
      )}
    </Paper>
  );
}

const subtitle = (id: string, text: string) => (
  <Typography variant="h3" component="h3" id={id} sx={{ fontSize: "1.1rem", fontWeight: 600, mb: 1 }}>
    {text}
  </Typography>
);

/**
 * The server owner's panel (Task 11), by section: totals only. Projects appear by id with their size; no project
 * names, no people's names, no answers (§4b). The figures are loaded once for the page (ServerPage).
 */
function OverviewFigures({ overview }: { overview: Overview }) {
  const t = useT();
  const { language } = useApp();
  const n = (value: number) => formatNumber(value, language);
  return (
    <FiguresCard id="server-overview" title={t("server.overviewTitle")} overview={overview}>
      {(o) => (
        <>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <Stat label={t("server.statAccounts")} value={n(o.users.total)} help={t("server.statAccountsHelp", { disabled: n(o.users.disabled), admins: n(o.users.platformAdmins) })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <Stat label={t("server.statActive")} value={n(o.users.active)} help={t("server.statActiveHelp")} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <Stat label={t("server.statProjects")} value={n(o.projects.total)} help={t("server.statProjectsHelp", { active: n(o.projects.active) })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 6 }}>
              <Stat label={t("server.statStorage")} value={formatBytes(o.projects.storageBytes, language)} help={t("server.statStorageHelp")} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stat label={t("server.statReceived")} value={n(o.records.received)} help={t("server.statReceivedHelp")} />
            </Grid>
          </Grid>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 7 }} component="section" aria-labelledby="server-received">
              {subtitle("server-received", t("server.receivedTitle"))}
              <ChartOrTable
                label={t("server.receivedTitle")}
                chart={
                  <ColumnChart
                    ariaLabel={t("server.receivedTitle")}
                    height={150}
                    columns={o.records.receivedByDay.map((d, i, all) => ({
                      label: utcDayText(d.day, language, "short"),
                      value: d.count,
                      title: t(d.count === 1 ? "server.receivedDayOne" : "server.receivedDay", { date: utcDayText(d.day, language), count: n(d.count) }),
                      always: i === all.length - 1,
                    }))}
                  />
                }
                table={
                  <ValuesTable
                    head={[t("server.dayColumn"), t("server.savesColumn")]}
                    rows={[...o.records.receivedByDay].reverse().map((d) => ({ label: utcDayText(d.day, language), value: n(d.count) }))}
                  />
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 5 }} component="section" aria-labelledby="server-signups">
              {subtitle("server-signups", t("server.signupsTitle"))}
              <ChartOrTable
                label={t("server.signupsTitle")}
                chart={
                  <ColumnChart
                    ariaLabel={t("server.signupsTitle")}
                    height={150}
                    columns={o.users.signupsByWeek.map((w, i, all) => ({
                      label: w.week.slice(5),
                      value: w.count,
                      title: t(w.count === 1 ? "server.signupsWeekOne" : "server.signupsWeek", { week: `${w.week.slice(5)} (${utcDayText(w.start, language)})`, count: n(w.count) }),
                      always: i === all.length - 1,
                    }))}
                  />
                }
                table={
                  <ValuesTable
                    head={[t("server.weekColumn"), t("server.newAccountsColumn")]}
                    rows={[...o.users.signupsByWeek].reverse().map((w) => ({ label: `${w.week} (${utcDayText(w.start, language)})`, value: n(w.count) }))}
                  />
                }
              />
            </Grid>
          </Grid>

        </>
      )}
    </FiguresCard>
  );
}

/** The Projects section's figures: the largest projects, by id. */
function LargestProjects({ overview }: { overview: Overview }) {
  const t = useT();
  const { language } = useApp();
  return (
    <FiguresCard id="server-projects-figures" title={t("server.section.projects")} overview={overview}>
      {(o) => (
        <>
          <section aria-labelledby="server-largest">
            {subtitle("server-largest", t("server.largestTitle"))}
            <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
              {t("server.largestIntro")}
            </Typography>
            {o.projects.largest.length === 0 ? (
              <Typography>{t("server.noProjects")}</Typography>
            ) : (
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("server.aiProject")}</TableCell>
                      <TableCell align="right">{t("server.sizeColumn")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {o.projects.largest.map((p) => (
                      <TableRow key={p.projectId}>
                        <TableCell component="th" scope="row" sx={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all" }}>
                          {p.projectId}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {formatBytes(p.storageBytes, language)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </section>

        </>
      )}
    </FiguresCard>
  );
}

/** The System section: the database, the server's version, failed logins and refused requests, late check draws. */
function SystemFigures({ overview }: { overview: Overview }) {
  const t = useT();
  const { language } = useApp();
  const n = (value: number) => formatNumber(value, language);
  return (
    <FiguresCard id="server-system" title={t("server.section.system")} overview={overview}>
      {(o) => (
        <>
          <section aria-labelledby="server-database">
            {subtitle("server-database", t("server.databaseTitle"))}
            {o.database.backend === "memory" ? (
              <Typography>{t("server.dbMemory")}</Typography>
            ) : (
              <Stack spacing={0.5}>
                {o.database.version && <Typography>{t("server.dbVersion", { version: o.database.version })}</Typography>}
                {o.database.sizeBytes !== null && <Typography>{t("server.dbSize", { size: formatBytes(o.database.sizeBytes, language) })}</Typography>}
                {o.database.migrations === null || o.database.migrations.applied === 0 ? (
                  <Typography color="text.secondary">{t("server.dbMigrationsUnknown")}</Typography>
                ) : (
                  <Typography>
                    {t("server.dbMigrations", {
                      applied: n(o.database.migrations.applied),
                      shipped: n(o.database.migrations.shipped),
                      latest: o.database.migrations.latest ?? "",
                    })}
                  </Typography>
                )}
                {o.database.migrations && o.database.migrations.missing.length > 0 && (
                  <Alert severity="warning">{t("server.dbMigrationsMissing", { names: o.database.migrations.missing.join(", ") })}</Alert>
                )}
              </Stack>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("server.runningSince", { version: o.server.version, date: formatDate(o.server.startedAt, language) })}
            </Typography>
          </section>

          <section aria-labelledby="server-security">
            {subtitle("server-security", t("server.securityTitle"))}
            <Explain
              variant="body2"
              sx={{ mb: 1 }}
              text={t("server.securityIntro.short", { date: formatDate(o.security.since, language) })}
              more={t("server.securityIntro", { date: formatDate(o.security.since, language) })}
            />
            <Typography>{t("server.failedLogins", { count: n(o.security.totals.failedLogins) })}</Typography>
            <Typography sx={{ mb: 1 }}>{t("server.rateLimited", { count: n(o.security.totals.rateLimited) })}</Typography>
            {o.security.hours.length === 0 ? (
              <Typography color="text.secondary">{t("server.securityEmpty")}</Typography>
            ) : (
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto", maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("server.hourColumn")}</TableCell>
                      <TableCell align="right">{t("server.failedColumn")}</TableCell>
                      <TableCell align="right">{t("server.refusedColumn")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...o.security.hours].reverse().map((h) => (
                      <TableRow key={h.hour}>
                        <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                          {formatDate(h.hour, language)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                          {n(h.failedLogins)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                          {n(h.rateLimited)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </section>

          {/* Apart from the failed logins: its own heading, so "None in the last 7 days" above is not read as about it. */}
          <section aria-labelledby="server-late-draws">
            {subtitle("server-late-draws", t("server.lateDrawsTitle"))}
            <Typography>
              {t("server.lateDraws", { count: n(o.security.lateDraws) })}
              {o.security.lastLateDrawAt !== null && ` ${t("server.lateDrawsLast", { date: formatDate(o.security.lastLateDrawAt, language) })}`}
            </Typography>
            {o.security.lateDraws > 0 && (
              <Explain variant="body2" sx={{ mb: 1 }} text={t("server.lateDrawsHelp.short")} more={t("server.lateDrawsHelp")} />
            )}
          </section>
        </>
      )}
    </FiguresCard>
  );
}

/**
 * The owner's alerts (the server's src/ownerAlerts.ts): what this server raised since it started, the thresholds, and
 * how they reach the owner. Nothing to see while all is well, but the card says what is watched.
 */
function AlertsCard() {
  const t = useT();
  const { language } = useApp();
  const alerts = useLoad(getOwnerAlerts, []);
  const text = (a: OwnerAlert) =>
    a.kind === "storage" ? t("server.alert.storage", { count: a.count, project: a.projectId ?? "" }) : t(`server.alert.${a.kind}`, { count: a.count });
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="server-alerts">
      <Typography variant="h2" id="server-alerts" gutterBottom>
        {t("server.alertsTitle")}
      </Typography>
      <Explain variant="body2" sx={{ mb: 2 }} text={t("server.alertsExplain.short")} more={t("server.alertsExplain")} />
      {alerts.loading && !alerts.data ? (
        <Loading />
      ) : alerts.error || !alerts.data ? (
        <ErrorAlert error={alerts.error} onRetry={alerts.reload} />
      ) : alerts.data.alerts.length === 0 ? (
        <Alert severity="success">{t("server.alertsNone")}</Alert>
      ) : (
        <List disablePadding>
          {alerts.data.alerts.map((a) => (
            <ListItem key={`${a.kind}-${a.at}-${a.projectId ?? ""}`} divider sx={{ px: 0 }}>
              <ListItemText primary={text(a)} secondary={new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(a.at)} />
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}

function UsersCard({ onAccountChanged }: { onAccountChanged: () => void }) {
  const t = useT();
  const { language, me } = useApp();
  const users = useLoad(listUsers, []);
  const [link, setLink] = useState<{ user: AdminUser; reset: ResetLink } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // One change at a time: the buttons stay enabled (a disabled button loses the keyboard
  // focus), and a second press while one is on its way does nothing.
  const changing = useRef(false);
  /** Puts the focus back on the row's Disable / Enable button once the list shows the change. */
  const focusToggle = (userId: string) =>
    window.setTimeout(() => document.getElementById(`account-toggle-${userId}`)?.focus(), 0);
  /**
   * The row whose button gets the focus once the confirmation dialog has closed. Focusing
   * it while the dialog is still leaving does not hold (the page behind it is still hidden
   * and the dialog's focus trap still active), so it waits for the dialog's exit transition.
   */
  const focusAfterDialog = useRef<string | null>(null);
  const closeConfirm = (userId: string) => {
    focusAfterDialog.current = userId;
    setConfirm(null);
  };

  const setDisabled = async (user: AdminUser, disabled: boolean) => {
    if (changing.current) return;
    changing.current = true;
    setError(null);
    setDone(null);
    setBusy(user.userId);
    try {
      const now = await setUserDisabled(user.userId, disabled);
      users.setData((prev) => prev.map((u) => (u.userId === now.userId ? { ...u, ...now } : u)));
      setDone(t(disabled ? "server.disabledNow" : "server.enabledNow", { name: user.username }));
      onAccountChanged();
    } catch (err) {
      setError(err);
    } finally {
      changing.current = false;
      setBusy(null);
      // Disabling goes through the dialog: focus once it has closed. Enabling does not.
      if (disabled) closeConfirm(user.userId);
      else focusToggle(user.userId);
    }
  };

  /** A lost phone: two-step sign-in off for the account, its sessions ended; it sets it up again after signing in. */
  const resetTwoFactor = async (user: AdminUser) => {
    if (!window.confirm(t("server.twoFactorResetConfirm", { name: user.username }))) return;
    setError(null);
    setDone(null);
    setBusy(user.userId);
    try {
      await resetUserTwoFactor(user.userId);
      users.setData((prev) => prev.map((u) => (u.userId === user.userId ? { ...u, twoFactor: false } : u)));
      setDone(t("server.twoFactorResetDone", { name: user.username }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const makeLink = async (user: AdminUser) => {
    setError(null);
    setBusy(user.userId);
    try {
      setLink({ user, reset: await makeResetLink(user.userId) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" gutterBottom>
        {t("server.users")}
      </Typography>
      <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
        {t("server.privacy")}
      </Typography>
      {users.loading && !users.data ? (
        <Loading />
      ) : users.error || !users.data ? (
        <ErrorAlert error={users.error} onRetry={users.reload} />
      ) : users.data.length === 0 ? (
        <EmptyState title={t("server.noUsers")} />
      ) : (
        <List disablePadding>
          {users.data.map((user) => (
            <ListItem key={user.userId} divider sx={{ gap: 2, flexWrap: "wrap", px: 0 }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ wordBreak: "break-word" }}>{user.username}</span>
                    {user.isPlatformAdmin && <Chip size="small" color="primary" label={t("server.adminBadge")} />}
                    {user.disabledAt !== null && <Chip size="small" color="warning" icon={<Block />} label={t("server.disabledBadge")} />}
                    {user.twoFactor && <Chip size="small" variant="outlined" label={t("server.twoFactorBadge")} />}
                  </Stack>
                }
                secondary={
                  <>
                    {t(user.projects === 1 ? "server.userProjectsOne" : "server.userProjects", { count: user.projects, coordinated: user.coordinatedProjects })}
                    {user.disabledAt !== null && (
                      <>
                        <br />
                        {user.disabledBy
                          ? t("server.disabledBy", { date: formatDate(user.disabledAt, language), name: user.disabledBy })
                          : t("server.disabledOn", { date: formatDate(user.disabledAt, language) })}
                      </>
                    )}
                  </>
                }
                sx={{ flex: "1 1 200px" }}
              />
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                {user.disabledAt === null && (
                  <Button
                    variant="outlined"
                    startIcon={<Key />}
                    onClick={() => void makeLink(user)}
                    disabled={busy === user.userId}
                    aria-label={t("server.makeResetLabel", { name: user.username })}
                  >
                    {t("server.makeReset")}
                  </Button>
                )}
                {user.twoFactor && user.userId !== me?.userId && (
                  <Button variant="outlined" onClick={() => void resetTwoFactor(user)} disabled={busy === user.userId} aria-label={t("server.twoFactorResetLabel", { name: user.username })}>
                    {t("server.twoFactorReset")}
                  </Button>
                )}
                {user.userId !== me?.userId &&
                  (user.disabledAt === null ? (
                    <Button
                      id={`account-toggle-${user.userId}`}
                      variant="outlined"
                      color="warning"
                      startIcon={<Block />}
                      aria-label={t("server.disableLabel", { name: user.username })}
                      onClick={(e) => {
                        // Leave the button before the dialog hides the page from assistive
                        // technology (aria-hidden on a focused element is blocked).
                        e.currentTarget.blur();
                        setConfirm(user);
                      }}
                    >
                      {t("server.disable")}
                    </Button>
                  ) : (
                    <Button
                      id={`account-toggle-${user.userId}`}
                      variant="outlined"
                      startIcon={<CheckCircleOutline />}
                      onClick={() => void setDisabled(user, false)}
                      aria-busy={busy === user.userId}
                      aria-label={t("server.enableLabel", { name: user.username })}
                    >
                      {t("server.enable")}
                    </Button>
                  ))}
              </Stack>
            </ListItem>
          ))}
        </List>
      )}
      {done && (
        <Alert severity="success" role="status" sx={{ mt: 2 }}>
          {done}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Dialog
        open={confirm !== null}
        onClose={() => {
          if (confirm) closeConfirm(confirm.userId);
        }}
        disableRestoreFocus
        slotProps={{
          transition: {
            onExited: () => {
              const userId = focusAfterDialog.current;
              focusAfterDialog.current = null;
              if (userId) document.getElementById(`account-toggle-${userId}`)?.focus();
            },
          },
        }}
        fullWidth
        maxWidth="sm"
      >
        {confirm && (
          <>
            <DialogTitle>{t("server.disableTitle", { name: confirm.username })}</DialogTitle>
            <DialogContent>
              <DialogContentText>{t("server.disableText", { name: confirm.username })}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => closeConfirm(confirm.userId)}>
                {t("common.cancel")}
              </Button>
              <Button color="warning" variant="contained" onClick={() => void setDisabled(confirm, true)} aria-busy={busy === confirm.userId}>
                {t("server.disableConfirm")}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      <Dialog open={link !== null} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        {link && (
          <>
            <DialogTitle>{t("server.resetTitle", { name: link.user.username })}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                {link.reset.mailed ? (
                  <DialogContentText>{t("server.resetMailed", { name: link.user.username })}</DialogContentText>
                ) : (
                  <>
                    <DialogContentText>
                      {link.reset.expiresAt !== null
                        ? t("server.resetText", { name: link.user.username, date: formatDate(link.reset.expiresAt, language) })
                        : t("server.resetTextNoDate", { name: link.user.username })}
                    </DialogContentText>
                    <CopyField value={link.reset.resetUrl ?? ""} label={t("server.resetLink")} />
                  </>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setLink(null)}>{t("common.close")}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Paper>
  );
}

/** For the server administrator only: server settings and accounts. */
const SECTION_ICON: Record<ServerSection, ReactNode> = {
  overview: <Insights />,
  accounts: <People />,
  projects: <FolderOpen />,
  settings: <Tune />,
  system: <Dns />,
};

/** The sections' menu: a list beside the page on wide screens, tabs above it on narrow ones. */
function ServerNav({ section, wide }: { section: ServerSection; wide: boolean }) {
  const t = useT();
  if (!wide) {
    return (
      <Tabs value={section} variant="scrollable" allowScrollButtonsMobile aria-label={t("server.nav.label")} sx={{ borderBottom: 1, borderColor: "divider" }}>
        {SERVER_SECTIONS.map((s) => (
          <Tab key={s} value={s} label={t(`server.section.${s}`)} {...linkProps(pathFor({ name: "server", section: s }))} />
        ))}
      </Tabs>
    );
  }
  return (
    <Box component="nav" aria-label={t("server.nav.label")} sx={{ width: 220, flexShrink: 0, position: "sticky", top: 80 }}>
      <List disablePadding>
        {SERVER_SECTIONS.map((s) => (
          <ListItemButton key={s} selected={s === section} aria-current={s === section ? "page" : undefined}
            sx={{ borderRadius: 1, mb: 0.5 }} {...linkProps(pathFor({ name: "server", section: s }))}>
            <ListItemIcon sx={{ minWidth: 36, color: s === section ? "primary.main" : "text.secondary" }}>{SECTION_ICON[s]}</ListItemIcon>
            <ListItemText primary={t(`server.section.${s}`)} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

/** "All good", or what needs attention, each a link to the section where it is fixed (serverView.ts). */
function HealthLine({ alerts, overview, mailReady }: { alerts: OwnerAlert[] | null; overview: ServerOverview | null; mailReady: boolean }) {
  const t = useT();
  const { language } = useApp();
  const items = serverHealth({ alerts, overview, mailReady, now: Date.now() });
  if (alerts === null || overview === null) return null;
  const n = (v: number) => formatNumber(v, language);
  const text = (item: HealthItem) =>
    item.kind === "alerts" ? t(item.count === 1 ? "server.health.alertsOne" : "server.health.alerts", { count: n(item.count) })
    : item.kind === "migrations" ? t("server.health.migrations", { count: n(item.count) })
    : t("server.health.mail");
  if (items.length === 0) {
    return <Alert severity="success" icon={<CheckCircleOutline />} data-testid="server-health">{t("server.health.ok")}</Alert>;
  }
  return (
    <Alert severity="warning" data-testid="server-health">
      <Typography sx={{ fontWeight: 600 }}>
        {items.length === 1 ? t("server.health.attentionOne") : t("server.health.attention", { count: n(items.length) })}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((item) => (
          <li key={item.kind}>
            {text(item)}{" "}
            <Link {...linkProps(pathFor({ name: "server", section: item.section }))}>{t("server.health.see", { section: t(`server.section.${item.section}`) })}</Link>
          </li>
        ))}
      </Box>
    </Alert>
  );
}

/**
 * The server administrators' page (only they see it), by section: Overview, Accounts, Projects, Settings, System, each
 * with its own address. The health line tops every section; leaving with settings changed and not saved asks first.
 */
export function ServerPage({ section }: { section: ServerSection }) {
  const t = useT();
  const { me, info } = useApp();
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"));
  // Counts the account changes, so the overview's figures (disabled accounts) follow them.
  const [accountChanges, setAccountChanges] = useState(0);
  const admin = me?.isPlatformAdmin === true;
  const overview = useLoad(() => (admin ? getServerOverview() : Promise.resolve(null as unknown as ServerOverview)), [accountChanges, admin]);
  const alerts = useLoad(() => (admin ? getOwnerAlerts() : Promise.resolve({ alerts: [], thresholds: {} })), [admin]);
  const unsaved = useUnsavedGroups();
  const [leaving, setLeaving] = useState<string | null>(null);

  // Settings changed and not saved: the browser asks before closing or reloading, the app before moving elsewhere
  useEffect(() => {
    if (unsaved.length === 0) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    setLeaveGuard((path) => {
      setLeaving(path);
      return false;
    });
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      setLeaveGuard(null);
    };
  }, [unsaved.length]);
  // The groups go when the page goes: nothing is left to warn about elsewhere
  useEffect(() => () => clearUnsaved(), []);

  if (!admin) {
    return (
      <AppShell>
        <Paper variant="outlined">
          <EmptyState heading title={t("server.onlyAdmin")} />
        </Paper>
      </AppShell>
    );
  }
  const leave = () => {
    const path = leaving;
    setLeaving(null);
    clearUnsaved();
    setLeaveGuard(null);
    if (path) navigate(path);
  };

  return (
    <AppShell>
      <Stack spacing={3}>
        <div>
          <Typography variant="h1" gutterBottom>
            {t("server.title")}
          </Typography>
          <Typography color="text.secondary">{t("server.intro")}</Typography>
        </div>
        <Stack direction={wide ? "row" : "column"} spacing={3} sx={{ alignItems: wide ? "flex-start" : "stretch" }}>
          <ServerNav section={section} wide={wide} />
          <Stack spacing={3} sx={{ flex: 1, minWidth: 0 }} component="main" aria-label={t(`server.section.${section}`)}>
            <HealthLine alerts={alerts.data?.alerts ?? null} overview={overview.data ?? null} mailReady={info.selfServiceReset === true} />
            {section === "overview" && (
              <>
                <AlertsCard />
                <OverviewFigures overview={overview} />
              </>
            )}
            {section === "accounts" && <UsersCard onAccountChanged={() => setAccountChanges((n) => n + 1)} />}
            {section === "projects" && (
              <>
                <LargestProjects overview={overview} />
                <AiUsageCard />
              </>
            )}
            {section === "settings" && <ServerSettingsSection />}
            {section === "system" && <SystemFigures overview={overview} />}
            {info.version && (
              <Typography variant="body2" color="text.secondary">
                {t("server.version", { version: info.version })}
              </Typography>
            )}
          </Stack>
        </Stack>
      </Stack>
      <Dialog open={leaving !== null} onClose={() => setLeaving(null)} aria-labelledby="server-leave-title">
        <DialogTitle id="server-leave-title">{t("server.leaveTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("server.leaveText", { groups: unsaved.join(", ") })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaving(null)} autoFocus>{t("server.leaveStay")}</Button>
          <Button color="error" onClick={leave}>{t("server.leaveGo")}</Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
