import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import ArrowForward from "@mui/icons-material/ArrowForward";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import Refresh from "@mui/icons-material/Refresh";
import WarningAmber from "@mui/icons-material/WarningAmber";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { getProgress, type AttentionItem, type ProgressData } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { AsOf } from "../components/PeopleCharts";
import { Loading } from "../components/Loading";
import { formatDay, formatNumber } from "../format";
import { useT } from "../i18n";
import { attentionShown, totalStats, type TotalStat } from "../localMode";
import {
  attentionAction,
  attentionText,
  barValue,
  browserTimeZone,
  dayText,
  forecastSentences,
  forecastTargetKey,
  percentText,
  personDetail,
  progressChart,
  REFRESH_MS,
  updatedText,
} from "../progressView";
import type { ProjectTab } from "../router";
import { useLoad } from "../useLoad";
import { onceVisibleAfter } from "../visibility";

/** The width of an element, kept up to date (the chart is drawn at its real size, so its text stays readable on a phone). */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The time now, ticking every few seconds (for "Updated 20 s ago"). */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** What the headline numbers, the chart and the forecast are drawn from (the Progress tab's data, or a progress link's). */
export type ProgressFigures = Pick<ProgressData, "timeZone" | "totals" | "daily" | "forecast">;

export function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" id={id} gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** A headline number: what it counts, and its share of the plots as a bar. */
function Stat({ label, value, help, share }: { label: string; value: string; help?: string; share?: { value: number; text: string } }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Typography variant="h2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
      {share && (
        <>
          <LinearProgress variant="determinate" value={share.value} sx={{ my: 1, height: 6, borderRadius: 3 }} aria-label={`${label}: ${share.text}`} />
          <Typography variant="body2" color="text.secondary">
            {share.text}
          </Typography>
        </>
      )}
      {help && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: share ? 0.5 : 1 }}>
          {help}
        </Typography>
      )}
    </Paper>
  );
}

/** `local`: the local mode (one person), without the plots given to someone (they are all yours). */
export function Totals({ data, local = false }: { data: ProgressFigures; local?: boolean }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const { totals } = data;
  const share = (part: number) => ({ value: barValue(part, totals.plots), text: t("progress.ofPlots", { percent: percentText(part, totals.plots, language) }) });
  const stats = totalStats(local);
  // Five numbers: two, then three, in a row (on a desktop); four: two by two, or four in a row.
  const size = (stat: TotalStat) =>
    stats.length === 4 ? { xs: 12, sm: 6, md: 3 } : stat === "plots" || stat === "assigned" ? { xs: 12, sm: 6, md: 4 } : stat === "submitted" ? { xs: 12, sm: 4, md: 4 } : { xs: 12, sm: 4, md: 6 };
  const card = (stat: TotalStat) => {
    switch (stat) {
      case "plots":
        return <Stat label={t("progress.plots")} value={n(totals.plots)} help={t("progress.plotsHelp")} />;
      case "assigned":
        return (
          <Stat
            label={t("progress.assigned")}
            value={n(totals.assigned)}
            share={share(totals.assigned)}
            help={totals.notAssigned > 0 ? t("progress.notAssignedHelp", { n: n(totals.notAssigned) }) : t("progress.allAssignedHelp")}
          />
        );
      default:
        return <Stat label={t(`progress.${stat}`)} value={n(totals[stat])} share={share(totals[stat])} />;
    }
  };
  return (
    <Grid container spacing={2}>
      {stats.map((stat) => (
        <Grid key={stat} size={size(stat)}>
          {card(stat)}
        </Grid>
      ))}
    </Grid>
  );
}

const CHART_HEIGHT = 220;

