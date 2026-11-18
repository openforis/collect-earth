import type { Config, Data, Layout } from "plotly.js";
import type { Point } from "../../lib/csv";

/** What SeriesChart and CcdcChart share: the Plotly config, the base layout and the site colours. */

const FONT = "Poppins, sans-serif";
const TICK = "#8a857b";

export const CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: true,
  displayModeBar: "hover",
  modeBarButtonsToRemove: ["toImage", "lasso2d","select2d", "zoomIn2d", "zoomOut2d", "autoScale2d"],
};

/** Plotly treats a JS Date as local time; an ISO string is unambiguous UTC. */
export const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A fresh layout per call: Plotly writes the user's zoom into the layout it is given,
 * so two charts must never share the axis objects.
 */
export function baseLayout(height: number, yRange: [number, number], rangeButtons = true, xEnd?: number): Partial<Layout> {
  const layout: Partial<Layout> = {
    height,
    // The top margin leaves room for the range buttons and the toolbar above the plot.
    margin: { l: 40, r: 10, t: 36, b: 40 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: FONT, size: 11, color: "#626262" },
    xaxis: {
      showgrid: false,
      showline: false,
      zeroline: false,
      ticks: "",
      tickfont: { color: TICK },
      showspikes: true,
      spikemode: "across",
      spikesnap: "data",
      spikethickness: 1,
      spikecolor: "#b9b3a6",
      spikedash: "solid",
      rangeselector: {
        buttons: [
          { count: 1, step: "year", stepmode: "backward", label: "1y" },
          { count: 5, step: "year", stepmode: "backward", label: "5y" },
          { step: "all", label: "All" },
        ],
        x: 0,
        xanchor: "left",
        y: 1.02,
        yanchor: "bottom",
        font: { size: 10 },
        bgcolor: "#f4f1eb",
        activecolor: "#dfe9d3",
        borderwidth: 0,
      },
    },
    yaxis: {
      range: yRange,
      showgrid: true,
      gridcolor: "#eeebe5",
      zeroline: true,
      zerolinecolor: "#d8d2c6",
      zerolinewidth: 1,
      showline: false,
      ticks: "",
      tickfont: { color: TICK },
    },
    hoverlabel: { bgcolor: "#161922", bordercolor: "#161922", font: { family: FONT, size: 11, color: "#fff" } },
    modebar: { bgcolor: "rgba(0,0,0,0)", color: "#a09a8e", activecolor: "#161922" },
    legend: { orientation: "h", y: -0.25, font: { size: 10 } },
    hovermode: "closest",
    uirevision: "keep",
  };
  if (!rangeButtons) delete layout.xaxis!.rangeselector;
  // Plotly pads a marker axis by a share of its span: years of empty future on a 40-year series, which is what the
  // range buttons (counted back from the axis end) then showed. End the axis two weeks after the last date instead.
  if (xEnd !== undefined) (layout.xaxis as Record<string, unknown>).autorangeoptions = { clipmax: iso(xEnd + 14 * 86400000) };
  return layout;
}

/** A ring on the point dated exactly `selected` (the scene on the map), or nothing. */
export function selectedRing(points: Point[], selected: number | undefined): Data[] {
  const p = selected === undefined ? undefined : points.find((q) => q.date === selected);
  if (!p) return [];
  return [
    {
      x: [iso(p.date)],
      y: [p.value],
      type: "scatter",
      mode: "markers",
      marker: { symbol: "circle-open", size: 13, color: "#161922", line: { width: 2, color: "#161922" } },
      hoverinfo: "skip",
      showlegend: false,
    },
  ];
}
