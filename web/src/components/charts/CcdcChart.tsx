import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Data, Layout, PlotMouseEvent, Shape } from "plotly.js";
import Plot from "../Plot";
import type { Point } from "../../lib/csv";

export type CcdcBand = "NDFI" | "NDVI";

export interface CcdcData {
  band: CcdcBand;
  /** Observed index values, in [-1, 1]. */
  observed: Point[];
  /** Fitted curve per CCDC segment, in [-1, 1]. */
  segments: Point[][];
  /** Break dates as epoch milliseconds. */
  breaks: number[];
}

export interface CcdcChartProps {
  data: CcdcData;
  onClickObserved: (p: Point) => void;
}

const SEGMENT_COLORS = ["#d32f2f", "#1976d2", "#388e3c", "#f57c00", "#7b1fa2", "#00796b", "#c2185b", "#5d4037"];
const OBSERVED_COLOR = "#9e9e9e";

const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d" as const, "select2d" as const] };
/** Plotly treats a JS Date as local time; an ISO string is unambiguous UTC. */
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * CCDC chart: grey observed points (trace 0, so a click maps back to its index),
 * one coloured line per fitted segment and a dotted vertical line per break.
 * `data` and `layout` are memoised and `uirevision` is constant, so a re-render
 * neither re-plots nor resets the user's zoom.
 */
export default function CcdcChart({ data, onClickObserved }: CcdcChartProps) {
  const { band, observed, segments, breaks } = data;

  const traces = useMemo<Data[]>(
    () => [
      {
        x: observed.map((p) => iso(p.date)),
        y: observed.map((p) => p.value),
        type: "scatter",
        mode: "markers",
        name: `${band} observed`,
        marker: { size: 4, color: OBSERVED_COLOR },
        hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>",
      },
      ...segments.map(
        (segment, i): Data => ({
          x: segment.map((p) => iso(p.date)),
          y: segment.map((p) => p.value),
          type: "scatter",
          mode: "lines",
          name: `Segment ${i + 1}`,
          line: { width: 2, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] },
          hoverinfo: "skip",
        }),
      ),
    ],
    [band, observed, segments],
  );

  const layout = useMemo<Partial<Layout>>(() => {
    const shapes: Partial<Shape>[] = breaks.map((b) => ({
      type: "line",
      x0: iso(b),
      x1: iso(b),
      y0: 0,
      y1: 1,
      yref: "paper",
      line: { color: "#000", width: 1, dash: "dot" },
    }));
    return {
      height: 260,
      margin: { l: 40, r: 10, t: 10, b: 40 },
      yaxis: { range: [-1, 1] },
      legend: { orientation: "h", y: -0.25 },
      hovermode: "closest",
      shapes,
      uirevision: "keep",
    };
  }, [breaks]);

  // The handler is stable (so Plot is not re-bound on every render) and reads
  // the latest observed points and callback through a ref.
  const latest = useRef({ observed, onClickObserved });
  useEffect(() => {
    latest.current = { observed, onClickObserved };
  });
  const onClick = useCallback((e: Readonly<PlotMouseEvent>) => {
    const hit = e.points[0];
    const { observed: current, onClickObserved: cb } = latest.current;
    if (hit && hit.curveNumber === 0 && hit.pointIndex !== undefined) cb(current[hit.pointIndex]);
  }, []);

  return <Plot data={traces} layout={layout} config={CONFIG} style={{ width: "100%" }} onClick={onClick} />;
}
