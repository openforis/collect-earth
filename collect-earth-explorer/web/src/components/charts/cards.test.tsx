import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlotProvider, usePlot } from "../../state/PlotContext";
import type { PlotParams } from "../../lib/urlParams";
import { resolveConfig } from "../../lib/config";
import * as csv from "../../lib/csv";
import type { Point } from "../../lib/csv";
import LandsatNdviCard from "./LandsatNdviCard";
import Sentinel2NdviCard from "./Sentinel2NdviCard";
import ModisCard from "./ModisCard";

interface MockChartProps {
  points: Point[];
  name?: string;
  markers?: { x: number[] };
  onClickPoint?: (p: Point) => void;
  selected?: number;
}

// Plotly cannot render under jsdom: replace the chart with a probe that exposes its
// inputs and forwards a click as a click on the first point.
vi.mock("./SeriesChart", () => ({
  default: (props: MockChartProps) => (
    <div
      data-testid="series-chart"
      data-points={props.points.length}
      data-name={props.name}
      data-markers={props.markers ? props.markers.x.length : ""}
      data-selected={props.selected ?? ""}
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
    <PlotProvider params={params} config={resolveConfig(undefined, 2026)}>
      {card}
      <Probe />
    </PlotProvider>,
  );
}

/** The standard entry's parameters for a chart type, with `over` applied. */
const paramsOf = (type: string, over: Record<string, unknown> = {}) => ({
  ...resolveConfig(undefined, 2026).charts.find((c) => c.type === type)!.params,
  ...over,
});

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
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("LandsatNdviCard posts to /api/series/landsat and a point click selects that scene", async () => {
    fetchMock.mockResolvedValue(json({ points: [POINT] }));
    setup(<LandsatNdviCard params={paramsOf("landsat-series")} />);
    expect(screen.getByRole("heading", { name: /Landsat NDVI/ })).toBeTruthy();

    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-points")).toBe("1");
    expectPlotPost("/api/series/landsat");
    expect(screen.getByTestId("layer").textContent).toBe("0");

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
    setup(<Sentinel2NdviCard params={paramsOf("sentinel2-series")} />);
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
    setup(<ModisCard params={paramsOf("modis")} />);
    expect(screen.getByRole("heading", { name: /MODIS/ })).toBeTruthy();

    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-points")).toBe("2");
    expect(chart.getAttribute("data-markers")).toBe("1");
    expectPlotPost("/api/series/modis");

    // MODIS has no scene to load: clicking does nothing to the context.
    fireEvent.click(chart);
    expect(screen.getByTestId("layer").textContent).toBe("0");
  });

  it("only the chart of the selected scene's sensor marks it", async () => {
    fetchMock.mockImplementation(async () => json({ points: [POINT] }));
    setup(
      <>
        <LandsatNdviCard params={paramsOf("landsat-series")} />
        <Sentinel2NdviCard params={paramsOf("sentinel2-series")} />
      </>,
    );
    await vi.waitFor(() => expect(screen.getAllByTestId("series-chart")).toHaveLength(2));
    const [landsat, sentinel2] = screen.getAllByTestId("series-chart");
    expect(landsat.getAttribute("data-selected")).toBe("");
    fireEvent.click(landsat);
    expect(landsat.getAttribute("data-selected")).toBe(String(T0));
    expect(sentinel2.getAttribute("data-selected")).toBe("");
    fireEvent.click(sentinel2);
    expect(landsat.getAttribute("data-selected")).toBe("");
    expect(sentinel2.getAttribute("data-selected")).toBe(String(T0));
  });

  it("the cloud select filters what the chart gets (keeping points without cloud), is shared by both cards, and the CSV keeps all", async () => {
    const points = [
      { ...POINT, cloud: 5 },
      { ...POINT, date: T0 + 86400000, cloud: 50 },
      { ...POINT, date: T0 + 2 * 86400000 },
    ];
    fetchMock.mockImplementation(async () => json({ points }));
    const download = vi.spyOn(csv, "downloadText").mockImplementation(() => {});
    setup(
      <>
        <LandsatNdviCard params={paramsOf("landsat-series")} />
        <Sentinel2NdviCard params={paramsOf("sentinel2-series")} />
      </>,
    );
    await vi.waitFor(() => expect(screen.getAllByTestId("series-chart")).toHaveLength(2));
    const selects = screen.getAllByLabelText("Maximum scene cloud cover") as HTMLSelectElement[];
    expect([...selects[0].options].map((o) => o.textContent)).toEqual(["Any cloud", "≤ 80 %", "≤ 60 %", "≤ 40 %", "≤ 20 %", "≤ 10 %"]);
    expect(selects[0].disabled).toBe(false);
    const counts = () => screen.getAllByTestId("series-chart").map((c) => c.getAttribute("data-points"));
    expect(counts()).toEqual(["3", "3"]);
    fireEvent.change(selects[0], { target: { value: "40" } });
    expect(selects[1].value).toBe("40");
    expect(counts()).toEqual(["2", "2"]);
    expect(localStorage.getItem("explorer.maxCloud")).toBe("40");
    fireEvent.click(screen.getAllByRole("button", { name: "CSV" })[0]);
    expect(download.mock.calls.at(-1)![1]).toBe(
      "date,value,sensor,cloud\n2021-01-01,0.5,LANDSAT_8,5\n2021-01-02,0.5,LANDSAT_8,50\n2021-01-03,0.5,LANDSAT_8,\n",
    );
    download.mockRestore();
  });

  it("the cloud select is disabled when no loaded point has cloud", async () => {
    fetchMock.mockResolvedValue(json({ points: [POINT] }));
    setup(<Sentinel2NdviCard params={paramsOf("sentinel2-series")} />);
    await screen.findByTestId("series-chart");
    expect((screen.getByLabelText("Maximum scene cloud cover") as HTMLSelectElement).disabled).toBe(true);
  });

  it("the standard series cards post exactly plot, start and end", async () => {
    fetchMock.mockResolvedValue(json({ points: [POINT] }));
    setup(<LandsatNdviCard params={paramsOf("landsat-series")} />);
    await screen.findByTestId("series-chart");
    expect(Object.keys(lastRequest().body).sort()).toEqual(["end", "plot", "start"]);
  });

  it("an index entry posts its index and names the title, series and CSV after it", async () => {
    fetchMock.mockImplementation(async () => json({ points: [POINT] }));
    const download = vi.spyOn(csv, "downloadText").mockImplementation(() => {});
    for (const [Card, type, url, title, file] of [
      [LandsatNdviCard, "landsat-series", "/api/series/landsat", "Landsat NDMI (click a point to view that scene)", "demo-landsat-ndmi.csv"],
      [Sentinel2NdviCard, "sentinel2-series", "/api/series/sentinel2", "Sentinel-2 NDMI (click a point to view that scene)", "demo-sentinel2-ndmi.csv"],
    ] as const) {
      fetchMock.mockClear();
      const { unmount } = render(
        <PlotProvider params={params} config={resolveConfig(undefined, 2026)}>
          <Card params={paramsOf(type, { index: "NDMI" })} />
        </PlotProvider>,
      );
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      const chart = await screen.findByTestId("series-chart");
      expect(chart.getAttribute("data-name")).toBe("NDMI");
      expectPlotPost(url);
      expect(lastRequest().body.index).toBe("NDMI");
      fireEvent.click(screen.getByRole("button", { name: "CSV" }));
      expect(download.mock.calls.at(-1)![0]).toBe(file);
      unmount();
    }
    download.mockRestore();
  });

  it("a formula entry posts the formula without spaces instead of an index, and names the chart after its name or Custom index", async () => {
    fetchMock.mockImplementation(async () => json({ points: [POINT] }));
    const download = vi.spyOn(csv, "downloadText").mockImplementation(() => {});
    for (const [Card, type, url, sensor, file] of [
      [LandsatNdviCard, "landsat-series", "/api/series/landsat", "Landsat", "landsat"],
      [Sentinel2NdviCard, "sentinel2-series", "/api/series/sentinel2", "Sentinel-2", "sentinel2"],
    ] as const) {
      for (const [name, label, csvName] of [["NDRE", "NDRE", "ndre"], [undefined, "Custom index", "custom-index"]] as const) {
        fetchMock.mockClear();
        const { unmount } = render(
          <PlotProvider params={params} config={resolveConfig(undefined, 2026)}>
            <Card params={paramsOf(type, { formula: " nir / red ", ...(name && { name }) })} />
          </PlotProvider>,
        );
        expect(screen.getByRole("heading", { name: `${sensor} ${label} (click a point to view that scene)` })).toBeTruthy();
        const chart = await screen.findByTestId("series-chart");
        expect(chart.getAttribute("data-name")).toBe(label);
        expectPlotPost(url);
        expect(Object.keys(lastRequest().body).sort()).toEqual(["end", "formula", "plot", "start"]);
        expect(lastRequest().body.formula).toBe("nir/red");
        fireEvent.click(screen.getByRole("button", { name: "CSV" }));
        expect(download.mock.calls.at(-1)![0]).toBe(`demo-${file}-${csvName}.csv`);
        unmount();
      }
    }
    download.mockRestore();
  });

  it("ModisCard with index EVI posts it and names the title, series and CSV after it", async () => {
    fetchMock.mockResolvedValue(json({ ndvi: [{ date: T0, value: 0.4 }], fires: [] }));
    const download = vi.spyOn(csv, "downloadText").mockImplementation(() => {});
    setup(<ModisCard params={paramsOf("modis", { index: "EVI" })} />);
    expect(screen.getByRole("heading", { name: "MODIS 16-day EVI (250 m) and burned area" })).toBeTruthy();
    const chart = await screen.findByTestId("series-chart");
    expect(chart.getAttribute("data-name")).toBe("MODIS EVI");
    expect(lastRequest().body.index).toBe("EVI");
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(download.mock.calls.at(-1)![0]).toBe("demo-modis-evi.csv");
    download.mockRestore();
  });

  it("a collapsed card requests nothing until Show is pressed, then loads as usual", async () => {
    fetchMock.mockImplementation(async (url: string) => json(url.endsWith("modis") ? { ndvi: [POINT], fires: [] } : { points: [POINT] }));
    for (const [Card, type] of [[LandsatNdviCard, "landsat-series"], [Sentinel2NdviCard, "sentinel2-series"], [ModisCard, "modis"]] as const) {
      fetchMock.mockClear();
      const { unmount } = render(
        <PlotProvider params={params} config={resolveConfig(undefined, 2026)}>
          <Card params={paramsOf(type, { collapsed: true })} />
        </PlotProvider>,
      );
      expect(screen.getByRole("heading")).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Show" }));
      await screen.findByTestId("series-chart");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("shows the error and a Retry button on a 503, and Retry re-fetches", async () => {
    fetchMock.mockResolvedValueOnce(json(BUSY, 503)).mockResolvedValueOnce(json({ points: [POINT] }));
    setup(<LandsatNdviCard params={paramsOf("landsat-series")} />);

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
