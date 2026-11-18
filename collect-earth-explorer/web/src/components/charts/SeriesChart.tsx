import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import Plot from "../Plot";
import type { Point } from "../../lib/csv";
import { CONFIG, baseLayout, iso, selectedRing } from "./chartStyle";
import { changePoint, median as medianOf, monthlyProfile, trend, unusuallyLow, yearlyMedian } from "../../lib/seriesStats";
import { usePref } from "../../lib/prefs";

interface Props {
  points: Point[];
  name: string;
  /** A 6-digit hex colour (an alpha suffix is appended for the connecting line). */
  color?: string;
  markers?: { x: number[]; name: string; color: string };
  onClickPoint?: (p: Point) => void;
  /** Called with the change year to compare the composites of the years around it on the map. */
  onCompareYears?: (changeYear: number) => void;
  /** Called with the least cloudy observations of the 3 months before and after the change to compare those scenes. */
  onCompareScenes?: (before: Point, after: Point) => void;
  yRange?: [number, number];
  /** Date (epoch ms) of the scene on the map; the point with exactly that date gets a ring. */
  selected?: number;
}

const DEFAULT_Y_RANGE: [number, number] = [-0.25, 1];
/** How far below the top of the y range the marker symbols sit so the top margin does not clip them. */
const MARKER_INSET = 0.03;
/** The container carries the height too: Plotly drops `height` from the layout it is given, and the next re-plot would collapse the chart. */
const STYLE = { width: "100%", height: 266 };
const SEASON_STYLE = { width: "100%", height: 170 };
const RED = "#b00020";
const GREY = "#8a857b";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const yearOf = (ms: number) => new Date(ms).getUTCFullYear();

/**
 * Time series as a Plotly line chart; `points` is trace 0 so a click maps back to its index.
 * `data` and `layout` are memoised and `uirevision` is constant, so a re-render neither
 * re-plots nor resets the user's zoom.
 */
