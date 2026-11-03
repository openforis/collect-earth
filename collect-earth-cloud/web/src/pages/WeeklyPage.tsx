import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import { getWeekly, type FlagCounts, type WeeklyData } from "../api";
import { useApp } from "../appContext";
import { dayStartMs, isoWeekOf, localDay, shiftWeek } from "../activityView";
import { AsOf } from "../components/PeopleCharts";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { countsText } from "../flagsView";
import { formatDay, formatNumber } from "../format";
import { useT } from "../i18n";
import { statusChip } from "../peopleView";
import { browserTimeZone } from "../progressView";
import { rateText } from "../qualityView";
import { linkProps, pathFor } from "../router";
import { useLoad } from "../useLoad";
import { Block, FiguresTime, ReportFrame } from "./ReportPages";

const dayText = (date: string, language: string) => formatDay(dayStartMs(date), language);

function WeekNav({ projectId, data }: { projectId: string; data: WeeklyData }) {
  const t = useT();
  const thisWeek = isoWeekOf(localDay(new Date()));
  const go = (week: string) => linkProps(pathFor({ name: "weekly", projectId, week: week === thisWeek ? null : week }));
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }} className="no-print" component="nav" aria-label={t("weekly.nav")}>
      <Button startIcon={<ChevronLeft />} {...go(shiftWeek(data.week, -1))}>
        {t("weekly.previous")}
      </Button>
      {!data.current && (
        <Button endIcon={<ChevronRight />} {...go(shiftWeek(data.week, 1))}>
          {t("weekly.next")}
        </Button>
      )}
      {!data.current && <Button {...go(thisWeek)}>{t("weekly.thisWeek")}</Button>}
    </Stack>
  );
}

function Progress({ data }: { data: WeeklyData }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const p = data.progress;
  return (
    <Block title={t("weekly.progressTitle")}>
      <Typography>{t("weekly.submitted", { n: n(p.submitted) })}</Typography>
      {p.checks > 0 && <Typography>{t("weekly.checks", { n: n(p.checks) })}</Typography>}
      {p.referenceMeasurements > 0 && <Typography>{t("weekly.referenceMeasurements", { n: n(p.referenceMeasurements) })}</Typography>}
      <Typography>{t("weekly.byEnd", { n: n(p.byEnd), total: n(p.totals.plots), before: n(p.before) })}</Typography>
      {data.current && <Typography color="text.secondary">{t("weekly.now", { n: n(p.totals.submitted), total: n(p.totals.plots) })}</Typography>}
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" aria-label={t("weekly.daysTable")}>
          <TableHead>
            <TableRow>
              <TableCell>{t("weekly.day")}</TableCell>
              <TableCell align="right">{t("weekly.plots")}</TableCell>
              <TableCell align="right">{t("weekly.checksCol")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {p.days.map((d) => (
              <TableRow key={d.date}>
                <TableCell>{dayText(d.date, language)}</TableCell>
                <TableCell align="right">{n(d.submitted)}</TableCell>
                <TableCell align="right">{n(d.checks)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Block>
  );
}

function People({ data }: { data: WeeklyData }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  // People with plots, or who did something that week (a coordinator who checked plots).
  const rows = data.people.filter((p) => p.plots.assigned > 0 || p.submitted > 0 || p.checks > 0);
  return (
    <Block title={t("weekly.peopleTitle")}>
      {rows.length === 0 ? (
        <Typography>{t("weekly.noPeople")}</Typography>
      ) : (
        // It scrolls sideways inside its frame on a phone (Status last): reachable with Tab, then the arrow keys.
        <Box sx={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label={t("weekly.peopleTitle")}>
          <Table size="small" aria-label={t("weekly.peopleTitle")}>
            <TableHead>
              <TableRow>
                <TableCell>{t("peopleTable.name")}</TableCell>
                <TableCell align="right">{t("weekly.plots")}</TableCell>
                <TableCell align="right">{t("weekly.checksCol")}</TableCell>
                <TableCell align="right">{t("weekly.doneNow")}</TableCell>
                <TableCell>{t("weekly.statusNow")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((p) => {
                const chip = statusChip(t, p.status);
                return (
                  <TableRow key={p.userId}>
                    <TableCell sx={{ wordBreak: "break-word" }}>{p.username}</TableCell>
                    <TableCell align="right">{n(p.submitted)}</TableCell>
                    <TableCell align="right">{n(p.checks)}</TableCell>
                    <TableCell align="right">{p.plots.assigned > 0 ? t("weekly.doneOf", { done: n(p.plots.assigned - p.plots.remaining), total: n(p.plots.assigned) }) : "—"}</TableCell>
                    <TableCell>
                      <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {t("weekly.peopleNote")}
      </Typography>
    </Block>
  );
}

function Quality({ projectId, data }: { projectId: string; data: WeeklyData }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const q = data.quality;
  const d = q.decided;
  return (
    <Block title={t("weekly.qualityTitle")}>
      <Typography>
        {d.total === 0
          ? t("weekly.decidedNone")
          : t("weekly.decided", { n: n(d.total), first: n(d.first), check: n(d.check), recheck: n(d.recheck) })}
      </Typography>
      {!q.available ? (
        <Alert
          severity="info"
          action={
            <Button className="no-print" {...linkProps(pathFor({ name: "project", projectId, tab: "quality" }))}>
              {t("weekly.openQuality")}
            </Button>
          }
        >
          {t("weekly.noFigures")}
        </Alert>
      ) : (
        <>
          <Typography>{t("weekly.agreementWeek", { text: q.week && q.week.compared > 0 ? rateText(t, q.week, language) : t("weekly.noChecks") })}</Typography>
          {q.overall && q.overall.compared > 0 && <Typography>{t("weekly.agreementAll", { text: rateText(t, q.overall, language) })}</Typography>}
          {q.flags && (
            <Typography>
              {q.flags.total === 0
                ? t("weekly.flagsNone")
                : t("weekly.flags", { n: n(q.flags.total), kinds: countsText(t, q.flags.counts as FlagCounts, language) })}
            </Typography>
          )}
          <FiguresTime computedAt={q.computedAt} stale={q.stale} />
          <Typography variant="body2" color="text.secondary">
            {t("weekly.qualityNote")}
          </Typography>
        </>
      )}
    </Block>
  );
}

/** The printable weekly summary (coordinators): one ISO week of the viewer's calendar. */
export function WeeklyPage({ projectId, week }: { projectId: string; week: string | null }) {
  const t = useT();
  const { language } = useApp();
  const timeZone = browserTimeZone();
  const state = useLoad(() => getWeekly(projectId, week, timeZone), [projectId, week, timeZone]);
  const data = state.data;
  const title = data ? t("weekly.title", { n: String(Number(data.week.slice(6))), year: data.week.slice(0, 4), start: dayText(data.start, language), end: dayText(data.end, language) }) : t("weekly.titleLoading");
  return (
    <ReportFrame projectId={projectId} title={title} back="activity">
      {state.loading && !data && <Loading />}
      {state.error !== null && <ErrorAlert error={state.error} onRetry={state.reload} />}
      {data && (
        <>
          <WeekNav projectId={projectId} data={data} />
          {data.current && <Alert severity="info" role="note">{t("weekly.current")}</Alert>}
          <AsOf asOf={data.asOf} />
          <Progress data={data} />
          <People data={data} />
          <Quality projectId={projectId} data={data} />
          <Typography variant="body2" color="text.secondary">
            {t("weekly.zone", { zone: data.timeZone })}
          </Typography>
        </>
      )}
    </ReportFrame>
  );
}