/** The plots submitted in total, day by day: one line, the target as a dashed reference, a readout for the day under the pointer or the keyboard. */
function ProgressLineChart({ data }: { data: ProgressFigures }) {
  const t = useT();
  const { language } = useApp();
  const theme = useTheme();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  // The readout is announced only while the chart has the keyboard (not on every reload or hover).
  const [focused, setFocused] = useState(false);
  const readout = useId();
  const target = data.forecast.deadline !== null || data.forecast.targetFrom === "setting" ? data.forecast.target : null;
  // Drawn at the width it has, however narrow (a very small phone): it never overflows.
  const box = { width: Math.max(width, 120), height: CHART_HEIGHT, left: 48, right: 12, top: 14, bottom: 28 };
  const chart = progressChart(data.daily, box, target);
  const count = chart.points.length;
  const shown = active !== null ? chart.points[active] : chart.points[count - 1];
  const first = chart.points[0];
  const last = chart.points[count - 1];
  const band = count > 1 ? (box.width - box.left - box.right) / (count - 1) : box.width - box.left - box.right;
  const n = (v: number) => formatNumber(v, language);
  const ink = theme.palette.text.secondary;
  const grid = theme.palette.divider;
  const mark = theme.palette.primary.main;
  const surface = theme.palette.background.paper;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const at = active ?? count - 1;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? Math.max(0, at - 1)
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? Math.min(count - 1, at + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? count - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <Box ref={ref} sx={{ width: "100%" }}>
      <Typography id={readout} variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live={focused ? "polite" : "off"}>
        {shown ? t("progress.point", { date: dayText(shown.date, language), total: n(shown.cumulative), day: n(shown.submitted) }) : ""}
      </Typography>
      <Box
        role="group"
        tabIndex={0}
        aria-label={`${first && last ? t("progress.chartLabel", { from: dayText(first.date, language), to: dayText(last.date, language) }) : t("progress.chartTitle")} ${t("progress.chartKeys")}`}
        aria-describedby={readout}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          setActive((a) => a ?? count - 1);
        }}
        onBlur={() => {
          setFocused(false);
          setActive(null);
        }}
        sx={{ maxWidth: "100%", borderRadius: 1, outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
      >
        {width > 0 && (
          <svg width={box.width} height={box.height} aria-hidden style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setActive(null)}>
            {chart.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={box.left} x2={box.width - box.right} y1={tick.y} y2={tick.y} stroke={grid} strokeWidth={1} />
                <text x={box.left - 8} y={tick.y} dy="0.32em" textAnchor="end" fontSize={12} fill={ink}>
                  {n(tick.value)}
                </text>
              </g>
            ))}
            {chart.targetY !== null && target !== null && (
              <g>
                <line x1={box.left} x2={box.width - box.right} y1={chart.targetY} y2={chart.targetY} stroke={ink} strokeWidth={1.5} strokeDasharray="5 4" />
                <text x={box.width - box.right} y={chart.targetY - 6} textAnchor="end" fontSize={12} fill={ink}>
                  {t("progress.targetLine", { n: n(target) })}
                </text>
              </g>
            )}
            {shown && active !== null && <line x1={shown.x} x2={shown.x} y1={box.top} y2={box.height - box.bottom} stroke={ink} strokeOpacity={0.5} strokeWidth={1} />}
            {chart.area && <path d={chart.area} fill={mark} fillOpacity={0.1} stroke="none" />}
            {chart.path && <path d={chart.path} fill="none" stroke={mark} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {shown && <circle cx={shown.x} cy={shown.y} r={4.5} fill={mark} stroke={surface} strokeWidth={2} />}
            {first && (
              <text x={first.x} y={box.height - 8} textAnchor="start" fontSize={12} fill={ink}>
                {dayText(first.date, language, "short")}
              </text>
            )}
            {last && last !== first && (
              <text x={last.x} y={box.height - 8} textAnchor="end" fontSize={12} fill={ink}>
                {dayText(last.date, language, "short")}
              </text>
            )}
            {chart.points.map((pt, i) => (
              <rect key={pt.date} x={pt.x - band / 2} y={box.top} width={Math.max(band, 1)} height={box.height - box.top - box.bottom} fill="transparent" onMouseEnter={() => setActive(i)} />
            ))}
          </svg>
        )}
      </Box>
    </Box>
  );
}