export default function SeriesChart({ points, name, color = "#587F2E", markers, onClickPoint, onCompareYears, onCompareScenes, yRange = DEFAULT_Y_RANGE, selected }: Props) {
  const [yMin, yMax] = yRange;
  const markerX = markers?.x;
  const markerName = markers?.name;
  const markerColor = markers?.color;
  const [showMedian, setShowMedian] = usePref("explorer.median", false);
  const [showTrend, setShowTrend] = usePref("explorer.trend", true);
  const [showChange, setShowChange] = usePref("explorer.change", false);
  const [showUnusual, setShowUnusual] = usePref("explorer.unusual", false);
  const [showSeason, setShowSeason] = usePref("explorer.season", false);
  const median = useMemo(() => yearlyMedian(points), [points]);
  const fit = useMemo(() => trend(median), [median]);
  const change = useMemo(() => changePoint(median), [median]);
  const profile = useMemo(() => monthlyProfile(points), [points]);
  const flags = useMemo(() => unusuallyLow(points), [points]);
  const unusualCount = flags.filter(Boolean).length;
  const years = useMemo(() => [...new Set(points.map((p) => yearOf(p.date)))].sort((a, b) => b - a), [points]);
  // undefined: the newest year; "none": no year. A year the points no longer have falls back to the newest.
  const [yearChoice, setYearChoice] = useState<string>();
  const compareYear = yearChoice === "none" ? undefined : yearChoice && years.includes(+yearChoice) ? +yearChoice : years[0];
  const showProfile = showSeason && profile.length >= 6;

  const data = useMemo<Data[]>(() => {
    const traces: Data[] = [
      {
        x: points.map((p) => iso(p.date)),
        y: points.map((p) => p.value),
        type: "scatter",
        mode: "lines+markers",
        name,
        // Unusual values are coloured on trace 0 itself, so a click on one still maps to its point.
        marker: { size: 4, color: showUnusual && unusualCount ? flags.map((f) => (f ? RED : color)) : color, opacity: 0.6 },
        // A faint hairline so the dots read first.
        line: { width: 1, color: color + "59" },
        hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>",
      },
    ];
    if (showMedian && median.length) {
      traces.push({
        x: median.map((p) => iso(p.date)),
        y: median.map((p) => p.value),
        text: median.map((p) => String(new Date(p.date).getUTCFullYear())),
        type: "scatter",
        mode: "lines+markers",
        name: "Yearly median",
        // Dark, so the trend stands out from the coloured observations.
        marker: { size: 5, color: "#161922" },
        line: { width: 2, color: "#161922" },
        hovertemplate: "%{text} median %{y:.3f}<extra></extra>",
      });
    }
    if (showTrend && fit) {
      const years = [new Date(median[0].date).getUTCFullYear(), new Date(median[median.length - 1].date).getUTCFullYear()];
      traces.push({
        x: years.map((y) => iso(Date.UTC(y, 6, 1))),
        y: years.map((y) => fit.intercept + fit.slope * y),
        type: "scatter",
        mode: "lines",
        name: "Trend",
        line: { width: 2, dash: "dash", color: fit.p < 0.05 ? RED : GREY },
        hoverinfo: "skip",
      });
    }
    if (markerX && markerX.length) {
      traces.push({
        x: markerX.map(iso),
        y: markerX.map(() => yMax - MARKER_INSET),
        type: "scatter",
        mode: "markers",
        name: markerName,
        marker: { symbol: "triangle-down", size: 10, color: markerColor },
        cliponaxis: false,
        hovertemplate: "%{x|%Y-%m-%d}<extra>" + markerName + "</extra>",
      });
    }
    traces.push(...selectedRing(points, selected));
    return traces;
  }, [points, name, color, markerX, markerName, markerColor, yMax, selected, median, fit, showMedian, showTrend, flags, unusualCount, showUnusual]);

  const changeYear = showChange ? change?.year : undefined;
  const changeColor = change && change.p < 0.05 ? RED : GREY;
  const lastDate = points.length ? Math.max(...points.map((p) => p.date)) : undefined;
  const layout = useMemo<Partial<Layout>>(() => {
    const l = baseLayout(STYLE.height, [yMin, yMax], true, lastDate);
    if (changeYear !== undefined) {
      const x = iso(Date.UTC(changeYear, 0, 1));
      l.shapes = [{ type: "line", x0: x, x1: x, y0: 0, y1: 1, yref: "paper", layer: "below", line: { width: 1.5, dash: "dash", color: changeColor } }];
    }
    return l;
  }, [yMin, yMax, changeYear, changeColor, lastDate]);

  const seasonData = useMemo<Data[]>(() => {
    const x = profile.map((m) => m.month);
    const traces: Data[] = [
      { x, y: profile.map((m) => m.q3), type: "scatter", mode: "lines", line: { width: 0, color }, hoverinfo: "skip", name: "Middle half" },
      {
        x,
        y: profile.map((m) => m.q1),
        type: "scatter",
        mode: "lines",
        line: { width: 0, color },
        fill: "tonexty",
        fillcolor: color + "33",
        hoverinfo: "skip",
        name: "Middle half",
      },
      { x, y: profile.map((m) => m.median), type: "scatter", mode: "lines", line: { width: 2, color }, name: "Monthly median", hovertemplate: "%{y:.3f}<extra>median</extra>" },
    ];
    if (compareYear !== undefined) {
      const inYear = points.filter((p) => yearOf(p.date) === compareYear);
      // null breaks the line at a month without observations in that year.
      const y = MONTHS.map((_, m) => {
        const v = inYear.filter((p) => new Date(p.date).getUTCMonth() === m).map((p) => p.value);
        return v.length ? medianOf(v) : null;
      });
      traces.push({
        x: MONTHS.map((_, m) => m),
        y,
        type: "scatter",
        mode: "lines+markers",
        line: { width: 2, color: "#161922" },
        marker: { size: 5, color: "#161922" },
        name: String(compareYear),
        hovertemplate: "%{y:.3f}<extra>" + compareYear + "</extra>",
      });
    }
    return traces;
  }, [profile, points, compareYear, color]);

  const seasonLayout = useMemo<Partial<Layout>>(() => {
    const l = baseLayout(SEASON_STYLE.height, [yMin, yMax], false);
    l.margin = { l: 40, r: 10, t: 24, b: 24 };
    l.showlegend = false;
    // Fitted to the profile: on the main chart's range the seasonal swing is nearly flat.
    delete l.yaxis!.range;
    l.xaxis = { ...l.xaxis, tickvals: MONTHS.map((_, m) => m), ticktext: MONTHS, range: [-0.5, 11.5] };
    return l;
  }, [yMin, yMax]);

  // The handler is stable (so Plot is not re-bound on every render) and reads
  // the latest points and callback through a ref.
  const latest = useRef({ points, onClickPoint });
  useEffect(() => {
    latest.current = { points, onClickPoint };
  });
  const onClick = useCallback((e: Readonly<PlotMouseEvent>) => {
    const hit = e.points[0];
    const { points: current, onClickPoint: cb } = latest.current;
    if (cb && hit && hit.curveNumber === 0 && hit.pointIndex !== undefined) cb(current[hit.pointIndex]);
  }, []);

  // The observation of `year` closest to that year's median.
  const sceneOf = (year: number) => {
    const inYear = points.filter((p) => yearOf(p.date) === year);
    const m = medianOf(inYear.map((p) => p.value));
    return inYear.reduce((a, b) => (Math.abs(b.value - m) < Math.abs(a.value - m) ? b : a));
  };
  // The least cloudy observation dated in [from, to); among equals the one nearest the change.
  const clearest = (from: number, to: number, at: number) =>
    points
      .filter((p) => p.date >= from && p.date < to)
      .sort((a, b) => (a.cloud ?? 101) - (b.cloud ?? 101) || Math.abs(a.date - at) - Math.abs(b.date - at))[0];
  // The change is drawn at 1 January of its year: the 3 months before it and the 3 months from it.
  const at = change && Date.UTC(change.year, 0, 1);
  const clearBefore = change && clearest(Date.UTC(change.year - 1, 9, 1), at!, at!);
  const clearAfter = change && clearest(at!, Date.UTC(change.year, 3, 1), at!);
  const [helpOpen, setHelpOpen] = useState(false);
  const lines = [
    showTrend && (
      <div key="trend">
        <span>{trendText(fit)}</span>
      </div>
    ),
    showChange && (
      <div key="change">
        <span>{changeText(change)}</span>
        {change && onClickPoint && (
          <>
            {" "}
            <button onClick={() => onClickPoint(sceneOf(Math.max(...years.filter((y) => y < change.year))))}>Scene before</button>{" "}
            <button onClick={() => onClickPoint(sceneOf(change.year))}>Scene after</button>
          </>
        )}
        {change && onCompareYears && (
          <>
            {" "}
            <button title="Compare the yearly composites of the year before and the year after on the map" onClick={() => onCompareYears(change.year)}>
              Compare years
            </button>
          </>
        )}
        {onCompareScenes && clearBefore && clearAfter && (
          <>
            {" "}
            <button
              title="Compare the least cloudy scene of the 3 months before the change with the least cloudy of the 3 months after"
              onClick={() => onCompareScenes(clearBefore, clearAfter)}
            >
              Compare scenes
            </button>
          </>
        )}
      </div>
    ),
    showUnusual && unusualCount > 0 && (
      <div key="unusual">
        <span>
          {unusualCount} unusually low {unusualCount === 1 ? "observation" : "observations"} (red)
        </span>
      </div>
    ),
    showProfile && (
      <div key="season">
        <span>{seasonText(profile)}</span>
      </div>
    ),
  ].filter(Boolean);
  // The numbers behind the verdicts, shown with the explanation.
  const numbers = [showTrend && fit && trendNumbers(fit), showChange && change && changeNumbers(change)].filter(Boolean).join(" ");

  // A compact chip per analysis: the short text is shown, the full name is the checkbox's.
  const box = (label: string, short: string, checked: boolean, set: (v: boolean) => void) => (
    <label title={label}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => set(e.target.checked)} />
      {short}
    </label>
  );

  return (
    <>
      <Plot data={data} layout={layout} config={CONFIG} style={STYLE} onClick={onClick} />
      <div className="chart-options chart-chips">
        {box("Yearly median", "Median", showMedian, setShowMedian)}
        {box("Trend", "Trend", showTrend, setShowTrend)}
        {box("Change year", "Change year", showChange, setShowChange)}
        {box("Unusual values", "Unusual", showUnusual, setShowUnusual)}
        {box("Seasonal profile", "Season", showSeason, setShowSeason)}
      </div>
      {lines.length > 0 && (
        <div className="chart-results">
          {lines}
          <button className="chart-explain" aria-expanded={helpOpen} onClick={() => setHelpOpen((o) => !o)}>
            {helpOpen ? "Hide explanation" : "Explain"}
          </button>
        </div>
      )}
      {showProfile && (
        <>
          <div className="chart-options">
            <span>Usual year (green) against</span>
            <select aria-label="Year to compare" value={compareYear ?? "none"} onChange={(e) => setYearChoice(e.target.value)}>
              <option value="none">No year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <Plot data={seasonData} layout={seasonLayout} config={CONFIG} style={SEASON_STYLE} />
        </>
      )}
      {lines.length > 0 && helpOpen && (
        <div className="chart-help">
          {numbers && <p>{numbers}</p>}
          <p>
            The trend is tested on the yearly medians (Mann-Kendall test, Theil-Sen slope). The p-value is the chance of seeing a
            trend at least this consistent if the plot had no real trend. Below 0.05 the trend is called significant: it is unlikely
            to be chance. A high p-value does not prove that nothing changed, only that the data cannot tell. The p-value says
            nothing about how large the change is; that is the change per year.
          </p>
          <p>
            Most likely change: the year where the yearly medians shift most between a period before and a period after (Pettitt
            test). Its p-value reads the same way. A gradual trend also produces a change year, so look at both.
          </p>
          <p>
            Unusual values: an observation is marked when it is far below what is usual for its month over the whole period. Single
            marks are often cloud or shadow that the mask missed; a run of marks suggests a real drop.
          </p>
          <p>
            Seasonal profile: the usual value for each month (line) and the range that half of the observations fall in (band), with
            one year drawn over it.
          </p>
          <p>
            Cloud filter: removes observations from scenes with more cloud than the chosen limit. The limit is for the whole
            satellite scene, not for the plot; cloudy pixels over the plot are already masked.
          </p>
        </div>
      )}
    </>
  );
}

