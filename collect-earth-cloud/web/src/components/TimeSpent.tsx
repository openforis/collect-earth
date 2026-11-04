import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import WarningAmber from "@mui/icons-material/WarningAmber";
import type { ReactNode } from "react";
import { getTimeSpent, type PersonRow, type QuickPlot, type TimeSpentData } from "../api";
import { useApp } from "../appContext";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, pathFor } from "../router";
import { bandLabels, bandShortLabels, quickBands, secondsText } from "../timeSpentView";
import { useLoad } from "../useLoad";
import { ErrorAlert } from "./ErrorAlert";
import { Loading } from "./Loading";
import { ChartOrTable, ColumnChart, ValuesTable } from "./PeopleCharts";

function Frame({ id, children }: { id: string; children: ReactNode }) {
  const t = useT();
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 2, sm: 3 }, breakInside: "avoid" }}>
      <Typography variant="h2" id={id} gutterBottom>
        {t("timeSpent.title")}
      </Typography>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("timeSpent.explain")}
        </Typography>
        {children}
      </Stack>
    </Paper>
  );
}

/** The plots' times in bands, the quick ones in the warning colour. */
function Bands({ data, bands }: { data: TimeSpentData; bands: number[] }) {
  const t = useT();
  const { language } = useApp();
  const labels = bandLabels(t, data.bandLimits);
  const short = bandShortLabels(t, data.bandLimits);
  const warn = quickBands(data.bandLimits, data.quickBelowSeconds);
  const n = (v: number) => formatNumber(v, language);
  return (
    <ChartOrTable
      label={t("timeSpent.bandsTitle")}
      chart={
        <ColumnChart
          ariaLabel={t("timeSpent.bandsTitle")}
          columns={bands.map((count, i) => ({ label: short[i], value: count, always: true, warn: warn[i], title: `${labels[i]}: ${t("timeSpent.plotsN", { n: n(count) })}` }))}
        />
      }
      table={<ValuesTable head={[t("timeSpent.colBand"), t("timeSpent.colPlots")]} rows={bands.map((count, i) => ({ label: labels[i], value: n(count) }))} />}
    />
  );
}

/** How the team usually does, and the rule that calls a plot quick (or why none is yet). */
function TeamLines({ data }: { data: TimeSpentData }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  return (
    <>
      {data.medianSeconds !== null && (
        <Typography sx={{ fontSize: "1.15rem" }}>
          {t("timeSpent.teamMedian", {
            d: secondsText(t, data.medianSeconds),
            n: n(data.timed),
            from: secondsText(t, data.q1Seconds ?? 0),
            to: secondsText(t, data.q3Seconds ?? 0),
          })}
        </Typography>
      )}
      {data.quickBelowSeconds !== null ? (
        <Typography variant="body2">{t("timeSpent.quickRule", { d: secondsText(t, data.quickBelowSeconds), share: n(data.quickShare * 100) })}</Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t("timeSpent.quickWait", { n: n(data.minTimed), timed: n(data.timed) })}
        </Typography>
      )}
      {data.untimed > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t(data.untimed === 1 ? "timeSpent.untimedOne" : "timeSpent.untimed", { n: n(data.untimed) })}
        </Typography>
      )}
    </>
  );
}

