import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import CcdcChart, { type CcdcData } from "./CcdcChart";

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
const T1 = 1612137600000; // 2021-02-01T00:00:00Z
const T2 = 1614556800000; // 2021-03-01T00:00:00Z
const DATA: CcdcData = {
  band: "NDFI",
  observed: [
    { date: T0, value: 0.3 },
    { date: T2, value: -0.2 },
  ],
  segments: [[{ date: T0, value: 0.25 }], [{ date: T2, value: -0.1 }]],
  breaks: [T1],
};
type Trace = { x: unknown[]; y: unknown[]; name?: string; hovertemplate?: string };
const last = () => captured[captured.length - 1];
const traces = () => last().data as Trace[];
const click = (curveNumber: number, pointIndex: number) =>
  last().onClick!({ points: [{ curveNumber, pointIndex }] } as unknown as Readonly<PlotMouseEvent>);

describe("CcdcChart", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("passes the observed points as trace 0 with ISO-string x values, then one trace per segment", () => {
    render(<CcdcChart data={DATA} onClickObserved={() => {}} />);
    expect(traces()).toHaveLength(1 + DATA.segments.length);
    const [observed, seg1, seg2] = traces();
    expect(observed.x).toEqual(["2021-01-01T00:00:00.000Z", "2021-03-01T00:00:00.000Z"]);
    expect(observed.y).toEqual([0.3, -0.2]);
    expect(observed.name).toBe("NDFI observed");
    expect(observed.hovertemplate).toContain("%{x|%Y-%m-%d}");
    expect(seg1.x).toEqual(["2021-01-01T00:00:00.000Z"]);
    expect(seg1.name).toBe("Segment 1");
    expect(seg2.name).toBe("Segment 2");
  });

  it("draws one vertical line per break, positioned by ISO string, and keeps zoom via uirevision", () => {
    render(<CcdcChart data={DATA} onClickObserved={() => {}} />);
    const shapes = last().layout.shapes!;
    expect(shapes).toHaveLength(DATA.breaks.length);
    expect(shapes[0].x0).toBe("2021-02-01T00:00:00.000Z");
    expect(shapes[0].x1).toBe("2021-02-01T00:00:00.000Z");
    expect(shapes[0].yref).toBe("paper");
    expect(last().layout.uirevision).toBe("keep");
  });

  it("re-rendering with the same data hands Plot the same data and layout objects", () => {
    const { rerender } = render(<CcdcChart data={DATA} onClickObserved={() => {}} />);
    const first = last();
    rerender(<CcdcChart data={DATA} onClickObserved={() => {}} />);
    expect(captured).toHaveLength(2);
    expect(last().data).toBe(first.data);
    expect(last().layout).toBe(first.layout);
  });

  it("rebuilds only the layout when the breaks change, and only the traces when the observed points change", () => {
    const noBreaks: number[] = [];
    const { rerender } = render(<CcdcChart data={DATA} onClickObserved={() => {}} />);
    const first = last();
    rerender(<CcdcChart data={{ ...DATA, breaks: noBreaks }} onClickObserved={() => {}} />);
    expect(last().data).toBe(first.data);
    expect(last().layout).not.toBe(first.layout);
    expect(last().layout.shapes).toHaveLength(0);

    const second = last();
    rerender(<CcdcChart data={{ ...DATA, breaks: noBreaks, observed: [DATA.observed[0]] }} onClickObserved={() => {}} />);
    expect(last().data).not.toBe(second.data);
    expect(traces()[0].x).toHaveLength(1);
    expect(last().layout).toBe(second.layout);
  });

  it("a click on trace 0 reports that observed point; a click on a segment trace does not", () => {
    const onClickObserved = vi.fn();
    render(<CcdcChart data={DATA} onClickObserved={onClickObserved} />);
    click(0, 1);
    expect(onClickObserved).toHaveBeenCalledTimes(1);
    expect(onClickObserved).toHaveBeenCalledWith(DATA.observed[1]);
    click(1, 0);
    expect(onClickObserved).toHaveBeenCalledTimes(1);
  });

  it("the click handler keeps its identity across re-renders but reads the latest observed points", () => {
    const onClickObserved = vi.fn();
    const { rerender } = render(<CcdcChart data={DATA} onClickObserved={onClickObserved} />);
    const first = last();
    const next: CcdcData = {
      ...DATA,
      observed: [
        { date: T0, value: 0.9 },
        { date: T2, value: 0.8 },
      ],
    };
    rerender(<CcdcChart data={next} onClickObserved={onClickObserved} />);
    expect(last().onClick).toBe(first.onClick);
    click(0, 1);
    expect(onClickObserved).toHaveBeenCalledWith(next.observed[1]);
  });
});
