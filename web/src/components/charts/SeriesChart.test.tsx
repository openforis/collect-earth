import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import SeriesChart from "./SeriesChart";
import type { Point } from "../../lib/csv";

// react-plotly.js types data/layout as unknown; this is the shape the charts actually pass.
interface Captured {
  data: Data[];
  layout: Partial<Layout>;
  onClick?: (e: Readonly<PlotMouseEvent>) => void;
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
