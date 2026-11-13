import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import { useEffect, useState, type ReactNode } from "react";
import Link from "@mui/material/Link";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import Dns from "@mui/icons-material/Dns";
import DoneAll from "@mui/icons-material/DoneAll";
import Chip from "@mui/material/Chip";
import Pagination from "@mui/material/Pagination";
import FolderOpen from "@mui/icons-material/FolderOpen";
import Insights from "@mui/icons-material/Insights";
import People from "@mui/icons-material/People";
import Tune from "@mui/icons-material/Tune";
import {
  getAiUsage,
  getCollectEarthVersions,
  getServerOverview,
  getOwnerAlerts,
  markAlertsSeen,
  type OwnerAlertsPage,
  type OwnerAlert,
  type AiUsageCounts,
  type CollectEarthVersions,
  type ServerOverview,
} from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
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
import { AccountsSection } from "./ServerAccounts";
import { ActivityCard, MailCard, VersionsCard } from "./ServerOperations";
import { ProjectsDirectory } from "./ServerProjects";

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
 * The owner's alerts (the server's src/ownerAlerts.ts): those kept, newest first, in pages; the ones not seen marked, one
 * by one or all at once; the thresholds in force and whether they also go to a chat webhook (both set in Settings).
 */
function AlertsCard({ onSeen }: { onSeen: () => void }) {
  const t = useT();
  const { language } = useApp();
  const [page, setPage] = useState(1);
  const alerts = useLoad(() => getOwnerAlerts(page), [page]);
  const [error, setError] = useState<unknown>(null);
  const a = alerts.data;
  const n = (v: number) => formatNumber(v, language);
  const text = (x: OwnerAlert) =>
    x.kind === "storage" ? t("server.alert.storage", { count: x.count, project: x.projectId ?? "" }) : t(`server.alert.${x.kind}`, { count: x.count });
  const seen = async (ids?: string[]) => {
    setError(null);
    try {
      await markAlertsSeen(ids);
      alerts.reload();
      onSeen();
    } catch (err) {
      setError(err);
    }
  };
  const th = a?.thresholds;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="server-alerts">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h2" id="server-alerts">{t("server.alertsTitle")}</Typography>
          {a && a.unseen > 0 && <Chip size="small" color="warning" label={t("server.alertsUnseen", { count: n(a.unseen) })} />}
        </Stack>
        {a && a.unseen > 0 && <Button variant="outlined" startIcon={<DoneAll />} onClick={() => void seen()}>{t("server.alertsMarkAll")}</Button>}
      </Stack>
      <Explain variant="body2" sx={{ mb: 1 }} text={t("server.alertsExplain.short")}
        more={t("server.alertsExplain", { failedLogins: n(th?.failedLogin ?? 50), serverErrors: n(th?.serverError ?? 20), syncErrors: n(th?.syncError ?? 50), storage: n(th?.storagePercent ?? 90) })} />
      {a?.webhook && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("server.alertsWebhook", { kind: a.webhook.kind === "slack" ? "Slack" : "Microsoft Teams", host: a.webhook.host })}</Typography>}
      <ErrorAlert error={error} />
      {alerts.loading && !a ? (
        <Loading />
      ) : alerts.error || !a ? (
        <ErrorAlert error={alerts.error} onRetry={alerts.reload} />
      ) : a.alerts.length === 0 ? (
        <Alert severity="success">{t("server.alertsNone")}</Alert>
      ) : (
        <>
          <List disablePadding sx={{ opacity: alerts.loading ? 0.6 : 1 }}>
            {a.alerts.map((x) => (
              <ListItem key={x.id ?? `${x.kind}-${x.at}-${x.projectId ?? ""}`} divider sx={{ px: 0, gap: 1 }}
                secondaryAction={!x.seenAt && x.id ? <Button size="small" onClick={() => void seen([x.id!])}>{t("server.alertMarkSeen")}</Button> : undefined}>
                <ListItemText
                  sx={{ pr: !x.seenAt ? 14 : 0 }}
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      {!x.seenAt && <Chip size="small" color="warning" label={t("server.alertNew")} />}
                      <span style={{ fontWeight: x.seenAt ? 400 : 600 }}>{text(x)}</span>
                    </Stack>
                  }
                  secondary={`${new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(x.at)}${x.seenBy ? ` · ${t("server.alertSeenBy", { name: x.seenBy })}` : ""}`}
                />
              </ListItem>
            ))}
          </List>
          {a.pages > 1 && (
            <Pagination count={a.pages} page={a.page} onChange={(_, p) => setPage(p)} sx={{ display: "flex", justifyContent: "center", mt: 1 }}
              getItemAriaLabel={(type, p) => (type === "page" ? t("accounts.page", { page: String(p) }) : t(`accounts.pageNav.${type}`))} />
          )}
        </>
      )}
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
function HealthLine({ unseenAlerts, overview, mailReady, outdatedAccounts }: { unseenAlerts: number | null; overview: ServerOverview | null; mailReady: boolean; outdatedAccounts: number | null }) {
  const t = useT();
  const { language } = useApp();
  const items = serverHealth({ unseenAlerts, overview, mailReady, outdatedAccounts });
  if (unseenAlerts === null || overview === null) return null;
  const n = (v: number) => formatNumber(v, language);
  const text = (item: HealthItem) =>
    item.kind === "alerts" ? t(item.count === 1 ? "server.health.unseenAlertsOne" : "server.health.unseenAlerts", { count: n(item.count) })
    : item.kind === "migrations" ? t("server.health.migrations", { count: n(item.count) })
    : item.kind === "versions" ? t(item.count === 1 ? "server.health.versionsOne" : "server.health.versions", { count: n(item.count) })
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
  const alerts = useLoad(() => (admin ? getOwnerAlerts() : Promise.resolve(null as unknown as OwnerAlertsPage)), [admin]);
  // The Collect Earth versions in use: the System section's card and the health line
  const versions = useLoad(() => (admin ? getCollectEarthVersions() : Promise.resolve(null as unknown as CollectEarthVersions)), [admin]);
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
            <HealthLine unseenAlerts={alerts.data?.unseen ?? null} overview={overview.data ?? null} mailReady={info.selfServiceReset === true}
              outdatedAccounts={versions.data?.outdatedAccounts ?? null} />
            {section === "overview" && (
              <>
                <AlertsCard onSeen={alerts.reload} />
                <OverviewFigures overview={overview} />
              </>
            )}
            {section === "accounts" && <AccountsSection onAccountChanged={() => setAccountChanges((n) => n + 1)} />}
            {section === "projects" && (
              <>
                <ProjectsDirectory />
                <AiUsageCard />
              </>
            )}
            {section === "settings" && <ServerSettingsSection />}
            {section === "system" && (
              <>
                <SystemFigures overview={overview} />
                <VersionsCard versions={versions} />
                <MailCard />
                <ActivityCard />
              </>
            )}
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