const pText = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const verdict = (p: number) => (p < 0.05 ? "significant" : "not significant");

function changeText(c: ReturnType<typeof changePoint>): string {
  return c ? `Change in ${c.year}: ${verdict(c.p)}` : "Change year needs 8 years of data";
}

const changeNumbers = (c: NonNullable<ReturnType<typeof changePoint>>) =>
  `Most likely change in ${c.year}: median ${c.before.toFixed(3)} before, ${c.after.toFixed(3)} after, ${pText(c.p)}.`;

function seasonText(profile: ReturnType<typeof monthlyProfile>): string {
  const byMedian = [...profile].sort((a, b) => b.median - a.median);
  const high = byMedian[0];
  const low = byMedian[byMedian.length - 1];
  return `Highest in ${MONTH_NAMES[high.month]}, lowest in ${MONTH_NAMES[low.month]}, seasonal swing ${(high.median - low.median).toFixed(2)}`;
}

function trendText(fit: ReturnType<typeof trend>): string {
  if (!fit) return "Trend needs 8 years of data";
  if (fit.p >= 0.05) return "Trend: not significant";
  return `Trend: significant ${fit.slope >= 0 ? "increase" : "decrease"}`;
}

const trendNumbers = (fit: NonNullable<ReturnType<typeof trend>>) =>
  `Trend: ${(fit.slope >= 0 ? "+" : "") + fit.slope.toFixed(4)} per year, ${pText(fit.p)}.`;
