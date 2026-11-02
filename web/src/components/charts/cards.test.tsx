import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlotProvider, usePlot } from "../../state/PlotContext";
import type { PlotParams } from "../../lib/urlParams";
import type { Point } from "../../lib/csv";
import LandsatNdviCard from "./LandsatNdviCard";
import Sentinel2NdviCard from "./Sentinel2NdviCard";
import ModisCard from "./ModisCard";

interface MockChartProps {
  points: Point[];
  markers?: { x: number[] };
  onClickPoint?: (p: Point) => void;
}

// Plotly cannot render under jsdom: replace the chart with a probe that exposes its
// inputs and forwards a click as a click on the first point.
vi.mock("./SeriesChart", () => ({
  default: (props: MockChartProps) => (
    <div
      data-testid="series-chart"
      data-points={props.points.length}
      data-markers={props.markers ? props.markers.x.length : ""}
      onClick={() => props.onClickPoint?.(props.points[0])}
    />
  ),
}));

const params: PlotParams = {
  plot: { type: "Polygon", coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] },
  start: "2000-01-01",
  end: "2025-06-15",
  plotId: "demo",
};

const T0 = 1609459200000; // 2021-01-01T00:00:00Z
const POINT: Point = { date: T0, value: 0.5, sensor: "LANDSAT_8", id: "x" };
const BUSY = { error: { code: "ee_busy", message: "busy", retryable: true } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Exposes the context scene and active layer so a chart click can be observed. */
function Probe() {
  const p = usePlot();
  return (
    <>
      <span data-testid="layer">{p.activeLayer}</span>
      <span data-testid="scene">{p.scene ? JSON.stringify(p.scene) : ""}</span>
    </>
  );
}

function setup(card: ReactNode) {
  render(
    <PlotProvider params={params}>
      {card}
      <Probe />
    </PlotProvider>,
  );
}

const fetchMock = vi.fn();

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(init.body as string) };
}

function expectPlotPost(url: string) {
  const req = lastRequest();
  expect(req.url).toBe(url);
  expect(req.method).toBe("POST");
  expect(req.body.plot).toEqual(params.plot);
  expect(req.body.start).toBe(params.start);
  expect(req.body.end).toBe(params.end);
}

describe("series cards", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("LandsatNdviCard posts to /api/series/landsat and a point click selects that scene", async () => {
    fetchMock.mockResolvedValue(json({ points: [POINT] }));
    setup(<LandsatNdviCard />);
    expect(screen.getByRole("heading", { name: /Landsat NDVI/ })).toBeTruthy();

    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-points")).toBe("1");
    expectPlotPost("/api/series/landsat");
    expect(screen.getByTestId("layer").textContent).toBe("sentinel2");

    fireEvent.click(chart);
    expect(screen.getByTestId("layer").textContent).toBe("scene");
    expect(JSON.parse(screen.getByTestId("scene").textContent!)).toEqual({
      sensor: "landsat",
      timeStart: T0,
      label: "LANDSAT 8 2021-01-01",
    });
  });

  it("Sentinel2NdviCard posts to /api/series/sentinel2 and labels the scene Sentinel-2 <date>", async () => {
    fetchMock.mockResolvedValue(json({ points: [POINT] }));
    setup(<Sentinel2NdviCard />);
    expect(screen.getByRole("heading", { name: /Sentinel-2 NDVI/ })).toBeTruthy();

    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-points")).toBe("1");
    expectPlotPost("/api/series/sentinel2");

    fireEvent.click(chart);
    expect(screen.getByTestId("layer").textContent).toBe("scene");
    expect(JSON.parse(screen.getByTestId("scene").textContent!)).toEqual({
      sensor: "sentinel2",
      timeStart: T0,
      label: "Sentinel-2 2021-01-01",
    });
  });

  it("ModisCard posts to /api/series/modis and passes the NDVI points plus fire markers", async () => {
    fetchMock.mockResolvedValue(
      json({ ndvi: [{ date: T0, value: 0.4 }, { date: T0 + 86400000 * 16, value: 0.6 }], fires: [{ month: 1, date: 2 }] }),
    );
    setup(<ModisCard />);
    expect(screen.getByRole("heading", { name: /MODIS/ })).toBeTruthy();

    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-points")).toBe("2");
    expect(chart.getAttribute("data-markers")).toBe("1");
    expectPlotPost("/api/series/modis");

    // MODIS has no scene to load: clicking does nothing to the context.
    fireEvent.click(chart);
    expect(screen.getByTestId("layer").textContent).toBe("sentinel2");
  });

  it("shows the error and a Retry button on a 503, and Retry re-fetches", async () => {
    fetchMock.mockResolvedValueOnce(json(BUSY, 503)).mockResolvedValueOnce(json({ points: [POINT] }));
    setup(<LandsatNdviCard />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/busy/)).toBeTruthy();
    expect(screen.queryByTestId("series-chart")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-points")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
