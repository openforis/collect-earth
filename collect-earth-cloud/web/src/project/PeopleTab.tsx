import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import MuiLink from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Delete from "@mui/icons-material/Delete";
import Download from "@mui/icons-material/Download";
import WarningAmber from "@mui/icons-material/WarningAmber";
import Link from "@mui/icons-material/Link";
import LinkOff from "@mui/icons-material/LinkOff";
import { useState, type FormEvent } from "react";
import {
  createInvite,
  getPeople,
  type PeopleData,
  type PersonRow,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  ROLES,
  setMemberRole,
  type Invite,
  type Member,
  type NewInvite,
  type Role,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { JoinSteps } from "../components/JoinSteps";
import { Loading } from "../components/Loading";
import { AsOf, ChartOrTable, ColumnChart, ValuesTable } from "../components/PeopleCharts";
import { formatDate, formatDay, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { agoText, filterPeople, perDayText, sortPeople, statusChip, statusSyncLevel, type SortKey, type StatusFilter } from "../peopleView";
import { browserTimeZone, dayText, percentText } from "../progressView";
import { formatRate } from "../qualityView";
import { linkProps, pathFor } from "../router";
import { useDownload } from "./useDownload";
import { useLoad } from "../useLoad";

const EXPIRY_CHOICES = [1, 7, 30, 0] as const; // days; 0 = never

function InviteForm({ projectId, onCreated }: { projectId: string; onCreated: (invite: NewInvite) => void }) {
  const t = useT();
  const [role, setRole] = useState<Role>("operator");
  const [maxUses, setMaxUses] = useState("10");
  const [expiry, setExpiry] = useState<number>(30);
  const [error, setError] = useState<unknown>(null);
  const [badUses, setBadUses] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const uses = Number(maxUses);
    if (!Number.isInteger(uses) || uses < 1 || uses > 10000) {
      setBadUses(true);
      return;
    }
    setBusy(true);
    try {
      onCreated(await createInvite(projectId, { role, maxUses: uses, expiresInDays: expiry || null }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <FormControl fullWidth>
          <InputLabel id="invite-role">{t("people.role")}</InputLabel>
          <Select labelId="invite-role" label={t("people.role")} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {t(`role.${r}`)}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{t(`role.${role}.help`)}</FormHelperText>
        </FormControl>
        <TextField
          label={t("people.maxUses")}
          type="number"
          value={maxUses}
          onChange={(e) => {
            setMaxUses(e.target.value);
            setBadUses(false);
          }}
          error={badUses}
          helperText={badUses ? t("people.maxUsesBad") : t("people.maxUsesHelp")}
          slotProps={{ htmlInput: { min: 1, max: 10000, inputMode: "numeric" } }}
        />
        <FormControl fullWidth>
          <InputLabel id="invite-expiry">{t("people.expires")}</InputLabel>
          <Select labelId="invite-expiry" label={t("people.expires")} value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRY_CHOICES.map((days) => (
              <MenuItem key={days} value={days}>
                {days === 0 ? t("people.expiresNever") : t(`people.expires${days}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <ErrorAlert error={error} />
      <Box>
        <Button type="submit" variant="contained" startIcon={<Link />} disabled={busy}>
          {t("people.makeLink")}
        </Button>
      </Box>
    </Stack>
  );
}

function InviteList({ invites, onRevoke }: { invites: Invite[]; onRevoke: (invite: Invite) => void }) {
  const t = useT();
  const { language } = useApp();
  if (invites.length === 0) return <Typography color="text.secondary">{t("people.noInvites")}</Typography>;
  return (
    <List disablePadding>
      {invites.map((invite) => (
        <ListItem
          key={invite.id}
          divider
          secondaryAction={
            <Tooltip title={t("people.revoke")}>
              <IconButton edge="end" aria-label={t("people.revoke")} onClick={() => onRevoke(invite)}>
                <LinkOff />
              </IconButton>
            </Tooltip>
          }
        >
          <ListItemText
            primary={t("people.inviteRow", { role: t(`role.${invite.role}`), used: invite.usedCount, max: invite.maxUses })}
            secondary={[
              invite.createdAt !== null ? t("people.inviteMade", { date: formatDay(invite.createdAt, language) }) : null,
              invite.expiresAt !== null ? t("people.inviteExpires", { date: formatDay(invite.expiresAt, language) }) : t("people.inviteNoExpiry"),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </ListItem>
      ))}
    </List>
  );
}

function MemberList({ projectId, members, onChanged }: { projectId: string; members: Member[]; onChanged: () => void }) {
  const t = useT();
  const { me } = useApp();
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const changeRole = async (member: Member, role: Role) => {
    setError(null);
    setNotice(null);
    try {
      await setMemberRole(projectId, member.userId, role);
      setNotice(t("people.roleChanged", { name: member.username, role: t(`role.${role}`) }));
      onChanged();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (member: Member) => {
    setRemoving(null);
    setError(null);
    setNotice(null);
    try {
      await removeMember(projectId, member.userId);
      setNotice(t("people.removed", { name: member.username }));
      onChanged();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Stack spacing={2}>
      {members.length <= 1 && <Alert severity="info">{t("people.onlyYou")}</Alert>}
      <List disablePadding>
        {members.map((member) => (
          <ListItem key={member.userId} divider sx={{ gap: 2, flexWrap: "wrap", pr: 0 }}>
            <ListItemText
              primary={member.userId === me?.userId ? `${member.username} ${t("people.you")}` : member.username}
              secondary={member.disabled ? <Chip component="span" size="small" label={t("people.disabledBadge")} sx={{ mt: 0.5 }} /> : undefined}
              sx={{ flex: "1 1 160px", wordBreak: "break-word" }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Select
                size="small"
                value={member.role}
                onChange={(e) => void changeRole(member, e.target.value as Role)}
                slotProps={{ input: { "aria-label": t("people.changeRole", { name: member.username }) } }}
                sx={{ minWidth: 150 }}
              >
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {t(`role.${r}`)}
                  </MenuItem>
                ))}
              </Select>
              <Tooltip title={t("people.remove", { name: member.username })}>
                <IconButton aria-label={t("people.remove", { name: member.username })} onClick={() => setRemoving(member)}>
                  <Delete />
                </IconButton>
              </Tooltip>
            </Stack>
          </ListItem>
        ))}
      </List>
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Dialog open={removing !== null} onClose={() => setRemoving(null)}>
        <DialogTitle>{removing && t("people.removeTitle", { name: removing.username })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{removing && t("people.removeText", { name: removing.username })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
          <Button color="error" variant="contained" onClick={() => removing && void remove(removing)}>
            {t("common.remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** This week: plots submitted each of the last 7 days, and who was the most and the least active. */
function WeekSection({ projectId, data }: { projectId: string; data: PeopleData }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const { week } = data;
  const total = week.days.reduce((s, d) => s + d.submitted, 0);
  const plots = (count: number) => t(count === 1 ? "person.plotsOne" : "person.plotsMany", { n: n(count) });
  const people = (list: typeof week.mostActive) => (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {list.map((p) => (
        <Typography component="li" key={p.userId} sx={{ wordBreak: "break-word" }}>
          <MuiLink {...linkProps(pathFor({ name: "person", projectId, userId: p.userId }))}>{p.username}</MuiLink>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {" "}
            · {plots(p.submitted)}
          </Box>
        </Typography>
      ))}
    </Box>
  );
  return (
    <Paper variant="outlined" component="section" aria-labelledby="people-week" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" id="people-week" gutterBottom>
        {t("peopleWeek.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("peopleWeek.explain", { n: n(total), zone: data.timeZone })}
      </Typography>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartOrTable
            label={t("peopleWeek.title")}
            chart={
              <ColumnChart
                ariaLabel={t("peopleWeek.title")}
                height={150}
                columns={week.days.map((d) => ({
                  label: new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(Date.parse(`${d.date}T12:00:00Z`)),
                  value: d.submitted,
                  always: true,
                  title: `${dayText(d.date, language)}: ${plots(d.submitted)}`,
                }))}
              />
            }
            table={<ValuesTable head={[t("progress.dayColumn"), t("progress.dayCount")]} rows={[...week.days].reverse().map((d) => ({ label: dayText(d.date, language), value: n(d.submitted) }))} />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Typography variant="h3" gutterBottom>
            {t("peopleWeek.most")}
          </Typography>
          {week.mostActive.length === 0 ? <Typography color="text.secondary">{t("peopleWeek.nobody")}</Typography> : people(week.mostActive)}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Typography variant="h3" gutterBottom>
            {t("peopleWeek.least")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {t("peopleWeek.leastHelp")}
          </Typography>
          {week.leastActive.length === 0 ? <Typography color="text.secondary">{t("peopleWeek.nobodyLeft")}</Typography> : people(week.leastActive)}
        </Grid>
      </Grid>
    </Paper>
  );
}

const COLUMNS: { key: SortKey; label: MessageKey; align?: "right" }[] = [
  { key: "username", label: "peopleTable.name" },
  { key: "status", label: "peopleTable.status" },
  { key: "done", label: "peopleTable.plots" },
  { key: "last7", label: "peopleTable.last7", align: "right" },
  { key: "lastSync", label: "peopleTable.lastSync" },
  { key: "lastSubmitted", label: "peopleTable.lastSubmitted" },
  { key: "agreement", label: "peopleTable.agreement", align: "right" },
];

const STATUS_FILTERS: { value: StatusFilter; label: MessageKey }[] = [
  { value: "all", label: "peopleTable.statusAll" },
  { value: "quiet", label: "peopleTable.filterQuiet" },
  { value: "neverStarted", label: "peopleTable.statusNeverStarted" },
  { value: "working", label: "peopleTable.statusWorking" },
  { value: "finished", label: "peopleTable.statusFinished" },
  { value: "noPlots", label: "peopleTable.statusNoPlots" },
];

/** The people table: one row per person (sortable, filterable, as CSV), then the links nobody has used yet. */
function PeopleTableSection({ projectId, data }: { projectId: string; data: PeopleData }) {
  const t = useT();
  const { language, me } = useApp();
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "status", direction: "asc" });
  const [text, setText] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const now = Date.now();
  const n = (v: number) => formatNumber(v, language);
  const rows = sortPeople(filterPeople(data.people, text, status), sort.key, sort.direction);
  const showInvites = status === "all" && !text.trim();
  // Through the server, which notes the download in the activity log (the rows are the table's).
  const downloadKind = useDownload(projectId);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const download = () => {
    setDownloading(true);
    setDownloadError(null);
    downloadKind("people")
      .catch((err: unknown) => setDownloadError(err))
      .finally(() => setDownloading(false));
  };
  const onSort = (key: SortKey) => setSort((s) => ({ key, direction: s.key === key && s.direction === "asc" ? "desc" : "asc" }));
  const agreement = (r: PersonRow): string => {
    if (r.agreement === null || r.agreement.compared === 0) return "—";
    if (r.agreement.rate === null) return t("peopleTable.agreementFew", { n: n(r.agreement.compared) });
    return formatRate(r.agreement.rate, language);
  };
  return (
    <Paper variant="outlined" component="section" aria-labelledby="people-table" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" id="people-table" gutterBottom>
        {t("peopleTable.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("peopleTable.explain", { days: data.quietDays, zone: data.timeZone })}
      </Typography>
      <AsOf asOf={data.asOf} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2, alignItems: { sm: "center" } }}>
        <TextField size="small" label={t("peopleTable.search")} value={text} onChange={(e) => setText(e.target.value)} sx={{ maxWidth: { sm: 260 } }} />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="people-status">{t("peopleTable.status")}</InputLabel>
          <Select labelId="people-status" label={t("peopleTable.status")} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            {STATUS_FILTERS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {t(s.label)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" startIcon={<Download />} onClick={download} disabled={downloading}>
          {t("peopleTable.csv")}
        </Button>
      </Stack>
      {downloadError !== null && (
        <Box sx={{ mb: 2 }}>
          <ErrorAlert error={downloadError} onRetry={download} />
        </Box>
      )}
      {!data.quality.available && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("peopleTable.agreementNotYet")}{" "}
          <MuiLink {...linkProps(pathFor({ name: "project", projectId, tab: "quality" }))}>{t("person.openQuality")}</MuiLink>
        </Alert>
      )}
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table size="small" sx={{ "& th, & td": { px: 1 } }}>
          <TableHead>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell key={c.key} align={c.align} sortDirection={sort.key === c.key ? sort.direction : false} sx={{ verticalAlign: "bottom", lineHeight: 1.3 }}>
                  <TableSortLabel active={sort.key === c.key} direction={sort.key === c.key ? sort.direction : "asc"} onClick={() => onSort(c.key)}>
                    {t(c.label)}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const chip = statusChip(t, r.status);
              // The warning follows the status: quiet (amber, red after twice the quiet days), never for finished people.
              const level = statusSyncLevel(r.status);
              const done = r.plots.assigned - r.plots.remaining;
              const doneText =
                r.plots.assigned > 0 ? t("peopleTable.plotsOf", { done: n(done), assigned: n(r.plots.assigned), percent: percentText(done, r.plots.assigned, language) }) : "—";
              return (
                <TableRow key={r.userId} hover>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 100 }}>
                    <MuiLink {...linkProps(pathFor({ name: "person", projectId, userId: r.userId }))}>{r.username}</MuiLink>
                    {r.userId === me?.userId && ` ${t("people.you")}`}
                    <Typography variant="body2" color="text.secondary">
                      {t(`role.${r.role}`)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={chip.label} color={chip.color} variant={r.status.kind === "noPlots" ? "outlined" : "filled"} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 120 }}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {doneText}
                    </Typography>
                    {r.plots.done !== null && <LinearProgress variant="determinate" value={Math.min(100, r.plots.done * 100)} sx={{ mt: 0.5 }} aria-label={`${r.username}: ${doneText}`} />}
                    {r.plots.remaining > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {t("peopleTable.leftCount", { n: n(r.plots.remaining) })}
                      </Typography>
                    )}
                    {r.checks && r.checks.assigned > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {t("peopleTable.checksOf", { submitted: n(r.checks.assigned - r.checks.remaining), assigned: n(r.checks.assigned) })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {n(r.submittedLast7)}
                    {r.medianPerDay !== null && (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                        {t("peopleTable.usually", { n: perDayText(r.medianPerDay, language) })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 90 }} title={r.lastSyncAt !== null ? formatDate(r.lastSyncAt, language) : undefined}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                      {level && <WarningAmber fontSize="small" color={level === "red" ? "error" : "warning"} titleAccess={t(level === "red" ? "peopleTable.syncRed" : "peopleTable.syncAmber", { days: data.quietDays, twice: data.quietDays * 2 })} />}
                      <span>{agoText(t, r.lastSyncAt, now)}</span>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ minWidth: 90 }} title={r.lastSubmittedAt !== null ? formatDate(r.lastSubmittedAt, language) : undefined}>
                    {agoText(t, r.lastSubmittedAt, now)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {agreement(r)}
                  </TableCell>
                </TableRow>
              );
            })}
            {showInvites &&
              data.invites.map((invite) => (
                <TableRow key={`invite-${invite.id}`}>
                  <TableCell component="th" scope="row" sx={{ minWidth: 120 }}>
                    <Typography variant="body2">
                      {invite.forUsername !== null
                        ? t("peopleTable.fileLinkRow", { name: invite.forUsername })
                        : t("peopleTable.inviteRow", { role: t(`role.${invite.role}`) })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {invite.forUsername !== null
                        ? t("peopleTable.fileLinkHelp")
                        : t("peopleTable.invitePlaces", { left: n(Math.max(0, invite.maxUses - invite.usedCount)), max: n(invite.maxUses) })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={t(invite.forUsername !== null ? "peopleTable.statusFileLink" : "peopleTable.statusInvited")} />
                  </TableCell>
                  <TableCell colSpan={COLUMNS.length - 2}>
                    <Typography variant="body2" color="text.secondary">
                      {invite.expiresAt !== null ? t("people.inviteExpires", { date: formatDay(invite.expiresAt, language) }) : t("people.inviteNoExpiry")}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            {rows.length === 0 && !(showInvites && data.invites.length > 0) && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length}>
                  <Typography color="text.secondary">{t("peopleTable.noneMatch")}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("peopleTable.footnote")}
      </Typography>
    </Paper>
  );
}

export function PeopleTab({ projectId }: { projectId: string }) {
  const t = useT();
  const invites = useLoad(() => listInvites(projectId), [projectId]);
  const members = useLoad(() => listMembers(projectId), [projectId]);
  const timeZone = browserTimeZone();
  const people = useLoad(() => getPeople(projectId, timeZone), [projectId, timeZone]);
  const [created, setCreated] = useState<NewInvite | null>(null);
  const [revokeError, setRevokeError] = useState<unknown>(null);

  const revoke = async (invite: Invite) => {
    setRevokeError(null);
    try {
      await revokeInvite(projectId, invite.id);
      invites.reload();
      people.reload();
    } catch (err) {
      setRevokeError(err);
    }
  };

  return (
    <Stack spacing={3}>
      {people.loading && !people.data ? (
        <Loading />
      ) : !people.data ? (
        <ErrorAlert error={people.error} onRetry={people.reload} />
      ) : (
        <>
          <WeekSection projectId={projectId} data={people.data} />
          <PeopleTableSection projectId={projectId} data={people.data} />
        </>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("people.inviteTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("people.inviteIntro")}
        </Typography>
        <InviteForm
          projectId={projectId}
          onCreated={(invite) => {
            setCreated(invite);
            invites.reload();
            people.reload();
          }}
        />
        {created && (
          <Box sx={{ mt: 3 }}>
            <Divider sx={{ mb: 3 }} />
            <Alert severity="success" role="status" sx={{ mb: 2 }}>
              <strong>{t("people.linkReady")}</strong> {t("people.linkOnce")}
            </Alert>
            <Typography variant="h3" gutterBottom>
              {t("people.stepsTitle")}
            </Typography>
            <JoinSteps link={created.joinUrl} />
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("people.openInvites")}
        </Typography>
        {invites.loading && !invites.data ? (
          <Loading />
        ) : invites.error ? (
          <ErrorAlert error={invites.error} onRetry={invites.reload} />
        ) : (
          <InviteList invites={invites.data ?? []} onRevoke={revoke} />
        )}
        {revokeError !== null && (
          <Box sx={{ mt: 2 }}>
            <ErrorAlert error={revokeError} />
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("people.list")}
        </Typography>
        {members.loading && !members.data ? (
          <Loading />
        ) : members.error ? (
          <ErrorAlert error={members.error} onRetry={members.reload} />
        ) : (
          <MemberList
            projectId={projectId}
            members={members.data ?? []}
            onChanged={() => {
              members.reload();
              people.reload();
            }}
          />
        )}
      </Paper>
    </Stack>
  );
}
