import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

vi.mock("./components/MapView", () => ({ default: () => <div data-testid="map" /> }));
// The series cards fetch and render Plotly; they have their own tests under components/charts.
vi.mock("./components/charts/LandsatNdviCard", () => ({ default: () => <div data-testid="card-landsat" /> }));
vi.mock("./components/charts/Sentinel2NdviCard", () => ({ default: () => <div data-testid="card-sentinel2" /> }));
vi.mock("./components/charts/ModisCard", () => ({ default: () => <div data-testid="card-modis" /> }));

const GEOJSON = JSON.stringify({
  type: "MultiLineString",
  coordinates: [[[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]]],
});

const TILE = { tileUrl: "https://tiles.example/{z}/{x}/{y}", label: "Sentinel-2 composite 2024-11-01 to 2025-11-01" };

describe("App", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(TILE), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("explains the missing geoJson parameter instead of rendering the viewer", () => {
    window.history.replaceState({}, "", "/?");
    render(<App />);
    expect(screen.getByText(/geoJson URL parameter is required/)).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the map, plot heading and the sentinel-2 tile label for a valid URL", async () => {
    window.history.replaceState({}, "", `/?geoJson=${encodeURIComponent(GEOJSON)}&startTime=2000-01-01&plot_id=demo`);
    render(<App />);
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plot demo" })).toBeTruthy();
    expect(screen.getByText(/^2000-01-01 to \d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    expect(screen.getByTestId("card-landsat")).toBeTruthy();
    expect(screen.getByTestId("card-sentinel2")).toBeTruthy();
    expect(screen.getByTestId("card-modis")).toBeTruthy();
    expect(screen.getByText("Layers")).toBeTruthy();
    expect(screen.getByText("Loading imagery…")).toBeTruthy();

    expect(await screen.findByText(TILE.label)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tiles/sentinel2");
    const body = JSON.parse(init.body as string);
    expect(body.plot.type).toBe("Polygon");
    expect(body.start).toBe("2000-01-01");
  });

  it("shows the imagery error with a Retry button that re-requests the tiles", async () => {
    window.history.replaceState({}, "", `/?geoJson=${encodeURIComponent(GEOJSON)}&startTime=2000-01-01&plot_id=demo`);
    const busy = { error: { code: "busy", message: "Earth Engine is busy", retryable: true } };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(busy), { status: 503, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(TILE), { status: 200, headers: { "content-type": "application/json" } }));
    render(<App />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/Imagery failed: Earth Engine is busy/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
