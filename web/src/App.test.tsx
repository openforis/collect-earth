import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

vi.mock("./components/MapView", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("./components/CompareMap", () => ({
  default: (p: { leftTileUrl?: string; rightTileUrl?: string }) => (
    <div data-testid="compare-map" data-left={p.leftTileUrl} data-right={p.rightTileUrl} />
  ),
}));
// The series cards fetch and render Plotly; they have their own tests under components/charts.
vi.mock("./components/charts/CcdcCard", () => ({ default: () => <div data-testid="card-ccdc" /> }));
vi.mock("./components/charts/LandsatNdviCard", () => ({ default: () => <div data-testid="card-landsat" /> }));
vi.mock("./components/charts/Sentinel2NdviCard", () => ({ default: () => <div data-testid="card-sentinel2" /> }));
vi.mock("./components/charts/ModisCard", () => ({ default: () => <div data-testid="card-modis" /> }));

const GEOJSON = JSON.stringify({
  type: "MultiLineString",
  coordinates: [[[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]]],
});
const PLOT_URL = `/?geoJson=${encodeURIComponent(GEOJSON)}&startTime=2000-01-01&plot_id=demo`;

const TILE = { tileUrl: "https://tiles.example/s2/{z}/{x}/{y}", label: "Sentinel-2 composite 2024-11-01 to 2025-11-01" };
const LANDSAT_TILE = { tileUrl: "https://tiles.example/landsat/{z}/{x}/{y}", label: "Landsat 2025 composite" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const callsTo = (fetchMock: ReturnType<typeof vi.fn>, url: string) => fetchMock.mock.calls.filter(([u]) => u === url);

describe("App", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    // Answer per endpoint: the compare layer (Landsat by default) is only
    // requested once Compare is ticked.
    fetchMock.mockImplementation(async (url: string) => (url === "/api/tiles/landsat" ? json(LANDSAT_TILE) : json(TILE)));
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
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.queryByTestId("compare-map")).toBeNull();
    expect(screen.getByRole("heading", { name: "Plot demo" })).toBeTruthy();
    expect(screen.getByText(/^2000-01-01 to \d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    expect(screen.getByTestId("card-ccdc")).toBeTruthy();
    expect(screen.getByTestId("card-landsat")).toBeTruthy();
    expect(screen.getByTestId("card-sentinel2")).toBeTruthy();
    expect(screen.getByTestId("card-modis")).toBeTruthy();
    // jsdom's innerWidth (1024) is above the collapse breakpoint: the panel is open.
    expect(screen.getByRole("button", { name: "Layers" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radio", { name: /Sentinel-2/ })).toBeTruthy();
    expect(screen.getByText("Loading imagery…")).toBeTruthy();

    expect(await screen.findByText(TILE.label)).toBeTruthy();
    // Only the primary layer is requested while compare is off.
    expect(screen.queryByText(LANDSAT_TILE.label)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls as [string, RequestInit][];
    expect(url).toBe("/api/tiles/sentinel2");
    const body = JSON.parse(init.body as string);
    expect(body.plot.type).toBe("Polygon");
    expect(body.start).toBe("2000-01-01");
    expect(callsTo(fetchMock, "/api/tiles/landsat")).toHaveLength(0);
  });

  it("shows the imagery error with a Retry button that re-requests the tiles", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    const busy = { error: { code: "busy", message: "Earth Engine is busy", retryable: true } };
    let sentinelCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tiles/landsat") return json(LANDSAT_TILE);
      return ++sentinelCalls === 1 ? json(busy, 503) : json(TILE);
    });
    render(<App />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText(/Imagery failed: Earth Engine is busy/)).toBeTruthy();
    expect(callsTo(fetchMock, "/api/tiles/sentinel2")).toHaveLength(1);

    fireEvent.click(retry);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    expect(callsTo(fetchMock, "/api/tiles/sentinel2")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("ticking Compare swaps the map for the swipe view with both layers' tiles and status lines", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("checkbox", { name: /Compare with/ }));
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText(`Left: ${TILE.label}`)).toBeTruthy();
    // Ticking Compare is what requests the compare layer's tiles.
    expect(screen.getByText("Right: Loading imagery…")).toBeTruthy();
    expect(callsTo(fetchMock, "/api/tiles/landsat")).toHaveLength(1);
    expect(await screen.findByText(`Right: ${LANDSAT_TILE.label}`)).toBeTruthy();
    const compareMap = screen.getByTestId("compare-map");
    expect(compareMap.getAttribute("data-left")).toBe(TILE.tileUrl);
    expect(compareMap.getAttribute("data-right")).toBe(LANDSAT_TILE.tileUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Picking Sentinel-2 for the right-hand side reuses the primary layer's request kind.
    fireEvent.change(screen.getByRole("combobox", { name: "Compare layer" }), { target: { value: "sentinel2" } });
    expect(await screen.findByText(`Right: ${TILE.label}`)).toBeTruthy();
    expect(callsTo(fetchMock, "/api/tiles/sentinel2")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: /Compare with/ }));
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.queryByTestId("compare-map")).toBeNull();
    expect(screen.queryByText(/^Right:/)).toBeNull();
    // Unticking does not request anything.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
