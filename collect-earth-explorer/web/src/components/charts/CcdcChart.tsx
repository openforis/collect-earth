import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Data, Layout, PlotMouseEvent, Shape } from "plotly.js";
import Plot from "../Plot";
import type { Point } from "../../lib/csv";
import { CONFIG, baseLayout, iso, selectedRing } from "./chartStyle";

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
  /** Date (epoch ms) of the scene on the map; the observed point with exactly that date gets a ring. */
  selected?: number;
}

const SEGMENT_COLORS = ["#587f2e", "#4a9cd5", "#c9772b", "#7a5ea8", "#2a8c82", "#b8475f"];
const OBSERVED_COLOR = "#b5b0a6";
const Y_RANGE: [number, number] = [-1, 1];
/** The container carries the height too: Plotly drops `height` from the layout it is given, and the next re-plot would collapse the chart. */
const STYLE = { width: "100%", height: 286 };

/**
 * CCDC chart: grey observed points (trace 0, so a click maps back to its index),
 * one coloured line per fitted segment and a soft red vertical line per break.
 * `data` and `layout` are memoised and `uirevision` is constant, so a re-render
 * neither re-plots nor resets the user's zoom.
 */
export default function CcdcChart({ data, onClickObserved, selected }: CcdcChartProps) {
  const { band, observed, segments, breaks } = data;

  const traces = useMemo<Data[]>(
    () => [
      {
        x: observed.map((p) => iso(p.date)),
        y: observed.map((p) => p.value),
        type: "scatter",
        mode: "markers",
        name: `${band} observed`,
        marker: { size: 4, color: OBSERVED_COLOR, opacity: 0.85 },
        hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>",
      },
      ...segments.map(
        (segment, i): Data => ({
          x: segment.map((p) => iso(p.date)),
          y: segment.map((p) => p.value),
          type: "scatter",
          mode: "lines",
          name: `Segment ${i + 1}`,
          line: { width: 2.5, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] },
          hoverinfo: "skip",
        }),
      ),
      ...selectedRing(observed, selected),
    ],
    [band, observed, segments, selected],
  );

  const layout = useMemo<Partial<Layout>>(() => {
    // Per break a soft wide band under a thin line.
    const line = (b: number, width: number, color: string): Partial<Shape> => ({
      type: "line",
      x0: iso(b),
      x1: iso(b),
      y0: 0,
      y1: 1,
      yref: "paper",
      layer: "below",
      line: { color, width },
    });
    const shapes = breaks.flatMap((b) => [line(b, 8, "rgba(176,0,32,0.12)"), line(b, 1, "rgba(176,0,32,0.55)")]);
    return { ...baseLayout(STYLE.height, Y_RANGE), shapes };
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

  return <Plot data={traces} layout={layout} config={CONFIG} style={STYLE} onClick={onClick} />;
}
