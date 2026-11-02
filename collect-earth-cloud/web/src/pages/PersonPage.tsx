import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Delete from "@mui/icons-material/Delete";
import InsertLink from "@mui/icons-material/Link";
import WarningAmber from "@mui/icons-material/WarningAmber";
import { useState, type ReactNode } from "react";
import {
  createInvite,
  getPerson,
  listMembers,
  moveUnfinished,
  removeMember,
  ROLES,
  setMemberRole,
  type Member,
  type NewInvite,
  type PersonData,
  type PersonFile,
  type PlotStatus,
  type Role,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { CopyField } from "../components/CopyField";
import { JOIN_MENU_ITEM } from "../components/JoinSteps";
import { Loading } from "../components/Loading";
import { AsOf, CalendarHeatMap, ChartOrTable, ColumnChart, ValuesTable } from "../components/PeopleCharts";
import { countsText, totalOf } from "../flagsView";
import { formatDate, formatNumber } from "../format";
import { useT, type Translate } from "../i18n";
import { agoText, bucketLabel, durationText, perDayText, removalText, statusChip, statusSyncLevel } from "../peopleView";
import { browserTimeZone, dayText, percentText } from "../progressView";
import { rateText } from "../qualityView";
import { accuracyText, weakestQuestions } from "../referenceView";
import { linkProps, navigate, pathFor, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";

// A person's page (coordinators, under the People tab) and the sections it shares with
// "My work" (the same numbers, about the person looking).

export function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 2, sm: 3 }, breakInside: "avoid" }}>
      <Typography variant="h2" id={id} gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function Figure({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Typography variant="h2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
      {help && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {help}
        </Typography>
      )}
    </Paper>
  );
}

/** The headline numbers: plots given, submitted, started, left; checks; the last 7 days; the pace. */
export function PersonNumbers({ data, self = false }: { data: PersonData; self?: boolean }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const r = data.person;
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <Figure label={t("person.given")} value={n(r.plots.assigned)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Figure label={t("person.submitted")} value={n(r.plots.submitted)} help={t(self ? "person.submittedHelpSelf" : "person.submittedHelp")} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Figure label={t("person.started")} value={n(r.plots.started)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Figure label={t("person.left")} value={n(r.plots.remaining)} help={t("person.leftHelp")} />
        </Grid>
        {/* Never on My work: checks are blind (copies are counted as plots there). */}
        {r.checks && r.checks.assigned + r.checks.submitted > 0 && (
          <Grid size={{ xs: 12, md: 4 }}>
            <Figure label={t("person.checks")} value={`${n(r.checks.submitted)} / ${n(r.checks.assigned)}`} help={t("person.checksHelp")} />
          </Grid>
        )}
        <Grid size={{ xs: 6, md: 4 }}>
          <Figure label={t("person.last7")} value={n(r.submittedLast7)} help={t("person.last7Help", { zone: data.timeZone })} />
        </Grid>
        <Grid size={{ xs: 6, md: 4 }}>
          <Figure label={t("person.pace")} value={perDayText(r.medianPerDay, language)} help={t("person.paceHelp")} />
        </Grid>
      </Grid>
      {r.plots.done !== null && (
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t("person.done", { percent: percentText(r.plots.assigned - r.plots.remaining, r.plots.assigned, language) })}
          </Typography>
          <LinearProgress variant="determinate" value={Math.min(100, r.plots.done * 100)} sx={{ height: 8, borderRadius: 4, mt: 0.5 }} aria-label={t("person.done", { percent: percentText(r.plots.assigned - r.plots.remaining, r.plots.assigned, language) })} />
        </Box>
      )}
    </Stack>
  );
}

const plural = (t: Translate, count: number, one: Parameters<Translate>[0], many: Parameters<Translate>[0], language: string) => t(count === 1 ? one : many, { n: formatNumber(count, language) });

