import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import SeriesChart from "./SeriesChart";
import type { Point } from "../../lib/csv";

// react-plotly.js types data/layout as unknown; this is the shape the charts actually pass.
interface Captured {
  data: Data[];
  layout: Partial<Layout>;
  onClick?: (e: Readonly<PlotMouseEvent>) => void;
  style?: { height: number };
}

// Plotly cannot render under jsdom: capture every props object handed to Plot so
// the test can inspect the traces and layout and drive the click handler.
const captured: Captured[] = [];
vi.mock("../Plot", () => ({
  default: (props: Captured) => {
    captured.push(props);
    return <div data-testid="plot" />;
  },
}));

const T0 = 1609459200000; // 2021-01-01T00:00:00Z
const T1 = T0 + 86400000 * 16; // 2021-01-17T00:00:00Z
const POINTS: Point[] = [
  { date: T0, value: 0.4 },
  { date: T1, value: 0.6 },
];
const MARKERS = { x: [T1], name: "Burned", color: "#d32f2f" };
type Trace = { x: unknown[]; y: unknown[]; name?: string; hovertemplate?: string; cliponaxis?: boolean };
const last = () => captured[captured.length - 1];
const traces = () => last().data as Trace[];
const click = (curveNumber: number, pointIndex: number) =>
  last().onClick!({ points: [{ curveNumber, pointIndex }] } as unknown as Readonly<PlotMouseEvent>);

