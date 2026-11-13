import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlotProvider, usePlot } from "../../state/PlotContext";
import type { PlotParams } from "../../lib/urlParams";
import type { CcdcChartProps } from "./CcdcChart";
import CcdcCard from "./CcdcCard";

// Plotly cannot render under jsdom: replace the chart with a probe that exposes the
// trace counts and forwards a click as a click on the first observed point.
vi.mock("./CcdcChart", () => ({
  default: ({ data, onClickObserved }: CcdcChartProps) => (
    <div
      data-testid="ccdc-chart"
      data-band={data.band}
      data-observed={data.observed.length}
      data-segments={data.segments.length}
      data-breaks={data.breaks.length}
      onClick={() => onClickObserved(data.observed[0])}
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
const T1 = 1612137600000; // 2021-02-01T00:00:00Z
const RESPONSE = {
  band: "NDFI",
  observed: [{ date: T0, value: 0.3 }],
  segments: [[{ date: T0, value: 0.25 }]],
  breaks: [T1],
};

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

function setup() {
  render(
    <PlotProvider params={params}>
      <CcdcCard />
      <Probe />
    </PlotProvider>,
  );
}

const fetchMock = vi.fn();

function requestAt(i: number) {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(init.body as string) };
}

describe("CcdcCard", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return json({ ...RESPONSE, band: body.band });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /api/ccdc with band NDFI by default and passes observed, segments and breaks to the chart", async () => {
    setup();
    expect(screen.getByRole("heading", { name: /CCDC/ })).toBeTruthy();

    const chart = await screen.findByTestId("ccdc-chart");
    expect(chart.getAttribute("data-band")).toBe("NDFI");
    expect(chart.getAttribute("data-observed")).toBe("1");
    expect(chart.getAttribute("data-segments")).toBe("1");
    expect(chart.getAttribute("data-breaks")).toBe("1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.url).toBe("/api/ccdc");
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ plot: params.plot, start: params.start, end: params.end, band: "NDFI" });
  });

  it("switching the select to NDVI posts again with band NDVI", async () => {
    setup();
    await screen.findByTestId("ccdc-chart");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("NDFI");

    fireEvent.change(select, { target: { value: "NDVI" } });
    expect(select.value).toBe("NDVI");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestAt(1).body.band).toBe("NDVI");
    await vi.waitFor(() => expect(screen.getByTestId("ccdc-chart").getAttribute("data-band")).toBe("NDVI"));
  });

  it("clicking an observed point selects that Landsat scene", async () => {
    setup();
    const chart = await screen.findByTestId("ccdc-chart");
    expect(screen.getByTestId("layer").textContent).toBe("sentinel2");

    fireEvent.click(chart);
    expect(screen.getByTestId("layer").textContent).toBe("scene");
    expect(JSON.parse(screen.getByTestId("scene").textContent!)).toEqual({
      sensor: "landsat",
      timeStart: T0,
      label: "Landsat 2021-01-01",
    });
  });

  it("offers a CSV download once the data is loaded", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "CSV" })).toBeNull();
    await screen.findByTestId("ccdc-chart");
    expect(screen.getByRole("button", { name: "CSV" })).toBeTruthy();
  });
});