function QuickTable({ projectId, quick, total, person }: { projectId: string; quick: QuickPlot[]; total: number; person: boolean }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  if (quick.length === 0) return null;
  return (
    <>
      <Typography variant="h3">{t("timeSpent.quickTitle")}</Typography>
      {total > quick.length && (
        <Typography variant="body2" color="text.secondary">
          {t("timeSpent.quickShown", { shown: n(quick.length), n: n(total) })}
        </Typography>
      )}
      <TableContainer sx={{ maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("timeSpent.colPlot")}</TableCell>
              {!person && <TableCell>{t("timeSpent.colPerson")}</TableCell>}
              <TableCell align="right">{t("timeSpent.colTime")}</TableCell>
              <TableCell align="right">{t("timeSpent.colSubmitted")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {quick.map((q) => (
              <TableRow key={`${q.plot}\n${q.operator}`}>
                <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                  <Link aria-label={t("timeSpent.openPlot", { plot: q.plot })} {...linkProps(pathFor({ name: "plot", projectId, plot: q.plot }))}>
                    {q.plot}
                  </Link>
                </TableCell>
                {!person && <TableCell sx={{ overflowWrap: "anywhere" }}>{q.operator}</TableCell>}
                <TableCell align="right">{secondsText(t, q.seconds)}</TableCell>
                <TableCell align="right">{formatDate(q.submittedAt, language)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="body2" color="text.secondary">
        {t("timeSpent.quickHint")}
      </Typography>
    </>
  );
}

/**
 * The People tab's "Time spent on each plot" (coordinators): how long the team usually takes, each person's usual time
 * and quick plots, and the quick plots to open.
 */
export function TeamTimeSpent({ projectId, people }: { projectId: string; people: readonly PersonRow[] }) {
  const t = useT();
  const { language } = useApp();
  const state = useLoad(() => getTimeSpent(projectId), [projectId]);
  const data = state.data;
  const n = (v: number) => formatNumber(v, language);
  const ids = new Map(people.map((p) => [p.username, p.userId]));
  if (!data) {
    return <Frame id="time-spent">{state.loading ? <Loading /> : <ErrorAlert error={state.error} onRetry={state.reload} />}</Frame>;
  }
  if (data.timed === 0) {
    return (
      <Frame id="time-spent">
        <Typography>{t("timeSpent.none")}</Typography>
      </Frame>
    );
  }
  const rows = [...data.people].filter((p) => p.timed > 0).sort((a, b) => b.quick / b.timed - a.quick / a.timed || a.username.localeCompare(b.username));
  return (
    <Frame id="time-spent">
      <TeamLines data={data} />
      <Bands data={data} bands={data.bands} />
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("timeSpent.colPerson")}</TableCell>
              <TableCell align="right">{t("timeSpent.colTimed")}</TableCell>
              <TableCell align="right">{t("timeSpent.colMedian")}</TableCell>
              <TableCell align="right">{t("timeSpent.colMiddle")}</TableCell>
              <TableCell align="right">{t("timeSpent.colTotal")}</TableCell>
              <TableCell align="right">{t("timeSpent.colQuick")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => {
              const userId = ids.get(p.username);
              return (
                <TableRow key={p.username}>
                  <TableCell component="th" scope="row" sx={{ overflowWrap: "anywhere" }}>
                    {userId ? <Link {...linkProps(pathFor({ name: "person", projectId, userId }))}>{p.username}</Link> : p.username}
                  </TableCell>
                  <TableCell align="right">{n(p.timed)}</TableCell>
                  <TableCell align="right">{p.medianSeconds === null ? "—" : secondsText(t, p.medianSeconds)}</TableCell>
                  <TableCell align="right">{p.q1Seconds === null || p.q3Seconds === null ? "—" : t("person.between", { from: secondsText(t, p.q1Seconds), to: secondsText(t, p.q3Seconds) })}</TableCell>
                  <TableCell align="right">{secondsText(t, p.totalSeconds)}</TableCell>
                  <TableCell align="right">
                    {p.quick > 0 ? (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
                        <WarningAmber fontSize="small" color="warning" aria-hidden />
                        <span>{`${n(p.quick)} (${formatNumber(Math.round((p.quick / p.timed) * 100), language)} %)`}</span>
                      </Stack>
                    ) : (
                      n(0)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <QuickTable projectId={projectId} quick={data.quick} total={data.quickCount} person={false} />
    </Frame>
  );
}

/** A person's page (coordinators): their usual time per plot next to the team's, their plots by time, their quick plots. */
export function PersonTimeSpent({ projectId, username }: { projectId: string; username: string }) {
  const t = useT();
  const { language } = useApp();
  const state = useLoad(() => getTimeSpent(projectId, username), [projectId, username]);
  const data = state.data;
  const n = (v: number) => formatNumber(v, language);
  if (!data) {
    return <Frame id="person-time">{state.loading ? <Loading /> : <ErrorAlert error={state.error} onRetry={state.reload} />}</Frame>;
  }
  const me = data.people.find((p) => p.username === username);
  if (!me || me.timed === 0) {
    return (
      <Frame id="person-time">
        <Typography>{t(me && me.untimed > 0 ? (me.untimed === 1 ? "timeSpent.personUntimedOne" : "timeSpent.personUntimed") : "timeSpent.personNone", { n: n(me?.untimed ?? 0) })}</Typography>
      </Frame>
    );
  }
  return (
    <Frame id="person-time">
      <Typography sx={{ fontSize: "1.15rem" }}>
        {t("timeSpent.personMedian", {
          d: secondsText(t, me.medianSeconds ?? 0),
          n: n(me.timed),
          from: secondsText(t, me.q1Seconds ?? 0),
          to: secondsText(t, me.q3Seconds ?? 0),
        })}
      </Typography>
      {data.medianSeconds !== null && <Typography variant="body2">{t("timeSpent.personTeam", { d: secondsText(t, data.medianSeconds), total: secondsText(t, me.totalSeconds) })}</Typography>}
      {me.quick > 0 && data.quickBelowSeconds !== null && (
        <Alert severity="warning" icon={<WarningAmber />}>
          {t(me.quick === 1 ? "timeSpent.personQuickOne" : "timeSpent.personQuickMany", { n: n(me.quick), d: secondsText(t, data.quickBelowSeconds) })}
        </Alert>
      )}
      {data.quickBelowSeconds === null && (
        <Typography variant="body2" color="text.secondary">
          {t("timeSpent.quickWait", { n: n(data.minTimed), timed: n(data.timed) })}
        </Typography>
      )}
      {me.untimed > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t(me.untimed === 1 ? "timeSpent.untimedOne" : "timeSpent.untimed", { n: n(me.untimed) })}
        </Typography>
      )}
      <Bands data={data} bands={me.bands} />
      <QuickTable projectId={projectId} quick={data.quick} total={data.quickCount} person />
    </Frame>
  );
}
