import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import Plot from "../Plot";
import type { Point } from "../../lib/csv";

interface Props {
  points: Point[];
  name: string;
  color?: string;
  markers?: { x: number[]; name: string; color: string };
  onClickPoint?: (p: Point) => void;
  yRange?: [number, number];
}

const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d" as const, "select2d" as const] };
const DEFAULT_Y_RANGE: [number, number] = [-0.25, 1];
/** How far below the top of the y range the marker symbols sit so the top margin does not clip them. */
const MARKER_INSET = 0.03;
/** Plotly treats a JS Date as local time; an ISO string is unambiguous UTC. */
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Time series as a Plotly line chart; `points` is trace 0 so a click maps back to its index.
 * `data` and `layout` are memoised and `uirevision` is constant, so a re-render neither
 * re-plots nor resets the user's zoom.
 */
export default function SeriesChart({ points, name, color = "#2e7d32", markers, onClickPoint, yRange = DEFAULT_Y_RANGE }: Props) {
  const [yMin, yMax] = yRange;
  const markerX = markers?.x;
  const markerName = markers?.name;
  const markerColor = markers?.color;

  const data = useMemo<Data[]>(() => {
    const traces: Data[] = [
      {
        x: points.map((p) => iso(p.date)),
        y: points.map((p) => p.value),
        type: "scatter",
        mode: "lines+markers",
        name,
        marker: { size: 5, color },
        line: { width: 1, color },
        hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>",
      },
    ];
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
    return traces;
  }, [points, name, color, markerX, markerName, markerColor, yMax]);

  const layout = useMemo<Partial<Layout>>(
    () => ({
      height: 240,
      margin: { l: 40, r: 10, t: 10, b: 40 },
      yaxis: { range: [yMin, yMax] },
      legend: { orientation: "h", y: -0.25 },
      hovermode: "closest",
      uirevision: "keep",
    }),
    [yMin, yMax],
  );

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

  return <Plot data={data} layout={layout} config={CONFIG} style={{ width: "100%" }} onClick={onClick} />;
}
