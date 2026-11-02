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

/** Time series as a Plotly line chart; `points` is trace 0 so a click maps back to its index. */
export default function SeriesChart({ points, name, color = "#2e7d32", markers, onClickPoint, yRange = [-0.25, 1] }: Props) {
  const data: Data[] = [
    {
      x: points.map((p) => new Date(p.date)),
      y: points.map((p) => p.value),
      type: "scatter",
      mode: "lines+markers",
      name,
      marker: { size: 5, color },
      line: { width: 1, color },
      hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>",
    },
  ];
  if (markers && markers.x.length) {
    data.push({
      x: markers.x.map((t) => new Date(t)),
      y: markers.x.map(() => yRange[1]),
      type: "scatter",
      mode: "markers",
      name: markers.name,
      marker: { symbol: "triangle-down", size: 10, color: markers.color },
      hovertemplate: "%{x|%Y-%m-%d}<extra>" + markers.name + "</extra>",
    });
  }
  const layout: Partial<Layout> = {
    height: 240,
    margin: { l: 40, r: 10, t: 10, b: 40 },
    yaxis: { range: yRange },
    legend: { orientation: "h", y: -0.25 },
    hovermode: "closest",
  };
  const onClick = (e: Readonly<PlotMouseEvent>) => {
    const hit = e.points[0];
    if (onClickPoint && hit && hit.curveNumber === 0 && hit.pointIndex !== undefined) onClickPoint(points[hit.pointIndex]);
  };
  return <Plot data={data} layout={layout} config={CONFIG} style={{ width: "100%" }} onClick={onClick} />;
}