export function OverTime({ data }: { data: ProgressFigures }) {
  const t = useT();
  const { language } = useApp();
  const [view, setView] = useState<"chart" | "table">("chart");
  const n = (v: number) => formatNumber(v, language);
  return (
    <Section title={t("progress.chartTitle")} id="progress-chart">
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("progress.chartExplain", { zone: data.timeZone })}
      </Typography>
      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label={t("progress.chartTitle")} sx={{ mb: 1 }}>
        <ToggleButton value="chart">{t("quality.showChart")}</ToggleButton>
        <ToggleButton value="table">{t("quality.showTable")}</ToggleButton>
      </ToggleButtonGroup>
      {view === "chart" ? (
        <ProgressLineChart data={data} />
      ) : (
        <TableContainer sx={{ maxHeight: 420 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t("progress.dayColumn")}</TableCell>
                <TableCell align="right">{t("progress.dayCount")}</TableCell>
                <TableCell align="right">{t("progress.totalCount")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...data.daily].reverse().map((d) => (
                <TableRow key={d.date}>
                  <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                    {dayText(d.date, language)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {n(d.submitted)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {n(d.cumulative)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

/** `publicView`: a progress link's page (no Settings tab to point to); `local`: the local mode (one person). */
export function ForecastSection({ data, publicView, local }: { data: ProgressFigures; publicView?: boolean; local?: boolean }) {
  const t = useT();
  const { language } = useApp();
  const f = data.forecast;
  const targetKey = forecastTargetKey(f, { publicView, local });
  return (
    <Section title={t("progress.forecastTitle")} id="progress-forecast">
      <Stack spacing={1}>
        {forecastSentences(t, f, language, { publicView, local }).map((s) => (
          <Typography key={s}>{s}</Typography>
        ))}
        {targetKey !== null && (
          <Typography variant="body2" color="text.secondary">
            {t(targetKey, { target: formatNumber(f.target, language) })}
          </Typography>
        )}
      </Stack>
    </Section>
  );
}

function AttentionCard({ item, onGo }: { item: AttentionItem; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  const { language } = useApp();
  const { title, text } = attentionText(t, item, language);
  const action = attentionAction(t, item.kind);
  const more = item.count - item.people.length;
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <WarningAmber color="warning" fontSize="small" aria-hidden />
        <Typography variant="h3" component="h3">
          {title}
        </Typography>
      </Stack>
      {text.map((s) => (
        <Typography key={s} variant="body2">
          {s}
        </Typography>
      ))}
      {item.people.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {item.people.map((person) => {
            const detail = personDetail(t, item, person, language, (ms) => formatDay(ms, language));
            return (
              <Typography component="li" variant="body2" key={person.username} sx={{ wordBreak: "break-word" }}>
                {person.username}
                {detail && (
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    {" "}
                    · {detail}
                  </Box>
                )}
              </Typography>
            );
          })}
          {more > 0 && (
            <Typography component="li" variant="body2" color="text.secondary">
              {t("progress.andMore", { n: formatNumber(more, language) })}
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ mt: "auto", pt: 1 }}>
        <Button size="small" variant="outlined" endIcon={<ArrowForward />} onClick={() => onGo(action.tab)}>
          {action.label}
        </Button>
      </Box>
    </Paper>
  );
}

function Attention({ items, onGo }: { items: AttentionItem[]; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  return (
    <Section title={t("progress.attentionTitle")} id="progress-attention">
      {items.length === 0 ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CheckCircleOutline color="success" aria-hidden />
          <Typography>{t("progress.attentionNone")}</Typography>
        </Stack>
      ) : (
        <Grid container spacing={2}>
          {items.map((item) => (
            <Grid key={item.kind} size={{ xs: 12, md: 6 }}>
              <AttentionCard item={item} onGo={onGo} />
            </Grid>
          ))}
        </Grid>
      )}
    </Section>
  );
}

/**
 * The Progress tab: how far the collection is, how it went day by day, when it will be
 * done, and (for coordinators) what needs attention. Reloaded every minute while the
 * page is visible.
 */
export function ProgressTab({ projectId, onGo }: { projectId: string; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  // The local mode (one person): no cards about other people, nor plots given to someone.
  const local = useLocalMode();
  const timeZone = browserTimeZone();
  const state = useLoad(() => getProgress(projectId, timeZone), [projectId, timeZone]);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const now = useNow(5_000);
  const { data, loading, reload } = state;

  useEffect(() => {
    if (data) setLoadedAt(Date.now());
  }, [data]);
  // The next reload a minute after this one ended, once the page is visible.
  useEffect(() => {
    if (loading) return;
    return onceVisibleAfter(REFRESH_MS, document, reload);
  }, [loading, reload]);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorAlert error={state.error} onRetry={reload} />;
  const attention = attentionShown(local, data.attention);

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          {updatedText(t, loadedAt, now)}
        </Typography>
        <Button size="small" startIcon={<Refresh />} onClick={reload} disabled={loading}>
          {t("progress.refresh")}
        </Button>
      </Stack>
      {state.error !== null && state.error !== undefined && <ErrorAlert error={state.error} onRetry={reload} />}
      <AsOf asOf={data.asOf} />
      {data.totals.plots === 0 ? (
        // Only coordinators can open Setup (reviewers get no cards either); Collect Earth sends the local mode's plot files.
        <Alert severity="info" action={!local && data.attention !== null ? <Button onClick={() => onGo("setup")}>{t("progress.goSetup")}</Button> : undefined}>
          {t(local ? "progress.noPlotsLocal" : "progress.noPlots")}
        </Alert>
      ) : (
        <Totals data={data} local={local} />
      )}
      {attention !== null && <Attention items={attention} onGo={onGo} />}
      <ForecastSection data={data} local={local} />
      <OverTime data={data} />
    </Stack>
  );
}