describe("SeriesChart", () => {
  beforeEach(() => {
    captured.length = 0;
    localStorage.clear();
    // Only the trend is on by default; these tests exercise every analysis.
    for (const k of ["median", "change", "unusual", "season"]) localStorage.setItem(`explorer.${k}`, "true");
  });

  it("passes the points as trace 0 with ISO-string x values, and no markers trace by default", () => {
    render(<SeriesChart points={POINTS} name="NDVI" />);
    expect(captured).toHaveLength(1);
    const [trace0, ...rest] = traces();
    expect(trace0.x).toEqual(["2021-01-01T00:00:00.000Z", "2021-01-17T00:00:00.000Z"]);
    expect(trace0.y).toEqual([0.4, 0.6]);
    expect(trace0.name).toBe("NDVI");
    expect(trace0.hovertemplate).toContain("%{x|%Y-%m-%d}");
    expect(rest).toHaveLength(0);
  });

  it("adds a markers trace just below the top of the y range, unclipped, when markers are given", () => {
    render(<SeriesChart points={POINTS} name="NDVI" markers={MARKERS} />);
    expect(traces()).toHaveLength(2);
    const m = traces()[1];
    expect(m.x).toEqual(["2021-01-17T00:00:00.000Z"]);
    expect(m.y).toEqual([1 - 0.03]);
    expect(m.name).toBe("Burned");
    expect(m.cliponaxis).toBe(false);
  });

  it("omits the markers trace when the markers list is empty", () => {
    render(<SeriesChart points={POINTS} name="NDVI" markers={{ ...MARKERS, x: [] }} />);
    expect(traces()).toHaveLength(1);
  });

  it("keeps user zoom across re-renders via a constant uirevision and puts the y range in the layout", () => {
    render(<SeriesChart points={POINTS} name="NDVI" yRange={[0, 1]} />);
    expect(last().layout.uirevision).toBe("keep");
    expect(last().layout.yaxis?.range).toEqual([0, 1]);
  });

  it("re-rendering with the same props hands Plot the same data and layout objects", () => {
    const { rerender } = render(<SeriesChart points={POINTS} name="NDVI" markers={MARKERS} />);
    const first = last();
    rerender(<SeriesChart points={POINTS} name="NDVI" markers={MARKERS} />);
    expect(captured).toHaveLength(2);
    expect(last().data).toBe(first.data);
    expect(last().layout).toBe(first.layout);
  });

  it("rebuilds the data when the points change", () => {
    const { rerender } = render(<SeriesChart points={POINTS} name="NDVI" />);
    const first = last();
    rerender(<SeriesChart points={[POINTS[0]]} name="NDVI" />);
    expect(last().data).not.toBe(first.data);
    expect(traces()[0].x).toHaveLength(1);
  });

  it("a click on trace 0 reports that point; a click on another trace does not", () => {
    const onClickPoint = vi.fn();
    render(<SeriesChart points={POINTS} name="NDVI" markers={MARKERS} onClickPoint={onClickPoint} />);
    click(0, 1);
    expect(onClickPoint).toHaveBeenCalledTimes(1);
    expect(onClickPoint).toHaveBeenCalledWith(POINTS[1]);
    click(1, 0);
    expect(onClickPoint).toHaveBeenCalledTimes(1);
  });

  it("rings the point whose date is the selected scene, and adds nothing when no point has that date", () => {
    render(<SeriesChart points={POINTS} name="NDVI" selected={T1} />);
    expect(traces()).toHaveLength(2);
    const ring = traces()[1] as Trace & { hoverinfo?: string; showlegend?: boolean };
    expect(ring.x).toEqual(["2021-01-17T00:00:00.000Z"]);
    expect(ring.y).toEqual([0.6]);
    expect(ring.hoverinfo).toBe("skip");
    expect(ring.showlegend).toBe(false);
    render(<SeriesChart points={POINTS} name="NDVI" selected={T1 + 1} />);
    expect(traces()).toHaveLength(1);
  });

  it("adds a yearly median trace after trace 0 when the points span three calendar years", () => {
    const pts: Point[] = [
      { date: Date.UTC(2019, 2, 1), value: 0.2 },
      { date: Date.UTC(2020, 2, 1), value: 0.4 },
      { date: Date.UTC(2021, 2, 1), value: 0.6 },
    ];
    render(<SeriesChart points={pts} name="NDVI" />);
    expect(traces()).toHaveLength(2);
    const m = traces()[1] as Trace & { text?: string[] };
    expect(m.name).toBe("Yearly median");
    expect(m.x).toEqual(["2019-07-01T00:00:00.000Z", "2020-07-01T00:00:00.000Z", "2021-07-01T00:00:00.000Z"]);
    expect(m.text).toEqual(["2019", "2020", "2021"]);
    expect(m.hovertemplate).toContain("median");
  });

  // One point per year, 2010 to 2019, rising by 0.1 a year: a significant trend.
  const RISING: Point[] = Array.from({ length: 10 }, (_, i) => ({ date: Date.UTC(2010 + i, 3, 1), value: i / 10 }));
  const names = () => traces().map((t) => t.name);
  const trendLabel = () => screen.queryByText(/^Trend: |^Trend needs 8 years/);
  const changeLabel = () => screen.queryByText(/^Change in|^Change year needs/);
  const help = () => screen.queryByRole("button", { name: /^Explain$|^Hide explanation$/ });
  const untick = (label: string) => fireEvent.click(screen.getByLabelText(label));
  const ALL = ["Yearly median", "Trend", "Change year", "Unusual values", "Seasonal profile"];

  it("one Explain link, closed, shown whenever a result line is; it opens the numbers and the explanation", () => {
    const stepped = Array.from({ length: 20 }, (_, i) => ({ date: Date.UTC(2010 + i, 3, 1), value: i < 10 ? 0.2 : 0.7 }));
    const { container, unmount } = render(<SeriesChart points={stepped} name="NDVI" />);
    expect(container.querySelector(".chart-help")).toBeNull();
    fireEvent.click(help()!);
    const text = container.querySelector(".chart-help")!.textContent!;
    expect(text).toContain("per year, p");
    expect(text).toContain("Most likely change in 2020: median 0.200 before, 0.700 after, p = 0.002.");
    expect(text).toContain("the chance of seeing a trend at least this consistent");
    expect(text).toContain("Cloud filter: removes observations");
    fireEvent.click(help()!);
    expect(container.querySelector(".chart-help")).toBeNull();
    unmount();
    render(<SeriesChart points={RISING.slice(0, 7)} name="NDVI" />);
    ALL.forEach(untick);
    expect(help()).toBeNull();
    expect(trendLabel()).toBeNull();
    untick("Change year");
    expect(help()).not.toBeNull();
  });

  // One point per year from 2010 on, `before` for the first `k` years and `after` for the rest.
  const step = (k: number, n: number, before = 0.2, after = 0.7): Point[] =>
    Array.from({ length: n }, (_, i) => ({ date: Date.UTC(2010 + i, 3, 1), value: i < k ? before : after }));

  it("a significant change year: red dashed line at 1 January below the data, and its result line", () => {
    render(<SeriesChart points={step(10, 20)} name="NDVI" />);
    expect(changeLabel()!.textContent).toBe("Change in 2020: significant");
    const [shape] = last().layout.shapes!;
    expect(shape.x0).toBe("2020-01-01T00:00:00.000Z");
    expect(shape.x1).toBe("2020-01-01T00:00:00.000Z");
    expect(shape.layer).toBe("below");
    expect(shape.line).toEqual({ width: 1.5, dash: "dash", color: "#b00020" });
    expect(last().layout.uirevision).toBe("keep");
    untick("Change year");
    expect(last().layout.shapes).toBeUndefined();
    expect(changeLabel()).toBeNull();
  });

  it("a change year that is not significant is grey; under 8 years it says so", () => {
    const { unmount } = render(<SeriesChart points={step(4, 8)} name="NDVI" />);
    expect(changeLabel()!.textContent).toBe("Change in 2014: not significant");
    expect(last().layout.shapes![0].line!.color).toBe("#8a857b");
    unmount();
    render(<SeriesChart points={step(4, 7)} name="NDVI" />);
    expect(changeLabel()!.textContent).toBe("Change year needs 8 years of data");
    expect(last().layout.shapes).toBeUndefined();
  });

  it("Scene before and Scene after pick the observation nearest its year's median, only with onClickPoint", () => {
    // Three observations a year (median = the June one): the last year before 2020 is 2019.
    const pts = step(10, 20).flatMap((p) => {
      const y = new Date(p.date).getUTCFullYear();
      return [
        { date: Date.UTC(y, 2, 1), value: p.value - 0.05 },
        { date: Date.UTC(y, 5, 1), value: p.value },
        { date: Date.UTC(y, 8, 1), value: p.value + 0.1 },
      ];
    });
    const onClickPoint = vi.fn();
    const { unmount } = render(<SeriesChart points={pts} name="NDVI" onClickPoint={onClickPoint} />);
    fireEvent.click(screen.getByRole("button", { name: "Scene before" }));
    expect(onClickPoint).toHaveBeenLastCalledWith(pts.find((p) => p.date === Date.UTC(2019, 5, 1)));
    fireEvent.click(screen.getByRole("button", { name: "Scene after" }));
    expect(onClickPoint).toHaveBeenLastCalledWith(pts.find((p) => p.date === Date.UTC(2020, 5, 1)));
    unmount();
    const onCompareYears = vi.fn();
    render(<SeriesChart points={pts} name="NDVI" onCompareYears={onCompareYears} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare years" }));
    expect(onCompareYears).toHaveBeenLastCalledWith(2020);
    expect(screen.queryByRole("button", { name: "Scene before" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scene after" })).toBeNull();
  });

  it("Compare scenes passes the least cloudy observation of the 3 months each side of the change, when both exist", () => {
    const yearly = Array.from({ length: 20 }, (_, i) => ({ date: Date.UTC(2010 + i, 5, 1), value: i < 10 ? 0.2 : 0.7 }));
    const near = [
      { date: Date.UTC(2019, 8, 30), value: 0.2, cloud: 0 }, // outside the 3 months
      { date: Date.UTC(2019, 10, 5), value: 0.2, cloud: 30 },
      { date: Date.UTC(2019, 11, 5), value: 0.2, cloud: 5 },
      { date: Date.UTC(2020, 0, 20), value: 0.7, cloud: 8 },
      { date: Date.UTC(2020, 2, 20), value: 0.7, cloud: 8 },
      { date: Date.UTC(2020, 1, 20), value: 0.7 }, // no cloud value: last choice
    ];
    const pts = [...yearly, ...near].sort((a, b) => a.date - b.date);
    const onCompareScenes = vi.fn();
    const { unmount } = render(<SeriesChart points={pts} name="NDVI" onCompareScenes={onCompareScenes} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare scenes" }));
    expect(onCompareScenes).toHaveBeenLastCalledWith(near[2], near[3]);
    unmount();
    render(<SeriesChart points={yearly} name="NDVI" onCompareScenes={onCompareScenes} />);
    expect(screen.queryByRole("button", { name: "Compare scenes" })).toBeNull();
  });

  it("unusual values colour trace 0 per point and add no trace", () => {
    // Jan to Apr over 6 years around 0.5, one January value at 0.10 (see seriesStats.test.ts).
    const usual = [0.5, 0.51, 0.49, 0.5, 0.52, 0.48];
    const pts = [0, 1, 2, 3].flatMap((m) => usual.map((v, i) => ({ date: Date.UTC(2015 + i, m, 10), value: m === 0 && i === 0 ? 0.1 : v })));
    render(<SeriesChart points={pts} name="NDVI" color="#587F2E" />);
    const count = traces().length;
    const colors = (traces()[0] as Trace & { marker: { color: string[] } }).marker.color;
    expect(colors).toHaveLength(pts.length);
    expect(colors.filter((c) => c === "#b00020")).toHaveLength(1);
    expect(colors[0]).toBe("#b00020");
    expect(screen.getByText(/unusually low/).textContent).toBe(
      "1 unusually low observation (red)",
    );
    untick("Unusual values");
    expect(traces()).toHaveLength(count);
    expect((traces()[0] as Trace & { marker: { color: string } }).marker.color).toBe("#587F2E");
    expect(screen.queryByText(/unusually low/)).toBeNull();
  });

  it("the seasonal profile draws band, median and the newest year, and the year select changes that year", () => {
    // Every month of 2018-2020, value = month / 20 + 0.01 per year.
    const pts = [2018, 2019, 2020].flatMap((y, k) => Array.from({ length: 12 }, (_, m) => ({ date: Date.UTC(y, m, 15), value: m / 20 + k * 0.01 })));
    render(<SeriesChart points={pts} name="NDVI" yRange={[0, 1]} />);
    const season = () => [...captured].reverse().find((c) => c.style?.height === 170)!;
    const seasonNames = () => (season().data as Trace[]).map((t) => t.name);
    expect(seasonNames()).toEqual(["Middle half", "Middle half", "Monthly median", "2020"]);
    expect(season().layout.yaxis?.range).toBeUndefined(); // fitted to the profile
    expect(season().layout.xaxis?.rangeselector).toBeUndefined();
    expect((season().data[1] as { fill?: string }).fill).toBe("tonexty");
    expect(screen.getByText(/^Highest in/).textContent).toBe("Highest in December, lowest in January, seasonal swing 0.55");
    const select = screen.getByLabelText("Year to compare") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["No year", "2020", "2019", "2018"]);
    fireEvent.change(select, { target: { value: "2018" } });
    expect(seasonNames()[3]).toBe("2018");
    expect((season().data[3] as Trace).y[11]).toBeCloseTo(0.55);
    fireEvent.change(select, { target: { value: "none" } });
    expect(seasonNames()).toEqual(["Middle half", "Middle half", "Monthly median"]);
    const before = captured.length;
    untick("Seasonal profile");
    expect(captured.slice(before).some((c) => c.style?.height === 170)).toBe(false);
    expect(screen.queryByLabelText("Year to compare")).toBeNull();
  });

  it("draws a dashed red trend from 1 July of the first year to 1 July of the last, after the median", () => {
    render(<SeriesChart points={RISING} name="NDVI" />);
    expect(names()).toEqual(["NDVI", "Yearly median", "Trend"]);
    const t = traces()[2] as Trace & { line: { dash: string; color: string }; hoverinfo: string };
    expect(t.x).toEqual(["2010-07-01T00:00:00.000Z", "2019-07-01T00:00:00.000Z"]);
    expect((t.y as number[])[0]).toBeCloseTo(0, 6);
    expect((t.y as number[])[1]).toBeCloseTo(0.9, 6);
    expect(t.line.dash).toBe("dash");
    expect(t.line.color).toBe("#b00020");
    expect(t.hoverinfo).toBe("skip");
    expect(trendLabel()!.textContent).toBe("Trend: significant increase");
  });

  it("the boxes switch the median and the trend off and on, and the trend stays without the median", () => {
    render(<SeriesChart points={RISING} name="NDVI" />);
    fireEvent.click(screen.getByLabelText("Yearly median"));
    expect(names()).toEqual(["NDVI", "Trend"]);
    fireEvent.click(screen.getByLabelText("Trend"));
    expect(names()).toEqual(["NDVI"]);
    expect(trendLabel()).toBeNull();
    fireEvent.click(screen.getByLabelText("Yearly median"));
    fireEvent.click(screen.getByLabelText("Trend"));
    expect(names()).toEqual(["NDVI", "Yearly median", "Trend"]);
  });

  it("with nothing stored, only the trend is on", () => {
    localStorage.clear();
    render(<SeriesChart points={RISING} name="A" />);
    const on = (screen.getAllByRole("checkbox") as HTMLInputElement[]).filter((c) => c.checked).map((c) => c.getAttribute("aria-label"));
    expect(on).toEqual(["Trend"]);
  });

  it("the choice is shared by every mounted chart and kept in localStorage", () => {
    render(
      <>
        <SeriesChart points={RISING} name="A" />
        <SeriesChart points={RISING} name="B" />
      </>,
    );
    const [first, second] = screen.getAllByLabelText("Trend") as HTMLInputElement[];
    fireEvent.click(first);
    expect(second.checked).toBe(false);
    expect(localStorage.getItem("explorer.trend")).toBe("false");
    const lastOf = (n: string) => [...captured].reverse().find((c) => (c.data as Trace[])[0].name === n)!;
    expect((lastOf("B").data as Trace[]).map((t) => t.name)).toEqual(["B", "Yearly median"]);
  });

  it("still works when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render(<SeriesChart points={RISING} name="NDVI" />);
      // The in-memory fallback lasts the session, so start from whatever it holds.
      const box = screen.getByLabelText("Trend") as HTMLInputElement;
      const before = box.checked;
      fireEvent.click(box);
      expect(box.checked).toBe(!before);
      expect(names().includes("Trend")).toBe(!before);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("says when a trend is not significant, in grey", () => {
    // Up and down, drifting up a little.
    const flat = [0.5, 0.3, 0.6, 0.4, 0.55, 0.35, 0.65, 0.45].map((value, i) => ({ date: Date.UTC(2010 + i, 3, 1), value }));
    render(<SeriesChart points={flat} name="NDVI" />);
    expect(trendLabel()!.textContent).toBe("Trend: not significant");
    expect((traces()[2] as Trace & { line: { color: string } }).line.color).toBe("#8a857b");
  });

  it("says a trend needs 8 years when there are fewer, and draws none", () => {
    render(<SeriesChart points={RISING.slice(0, 7)} name="NDVI" />);
    expect(trendLabel()!.textContent).toBe("Trend needs 8 years of data");
    expect(names()).toEqual(["NDVI", "Yearly median"]);
  });

  it("the click handler keeps its identity across re-renders but reads the latest points", () => {
    const onClickPoint = vi.fn();
    const { rerender } = render(<SeriesChart points={POINTS} name="NDVI" onClickPoint={onClickPoint} />);
    const first = last();
    const newPoints: Point[] = [
      { date: T0, value: 0.1 },
      { date: T1, value: 0.9 },
    ];
    rerender(<SeriesChart points={newPoints} name="NDVI" onClickPoint={onClickPoint} />);
    expect(last().onClick).toBe(first.onClick);
    click(0, 1);
    expect(onClickPoint).toHaveBeenCalledWith(newPoints[1]);
  });
});
