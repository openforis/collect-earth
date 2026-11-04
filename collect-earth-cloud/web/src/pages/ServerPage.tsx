import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Key from "@mui/icons-material/Key";
import Block from "@mui/icons-material/Block";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import { useRef, useState, type FormEvent } from "react";
import {
  getAiUsage,
  getServerOverview,
  getServerSettings,
  listUsers,
  makeResetLink,
  saveServerSettings,
  setUserDisabled,
  type AdminUser,
  type AiUsageCounts,
  type ProjectCreation,
  type ResetLink,
  type ServerSettings,
} from "../api";
import { AI_LIMIT_MAX, limitTexts, parseLimit } from "../aiView";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { CopyField } from "../components/CopyField";
import { ChartOrTable, ColumnChart, ValuesTable } from "../components/PeopleCharts";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatBytes, formatDate, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { draftOf, readDraft, type DraftProblems, type SettingsDraft } from "../settingsForm";
import { useLoad } from "../useLoad";

/** Limits for each account and the server's name, terms and contact: typed, then saved together. */
function DetailsForm({ settings, onSave }: { settings: ServerSettings; onSave: (changes: Partial<ServerSettings>) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(settings));
  const [problems, setProblems] = useState<DraftProblems>({});
  const [busy, setBusy] = useState(false);

  // The label above the field, not inside it: a long label (es, fr) wraps there instead of being cut with "…".
  const field = (key: keyof SettingsDraft, label: MessageKey, help: MessageKey, extra: { type?: string; inputMode?: "numeric" } = {}) => (
    <Stack spacing={0.75}>
      <FormLabel htmlFor={`server-setting-${key}`} sx={{ color: "text.primary" }}>
        {t(label)}
      </FormLabel>
      {textField(key, help, extra)}
    </Stack>
  );
  const textField = (key: keyof SettingsDraft, help: MessageKey, extra: { type?: string; inputMode?: "numeric" }) => (
    <TextField
      id={`server-setting-${key}`}
      value={draft[key]}
      onChange={(e) => {
        setDraft({ ...draft, [key]: e.target.value });
        setProblems({ ...problems, [key]: undefined });
      }}
      error={problems[key] !== undefined}
      helperText={problems[key] ? t(problems[key]!) : t(help)}
      type={extra.type}
      slotProps={extra.inputMode ? { htmlInput: { inputMode: extra.inputMode } } : undefined}
    />
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { changes, problems: found } = readDraft(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await onSave(changes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <div>
        <Typography variant="h3" component="h3" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {t("server.limits")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("server.limitsIntro")}
        </Typography>
      </div>
      {field("maxProjectsPerUser", "server.maxProjects", "server.maxProjectsHelp", { inputMode: "numeric" })}
      {field("maxProjectStorageMb", "server.maxStorage", "server.maxStorageHelp", { inputMode: "numeric" })}
      <div>
        <Typography variant="h3" component="h3" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {t("server.about")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("server.aboutIntro")}
        </Typography>
      </div>
      {field("serverName", "server.serverName", "server.serverNameHelp")}
      {field("termsUrl", "server.termsUrl", "server.termsUrlHelp", { type: "url" })}
      {field("contactEmail", "server.contactEmail", "server.contactEmailHelp", { type: "email" })}
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {t("common.save")}
        </Button>
      </div>
    </Stack>
  );
}

type AiLimitKey = keyof typeof AI_LIMIT_MAX;
const AI_LIMIT_FIELDS: { key: AiLimitKey; label: MessageKey; help: MessageKey }[] = [
  { key: "aiReportsPerDay", label: "server.aiReports", help: "server.aiReportsHelp" },
  { key: "aiFollowUpsPerDay", label: "server.aiFollowUps", help: "server.aiFollowUpsHelp" },
  { key: "aiMonthlyTokens", label: "server.aiTokens", help: "server.aiTokensHelp" },
];

/**
 * The AI assistant on this server: its switch (only once the server has its Vertex AI
 * settings) and its three limits, each counted per project.
 */
function AiSettings({ settings, onSave }: { settings: ServerSettings; onSave: (changes: Partial<ServerSettings>) => Promise<void> }) {
  const t = useT();
  const { language } = useApp();
  // What is typed and not saved yet; the other fields show the server's values, also
  // after the settings are loaded again.
  const [typed, setTyped] = useState<Partial<Record<AiLimitKey, string>>>({});
  const texts = limitTexts(settings, typed);
  const [busy, setBusy] = useState(false);
  const values = Object.fromEntries(AI_LIMIT_FIELDS.map(({ key }) => [key, parseLimit(texts[key], AI_LIMIT_MAX[key])])) as Record<AiLimitKey, number | null>;
  const invalid = AI_LIMIT_FIELDS.some(({ key }) => values[key] === null);
  const changed = AI_LIMIT_FIELDS.some(({ key }) => values[key] !== null && values[key] !== settings[key]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !changed) return;
    setBusy(true);
    try {
      await onSave(Object.fromEntries(AI_LIMIT_FIELDS.map(({ key }) => [key, values[key]])) as Partial<ServerSettings>);
      setTyped({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate aria-labelledby="server-ai">
      <div>
        <Typography variant="h3" component="h3" id="server-ai" sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {t("server.aiTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("server.aiIntro")}
        </Typography>
      </div>
      <FormControl>
        <FormControlLabel
          control={
            <Switch
              checked={settings.aiEnabled && settings.aiConfigured}
              disabled={!settings.aiConfigured}
              onChange={(e) => void onSave({ aiEnabled: e.target.checked })}
            />
          }
          label={t("server.aiEnabled")}
        />
        <FormHelperText sx={{ ml: 0 }}>
          {settings.aiConfigured ? t("server.aiEnabledHelp") : `${t("server.aiNotSetUp")} ${t("server.aiNotSetUpHelp")}`}
        </FormHelperText>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        {t("server.aiLimitsIntro")}
      </Typography>
      {AI_LIMIT_FIELDS.map(({ key, label, help }) => {
        const max = formatNumber(AI_LIMIT_MAX[key], language);
        return (
          <TextField
            key={key}
            label={t(label)}
            value={texts[key]}
            onChange={(e) => setTyped({ ...typed, [key]: e.target.value })}
            error={values[key] === null}
            helperText={values[key] === null ? t("server.aiLimitInvalid", { max }) : t(help, { max })}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
          />
        );
      })}
      <div>
        <Button type="submit" variant="contained" disabled={busy || invalid || !changed}>
          {t("common.save")}
        </Button>
      </div>
    </Stack>
  );
}

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

/**
 * The server owner's panel (Task 11): totals only. Projects appear by id with their size;
 * no project names, no people's names, no answers (§4b).
 */
function OverviewCard({ version }: { version: number }) {
  const t = useT();
  const { language } = useApp();
  // `version` changes after an account is disabled or enabled: the figures are loaded again.
  const overview = useLoad(getServerOverview, [version]);
  const n = (value: number) => formatNumber(value, language);
  const o = overview.data;
  const subtitle = (id: string, text: string) => (
    <Typography variant="h3" component="h3" id={id} sx={{ fontSize: "1.1rem", fontWeight: 600, mb: 1 }}>
      {text}
    </Typography>
  );
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="server-overview">
      <Typography variant="h2" gutterBottom id="server-overview">
        {t("server.overviewTitle")}
      </Typography>
      {overview.loading && !o ? (
        <Loading />
      ) : overview.error || !o ? (
        <ErrorAlert error={overview.error} onRetry={overview.reload} />
      ) : (
        <Stack spacing={3}>
          <Typography color="text.secondary" variant="body2">
            {t("server.overviewIntro")} {t("server.asOf", { time: formatDate(o.asOf, language) })}
          </Typography>
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
            <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
              {t("server.securityIntro", { date: formatDate(o.security.since, language) })}
            </Typography>
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
              <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
                {t("server.lateDrawsHelp")}
              </Typography>
            )}
          </section>
        </Stack>
      )}
    </Paper>
  );
}

function SettingsCard() {
  const t = useT();
  const { refreshInfo } = useApp();
  const settings = useLoad(getServerSettings, []);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const save = async (changes: Partial<ServerSettings>) => {
    setError(null);
    setSaved(false);
    const before = settings.data;
    if (!before) return;
    settings.setData({ ...before, ...changes });
    try {
      settings.setData(await saveServerSettings(before, changes));
      setSaved(true);
      void refreshInfo();
    } catch (err) {
      settings.setData(before);
      setError(err);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" gutterBottom>
        {t("server.settings")}
      </Typography>
      {settings.loading && !settings.data ? (
        <Loading />
      ) : settings.error || !settings.data ? (
        <ErrorAlert error={settings.error} onRetry={settings.reload} />
      ) : (
        <Stack spacing={3}>
          <FormControl>
            <FormControlLabel
              control={<Switch checked={settings.data.signupOpen} onChange={(e) => void save({ signupOpen: e.target.checked })} />}
              label={t("server.signupOpen")}
            />
            <FormHelperText sx={{ ml: 0 }}>{t("server.signupHelp")}</FormHelperText>
          </FormControl>
          <FormControl>
            <FormLabel id="project-creation">{t("server.projectCreation")}</FormLabel>
            <RadioGroup
              aria-labelledby="project-creation"
              value={settings.data.projectCreation}
              onChange={(e) => void save({ projectCreation: e.target.value as ProjectCreation })}
            >
              <FormControlLabel value="platform-admins" control={<Radio />} label={t("server.creationAdmins")} />
              <FormControlLabel value="anyone" control={<Radio />} label={t("server.creationAnyone")} />
            </RadioGroup>
          </FormControl>
          <DetailsForm settings={settings.data} onSave={save} />
          <AiSettings settings={settings.data} onSave={save} />
          {saved && (
            <Alert severity="success" role="status">
              {t("server.saved")}
            </Alert>
          )}
          <ErrorAlert error={error} />
        </Stack>
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
                <DialogContentText>
                  {link.reset.expiresAt !== null
                    ? t("server.resetText", { name: link.user.username, date: formatDate(link.reset.expiresAt, language) })
                    : t("server.resetTextNoDate", { name: link.user.username })}
                </DialogContentText>
                <CopyField value={link.reset.resetUrl} label={t("server.resetLink")} />
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
export function ServerPage() {
  const t = useT();
  const { me, info } = useApp();
  // Counts the account changes, so the overview's figures (disabled accounts) follow them.
  const [accountChanges, setAccountChanges] = useState(0);
  if (!me?.isPlatformAdmin) {
    return (
      <AppShell>
        <Paper variant="outlined">
          <EmptyState title={t("server.onlyAdmin")} />
        </Paper>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <Stack spacing={3}>
        <div>
          <Typography variant="h1" gutterBottom>
            {t("server.title")}
          </Typography>
          <Typography color="text.secondary">{t("server.intro")}</Typography>
        </div>
        <OverviewCard version={accountChanges} />
        <SettingsCard />
        <AiUsageCard />
        <UsersCard onAccountChanged={() => setAccountChanges((n) => n + 1)} />
        {info.version && (
          <Typography variant="body2" color="text.secondary">
            {t("server.version", { version: info.version })}
          </Typography>
        )}
      </Stack>
    </AppShell>
  );
}