/** The activity calendar and the hours of the day. */
export function ActivitySection({ data, self = false }: { data: PersonData; self?: boolean }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const dayTitle = (c: { date: string; plots: number; checks: number }) =>
    `${dayText(c.date, language)}: ${plural(t, c.plots, "person.plotsOne", "person.plotsMany", language)}${c.checks > 0 ? `, ${plural(t, c.checks, "person.checksOne", "person.checksMany", language)}` : ""}`;
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <Section title={t("person.activityTitle")} id="person-activity">
      <Stack spacing={3}>
        <Box>
          <Typography variant="h3" gutterBottom>
            {t("person.calendarTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(self ? "person.calendarExplainSelf" : "person.calendarExplain", { zone: data.timeZone })}
          </Typography>
          {data.calendar.length === 0 ? (
            <Typography>{t("person.nothingYet")}</Typography>
          ) : (
            <ChartOrTable
              label={t("person.calendarTitle")}
              chart={<CalendarHeatMap days={data.calendar} today={data.today} language={language} cellTitle={dayTitle} ariaLabel={t("person.calendarTitle")} />}
              table={
                <TableContainer sx={{ maxHeight: 360 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("progress.dayColumn")}</TableCell>
                        <TableCell align="right">{t("person.plotsColumn")}</TableCell>
                        <TableCell align="right">{t("person.checksColumn")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[...data.calendar].reverse().map((d) => (
                        <TableRow key={d.date}>
                          <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                            {dayText(d.date, language)}
                          </TableCell>
                          <TableCell align="right">{n(d.plots)}</TableCell>
                          <TableCell align="right">{n(d.checks)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              }
            />
          )}
        </Box>
        {data.calendar.length > 0 && (
          <Box>
            <Typography variant="h3" gutterBottom>
              {t("person.hoursTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t(self ? "person.hoursExplainSelf" : "person.hoursExplain", { zone: data.timeZone })}
            </Typography>
            <ChartOrTable
              label={t("person.hoursTitle")}
              chart={
                <ColumnChart
                  ariaLabel={t("person.hoursTitle")}
                  columns={data.hours.map((count, h) => ({
                    label: String(h),
                    value: count,
                    always: h % 6 === 0,
                    title: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}: ${t("person.submissions", { n: n(count) })}`,
                  }))}
                />
              }
              table={<ValuesTable head={[t("person.hourColumn"), t("person.submissionsColumn")]} rows={data.hours.map((count, h) => ({ label: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, value: n(count) }))} />}
            />
          </Box>
        )}
      </Stack>
    </Section>
  );
}

/** The speed estimate: the time between consecutive submissions in a working session. */
export function SpeedSection({ data }: { data: PersonData }) {
  const t = useT();
  const { language } = useApp();
  const s = data.speed;
  const n = (v: number) => formatNumber(v, language);
  return (
    <Section title={t("person.speedTitle")} id="person-speed">
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("person.speedExplain")}
        </Typography>
        {s.gaps === 0 ? (
          <Typography>{t("person.speedNone")}</Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: "1.15rem" }}>
              {t("person.speedMedian", { d: durationText(t, s.medianGapMs ?? 0), gaps: n(s.gaps), sessions: n(s.sessions) })}
            </Typography>
            {s.veryFast > 0 && (
              <Alert severity="warning" icon={<WarningAmber />}>
                {plural(t, s.veryFast, "person.veryFastOne", "person.veryFastMany", language)}
              </Alert>
            )}
            <ChartOrTable
              label={t("person.speedTitle")}
              chart={
                <ColumnChart
                  ariaLabel={t("person.speedTitle")}
                  columns={s.buckets.map((b, i) => ({
                    label: i === 0 ? `<${durationText(t, b.upToMs)}` : durationText(t, b.upToMs).replace(/\s/g, " "),
                    value: b.count,
                    always: true,
                    warn: i === 0,
                    title: `${bucketLabel(t, s.buckets, i)}: ${n(b.count)}`,
                  }))}
                />
              }
              table={<ValuesTable head={[t("person.gapColumn"), t("person.timesColumn")]} rows={s.buckets.map((b, i) => ({ label: bucketLabel(t, s.buckets, i), value: n(b.count) }))} />}
            />
            <Typography variant="body2" color="text.secondary">
              {t("person.speedEstimate")}
            </Typography>
          </>
        )}
      </Stack>
    </Section>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0, sm: 2 }} sx={{ py: 0.75, borderBottom: 1, borderColor: "divider" }}>
      <Typography sx={{ minWidth: 220, fontWeight: 500 }}>{label}</Typography>
      <Box sx={{ wordBreak: "break-word" }}>{children}</Box>
    </Stack>
  );
}

/** When they last synced and downloaded, whether their project file is old, their Collect Earth. */
export function SyncSection({ data, self }: { data: PersonData; self: boolean }) {
  const t = useT();
  const { language } = useApp();
  const s = data.sync;
  const now = Date.now();
  const when = (ms: number | null) => (ms === null ? t("peopleTable.never") : `${formatDate(ms, language)} (${agoText(t, ms, now)})`);
  // As the status chip says it: quiet for the project's quiet days (red after twice that).
  const level = statusSyncLevel(data.person.status);
  const ce = s.collectEarth;
  return (
    <Section title={t("person.syncTitle")} id="person-sync">
      <Line label={t("person.lastSync")}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          {level && <WarningAmber fontSize="small" color={level === "red" ? "error" : "warning"} aria-hidden />}
          <Typography>{when(s.lastSyncAt)}</Typography>
        </Stack>
        {level && (
          <Typography variant="body2" color="text.secondary">
            {self
              ? t("person.syncQuietSelf", { days: data.quietDays })
              : t(level === "red" ? "person.syncRed" : "person.syncAmber", { days: data.quietDays, twice: data.quietDays * 2 })}
          </Typography>
        )}
      </Line>
      <Line label={t("person.lastPlotsDownload")}>
        <Typography>{when(s.lastPlotsDownloadAt)}</Typography>
      </Line>
      <Line label={t("person.lastCepDownload")}>
        <Typography>{when(s.lastCepDownloadAt)}</Typography>
      </Line>
      <Line label={t("person.collectEarth")}>
        <Typography>
          {ce === null
            ? t("person.ceNever")
            : ce.kind === "collect-earth"
              ? ce.version
                ? t("person.ceVersion", { version: ce.version })
                : t("person.ceVersionUnknown")
              : ce.kind === "old-collect-earth"
                ? t(self ? "person.ceOldSelf" : "person.ceOld")
                : t("person.ceUnknown")}
        </Typography>
      </Line>
      <Line label={t("person.syncs")}>
        <Typography>{t("person.syncsText", { syncs: formatNumber(s.syncsCount, language), records: formatNumber(s.recordsReceived, language) })}</Typography>
      </Line>
      {s.oldProjectFile && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t(self ? "person.oldFileSelf" : "person.oldFile")}
        </Alert>
      )}
    </Section>
  );
}

/** Their agreement in the quality checks, and the plots the coordinator asked them to look at again. */
export function QualitySection({ data, self, projectId }: { data: PersonData; self: boolean; projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const q = data.quality;
  return (
    <Section title={t("person.qualityTitle")} id="person-quality">
      <Stack spacing={1.5}>
        {!q.available ? (
          <Typography>
            {t(self ? "person.qualityNotYetSelf" : "person.qualityNotYet")}{" "}
            {self ? (
              <Link {...linkProps(pathFor({ name: "myQuality", projectId }))}>{t("myQuality.link")}</Link>
            ) : (
              <Link {...linkProps(pathFor({ name: "project", projectId, tab: "quality" }))}>{t("person.openQuality")}</Link>
            )}
          </Typography>
        ) : (
          <>
            <Line label={t(self ? "person.agreementSelf" : "person.agreement")}>
              <Typography>{q.asFirst && q.asFirst.compared > 0 ? rateText(t, q.asFirst, language) : t("person.noChecks")}</Typography>
            </Line>
            {!self && q.asChecker && (
              <Line label={t("person.agreementChecker")}>
                <Typography>{q.asChecker.compared > 0 ? rateText(t, q.asChecker, language) : t("person.noChecks")}</Typography>
              </Line>
            )}
            {!self && q.flags && (
              <Line label={t("person.flagsTitle")}>
                <Typography>
                  {totalOf(q.flags) > 0 ? countsText(t, q.flags, language) : t("person.flagsNone")}{" "}
                  <Link {...linkProps(pathFor({ name: "project", projectId, tab: "quality" }))}>{t("person.flagsLink")}</Link>
                </Typography>
              </Line>
            )}
            {!self && (
              <Line label={t("person.referenceTitle")}>
                {q.reference ? (
                  <Box>
                    <Typography>{accuracyText(t, q.reference.plots, language)}</Typography>
                    {weakestQuestions(q.reference).map((w) => (
                      <Typography key={w.key} variant="body2" color="text.secondary">
                        {t("reference.missed", { label: w.label, missed: formatNumber(w.compared - w.agreeing, language), count: formatNumber(w.compared, language) })}
                      </Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography>{t("person.referenceNone")}</Typography>
                )}
              </Line>
            )}
            {q.computedAt !== null && (
              <Typography variant="body2" color="text.secondary">
                {q.stale ? t("quality.stale", { time: formatDate(q.computedAt, language) }) : t("report.computedAt", { time: formatDate(q.computedAt, language) })}
              </Typography>
            )}
          </>
        )}
        <Box>
          <Typography variant="h3" gutterBottom>
            {t("person.sentBackTitle")}
          </Typography>
          {q.sentBack.length === 0 ? (
            <Typography color="text.secondary">{t("person.sentBackNone")}</Typography>
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {q.sentBack.map((s) => (
                <Box component="li" key={s.plot} sx={{ mb: 1 }}>
                  <Typography sx={{ wordBreak: "break-word" }}>
                    {t("person.sentBackPlot", { plot: s.plot })}
                    {s.decidedAt !== null && (
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        {" "}
                        · {formatDate(s.decidedAt, language)}
                        {!self && s.decidedBy ? ` · ${s.decidedBy}` : ""}
                      </Box>
                    )}
                    {s.submittedAgain && (
                      <Box component="span" sx={{ color: "text.secondary" }}>
                        {" "}
                        · {t("person.sentBackAgain")}
                      </Box>
                    )}
                  </Typography>
                  {s.comment && <Typography sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "text.secondary" }}>{s.comment}</Typography>}
                  {!s.submittedAgain && s.file && (
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {t("person.sentBackFile", { file: s.file })}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Stack>
    </Section>
  );
}

const STATUS_COLOR: Record<PlotStatus, "success" | "default" | "warning" | "info"> = { submitted: "success", doneByOther: "info", started: "warning", notStarted: "default" };
const STATUS_KEY = { submitted: "person.plotSubmitted", doneByOther: "person.plotDoneByOther", started: "person.plotStarted", notStarted: "person.plotNotStarted" } as const;

function FilePlots({ file }: { file: PersonFile }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // My work never says which plots are checks (the server leaves the kind out there).
  const showKind = file.list.some((p) => p.kind !== null);
  return (
    <Box>
      <Button size="small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? t("person.hidePlots") : t("person.showPlots")}
      </Button>
      {open && (
        <TableContainer sx={{ maxHeight: 360, mt: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t("person.plotColumn")}</TableCell>
                {showKind && <TableCell>{t("person.kindColumn")}</TableCell>}
                <TableCell>{t("peopleTable.status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {file.list.map((p) => (
                <TableRow key={`${p.kind}\u0000${p.plot}`}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                    {p.plot}
                  </TableCell>
                  {showKind && <TableCell>{t(p.kind === "check" ? "person.kindCheck" : "person.kindMain")}</TableCell>}
                  <TableCell>
                    <Chip size="small" variant="outlined" color={STATUS_COLOR[p.status]} label={t(STATUS_KEY[p.status])} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {file.truncated && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              {t("person.truncated", { n: file.list.length })}
            </Typography>
          )}
        </TableContainer>
      )}
    </Box>
  );
}

/** Their plot files, with each file's plots and their status; for coordinators, "Move unfinished plots to…". */
export function FilesSection({
  data,
  projectId,
  members,
  onMoved,
}: {
  data: PersonData;
  projectId: string;
  /** The project's people, to move plots to (coordinators); absent on My work. */
  members?: Member[];
  onMoved?: () => void;
}) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ file: PersonFile; to: Member } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const others = (members ?? []).filter((m) => m.userId !== data.person.userId);
  const move = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await moveUnfinished(projectId, pending.file.csvFileId, data.person.userId, pending.to.userId);
      setNotice(t("divide.moved", { count: n(result.moved), to: pending.to.username }));
      onMoved?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };
  return (
    <Section title={t("person.filesTitle")} id="person-files">
      <Stack spacing={2}>
        {data.files.length === 0 && <Typography color="text.secondary">{t("person.noFiles")}</Typography>}
        {data.files.map((file) => {
          const unfinished = file.plots.started + file.plots.notStarted;
          const target = targets[file.csvFileId] ?? "";
          const to = others.find((m) => m.userId === target) ?? null;
          return (
            <Box key={file.csvFileId} sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <Typography variant="h3" sx={{ wordBreak: "break-word" }}>
                {members ? <Link {...linkProps(pathFor({ name: "plotFile", projectId, fileId: file.csvFileId }))}>{file.filename}</Link> : file.filename}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t(file.divided ? "person.fileDivided" : "person.fileWhole")}
              </Typography>
              {file.plots.total > 0 && (
                <Typography>
                  {t("person.filePlots", { total: n(file.plots.total), submitted: n(file.plots.submitted), started: n(file.plots.started), notStarted: n(file.plots.notStarted) })}
                  {file.plots.doneByOther > 0 && ` ${t("person.fileDoneByOther", { n: n(file.plots.doneByOther) })}`}
                </Typography>
              )}
              {file.checks && file.checks.total > 0 && <Typography>{t("person.fileChecks", { total: n(file.checks.total), submitted: n(file.checks.submitted) })}</Typography>}
              {members && unfinished > 0 && others.length > 0 && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, alignItems: { sm: "center" } }}>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel id={`move-${file.csvFileId}`}>{t("divide.moveButton")}</InputLabel>
                    <Select labelId={`move-${file.csvFileId}`} label={t("divide.moveButton")} value={target} onChange={(e) => setTargets({ ...targets, [file.csvFileId]: e.target.value })}>
                      {others.map((m) => (
                        <MenuItem key={m.userId} value={m.userId}>
                          {m.username}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button variant="outlined" disabled={!to || busy} onClick={() => to && setPending({ file, to })}>
                    {t("divide.move")}
                  </Button>
                </Stack>
              )}
              <FilePlots file={file} />
            </Box>
          );
        })}
        {notice && (
          <Alert severity="success" role="status">
            {notice}
          </Alert>
        )}
        <ErrorAlert error={error} />
      </Stack>
      <Dialog open={pending !== null} onClose={() => !busy && setPending(null)}>
        <DialogTitle>{pending && t("divide.moveTitle", { from: data.person.username, to: pending.to.username })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{pending && t("divide.moveText", { from: data.person.username, to: pending.to.username })}</DialogContentText>
          {pending && !pending.file.divided && <DialogContentText sx={{ mt: 1 }}>{t("person.moveWhole", { file: pending.file.filename })}</DialogContentText>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void move()} disabled={busy}>
            {t("divide.move")}
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

/** Change their role, remove them, or make them a new invitation link (to join again with the new project file). */
function PersonActions({ projectId, data, onChanged }: { projectId: string; data: PersonData; onChanged: () => void }) {
  const t = useT();
  const { me, language } = useApp();
  const person = data.person;
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [invite, setInvite] = useState<NewInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("person.actionsTitle")} id="person-actions">
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="person-role">{t("person.role")}</InputLabel>
            <Select
              labelId="person-role"
              label={t("person.role")}
              value={person.role}
              disabled={busy}
              onChange={(e) =>
                void run(async () => {
                  const role = e.target.value as Role;
                  await setMemberRole(projectId, person.userId, role);
                  if (person.userId === me?.userId && role !== "admin") {
                    // No longer a coordinator: this page is not theirs to see any more.
                    navigate(pathFor({ name: "project", projectId, tab: "progress" }));
                    return;
                  }
                  setNotice(t("people.roleChanged", { name: person.username, role: t(`role.${role}`) }));
                  onChanged();
                })
              }
            >
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {t(`role.${r}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            startIcon={<InsertLink />}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                // A link for them only: Collect Earth gets the project file as it is now when they join with
                // it and log in with their account (the server makes it a one-person, one-week collector link).
                setInvite(await createInvite(projectId, { role: "operator", maxUses: 1, expiresInDays: 7, forUserId: person.userId }));
              })
            }
          >
            {t("person.newLink")}
          </Button>
          {person.userId !== me?.userId && (
            <Button color="error" variant="outlined" startIcon={<Delete />} disabled={busy} onClick={() => setRemoving(true)}>
              {t("people.remove", { name: person.username })}
            </Button>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t("person.newLinkHelp")}
        </Typography>
        {invite && (
          <Box>
            <Alert severity="success" role="status" sx={{ mb: 2 }}>
              <strong>{t("people.linkReady")}</strong> {t("person.newLinkReady", { name: person.username })}
            </Alert>
            {/* Not the join steps of a new person: they already have an account, and must log in with it. */}
            <CopyField value={invite.joinUrl} label={t("join.linkLabel")} />
            <Typography sx={{ mt: 1 }}>{t("person.newLinkSteps", { menu: `${t("join.menuFile")} → ${JOIN_MENU_ITEM}` })}</Typography>
          </Box>
        )}
        {notice && (
          <Alert severity="success" role="status">
            {notice}
          </Alert>
        )}
        <ErrorAlert error={error} />
      </Stack>
      <Dialog open={removing} onClose={() => setRemoving(false)}>
        <DialogTitle>{t("people.removeTitle", { name: person.username })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("people.removeText", { name: person.username })}</DialogContentText>
          {removalText(t, data.removal, language).map((line) => (
            <DialogContentText key={line} sx={{ mt: 1 }}>
              {line}
            </DialogContentText>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(false)}>{t("common.cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() =>
              void run(async () => {
                setRemoving(false);
                await removeMember(projectId, person.userId);
                navigate(pathFor({ name: "project", projectId, tab: "people" }));
              })
            }
          >
            {t("common.remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

/** The status chip and the role, under the name. */
export function PersonHeading({ data, title }: { data: PersonData; title?: string }) {
  const t = useT();
  const chip = statusChip(t, data.person.status);
  return (
    <Stack spacing={1}>
      {title !== undefined && (
        <Typography variant="h2" component="h2" sx={{ wordBreak: "break-word" }}>
          {title}
        </Typography>
      )}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Chip label={chip.label} color={chip.color} size="small" />
        <Typography color="text.secondary">{t(`role.${data.person.role}`)}</Typography>
        <Typography color="text.secondary">· {t("person.lastSubmittedShort", { when: agoText(t, data.person.lastSubmittedAt, Date.now()) })}</Typography>
      </Stack>
    </Stack>
  );
}

/** One person's page (coordinators), under the People tab: /projects/<id>/people/<userId>. */
export function PersonPage({ projectId, userId, onGo }: { projectId: string; userId: string; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  const timeZone = browserTimeZone();
  const state = useLoad(() => getPerson(projectId, userId, timeZone), [projectId, userId, timeZone]);
  const members = useLoad(() => listMembers(projectId), [projectId]);
  const data = state.data;
  return (
    <Stack spacing={3}>
      <Box>
        <Button startIcon={<ArrowBack />} onClick={() => onGo("people")}>
          {t("person.back")}
        </Button>
      </Box>
      {!data ? (
        state.loading ? (
          <Loading />
        ) : (
          <ErrorAlert error={state.error} onRetry={state.reload} />
        )
      ) : (
        <>
          <PersonHeading data={data} title={data.person.username} />
          <AsOf asOf={data.asOf} />
          <PersonNumbers data={data} />
          <PersonActions projectId={projectId} data={data} onChanged={state.reload} />
          <FilesSection data={data} projectId={projectId} members={members.data ?? []} onMoved={state.reload} />
          <ActivitySection data={data} />
          <SpeedSection data={data} />
          <SyncSection data={data} self={false} />
          <QualitySection data={data} self={false} projectId={projectId} />
        </>
      )}
    </Stack>
  );
}
