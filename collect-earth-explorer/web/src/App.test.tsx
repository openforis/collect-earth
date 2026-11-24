import { parsePlotUrl } from "./lib/urlParams";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import App from "./App";

// What a test makes throw while rendering: the map, or the card of one chart type.
const crash = vi.hoisted(() => ({ map: false, card: "" }));
vi.mock("./components/MapView", () => ({
  default: (p: { tileUrl?: string }) => {
    if (crash.map) throw new Error("map broke");
    return <div data-testid="map" data-tile={p.tileUrl} />;
  },
}));
vi.mock("./components/CompareMap", () => ({
  default: (p: { leftTileUrl?: string; rightTileUrl?: string }) => (
    <div data-testid="compare-map" data-left={p.leftTileUrl} data-right={p.rightTileUrl} />
  ),
}));
// The series cards fetch and render Plotly; they have their own tests under components/charts.
// Each probe shows the params its entry passed it.
const card = (id: string) => ({
  default: (p: { params: object }) => {
    if (crash.card === id) throw new Error("card broke");
    return <div data-testid={`card-${id}`} data-params={JSON.stringify(p.params)} />;
  },
});
vi.mock("./components/charts/CcdcCard", () => card("ccdc"));
vi.mock("./components/charts/LandsatNdviCard", () => card("landsat"));
vi.mock("./components/charts/Sentinel2NdviCard", () => card("sentinel2"));
vi.mock("./components/charts/ModisCard", () => card("modis"));
vi.mock("./components/charts/Sentinel1Card", () => card("sentinel1"));
vi.mock("./components/charts/PrecipitationCard", () => card("precipitation"));

const GEOJSON = JSON.stringify({
  type: "MultiLineString",
  coordinates: [[[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]]],
});
const PLOT_URL = `/?geoJson=${encodeURIComponent(GEOJSON)}&startTime=2000-01-01&plot_id=demo`;

const TILE = { tileUrl: "https://tiles.example/s2/{z}/{x}/{y}", label: "Sentinel-2 composite 2024-11-01 to 2025-11-01" };
const LANDSAT_TILE = { tileUrl: "https://tiles.example/landsat/{z}/{x}/{y}", label: "Landsat 2025 composite" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cardIds = () => screen.queryAllByTestId(/^card-/).map((c) => c.getAttribute("data-testid"));
const withConfig = (config: object) => `${PLOT_URL}&config=${encodeURIComponent(JSON.stringify(config))}`;
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const firstBody = (fetchMock: ReturnType<typeof vi.fn>) => bodyOf(fetchMock.mock.calls[0]);
const lastBody = (fetchMock: ReturnType<typeof vi.fn>) => bodyOf(fetchMock.mock.calls.at(-1)!);
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
    crash.map = false;
    crash.card = "";
  });

  it("explains the missing geoJson parameter instead of rendering the viewer", () => {
    window.history.replaceState({}, "", "/?");
    render(<App />);
    expect(screen.getByText(/No plot in the address/)).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers sample plots whose links are valid plot URLs", () => {
    window.history.replaceState({}, "", "/?");
    render(<App />);
    const links = within(screen.getAllByRole("list")[0]).getAllByRole("link");
    expect(links.length).toBe(3);
    for (const a of links) expect(parsePlotUrl(a.getAttribute("href")!).plotId).toBe(a.textContent);
  });

  it("shows, below the sample plots, help with links to the dashboard and the setup page", async () => {
    window.history.replaceState({}, "", "/?");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "How it fits together" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "cloud.collectearth.org" }).getAttribute("href")).toBe("https://cloud.collectearth.org");
    expect(screen.getByRole("link", { name: "Try the setup page" }).getAttribute("href")).toBe("/configure?lang=en");
  });

  it("renders the map, plot heading and the sentinel-2 tile label for a valid URL", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.queryByTestId("compare-map")).toBeNull();
    expect(screen.getByRole("heading", { name: "Plot demo" })).toBeTruthy();
    expect(screen.getByText(/^2000-01-01 to \d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    expect(screen.getByText("Loading imagery…")).toBeTruthy();
    // The cards are lazy-loaded: a placeholder first, then the (mocked) cards.
    expect(screen.getByText("Loading charts…")).toBeTruthy();
    expect(await screen.findByTestId("card-ccdc")).toBeTruthy();
    expect(screen.getByTestId("card-landsat")).toBeTruthy();
    expect(screen.getByTestId("card-sentinel2")).toBeTruthy();
    expect(screen.getByTestId("card-modis")).toBeTruthy();
    expect(screen.getByTestId("card-sentinel1")).toBeTruthy();
    expect(screen.queryByText("Loading charts…")).toBeNull();
    // jsdom has no matchMedia, which the panel treats as a wide screen: the panel is open.
    expect(screen.getByRole("button", { name: "Layers" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radio", { name: /Sentinel-2/ })).toBeTruthy();
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    // Only the primary layer is requested while compare is off.
    expect(screen.queryByText(LANDSAT_TILE.label)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls as [string, RequestInit][];
    expect(url).toBe("/api/tiles/sentinel2");
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body)).toEqual(["plot", "start", "end"]);
    expect(body.plot.type).toBe("Polygon");
    expect(body.start).toBe("2000-01-01");
    expect(callsTo(fetchMock, "/api/tiles/landsat")).toHaveLength(0);
  });

  it("reads the plot from the address fragment Collect Earth builds", async () => {
    window.history.replaceState({}, "", `/#geoJson=${encodeURIComponent(GEOJSON)};plotId=frag;startTime=2000-01-01;`);
    render(<App />);
    expect(screen.getByRole("heading", { name: "Plot frag" })).toBeTruthy();
    expect(await screen.findByText(TILE.label)).toBeTruthy();
  });

  it("opens the configuration's first layer: a Landsat entry requests Landsat tiles for its year", async () => {
    const config = { v: 1, layers: [{ type: "landsat", years: [2000, 2010], label: "Landsat 2000s" }, { type: "sentinel2" }] };
    window.history.replaceState({}, "", withConfig(config));
    render(<App />);
    expect(await screen.findByText(LANDSAT_TILE.label)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls as [string, RequestInit][];
    expect(url).toBe("/api/tiles/landsat");
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body)).toEqual(["plot", "start", "end", "year"]);
    expect(body.year).toBe(2010);
  });

  it("sends a Sentinel-2 entry's non-default parameters, its dates as the composite window", async () => {
    const entry = { type: "sentinel2", bands: "true-colour", maxCloud: 70, start: "2022-01-01", end: "2022-07-01" };
    window.history.replaceState({}, "", withConfig({ v: 1, layers: [entry, { type: "sentinel2", maxCloud: 20 }] }));
    render(<App />);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(Object.keys(body)).toEqual(["plot", "start", "end", "bands", "compositeStart", "compositeEnd"]);
    expect(body).toMatchObject({ bands: "true-colour", compositeStart: "2022-01-01", compositeEnd: "2022-07-01" });
    // Another entry of the same type with other parameters is a separate request.
    fireEvent.click(screen.getByRole("radio", { name: "Sentinel-2, last 12 months" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(Object.keys(second)).toEqual(["plot", "start", "end", "maxCloud"]);
    expect(second.maxCloud).toBe(20);
  });

  it("sends a Landsat entry's non-default parameters after the year", async () => {
    window.history.replaceState({}, "", withConfig({ v: 1, layers: [{ type: "landsat", bands: "true-colour", maxCloud: 30 }] }));
    render(<App />);
    expect(await screen.findByText(LANDSAT_TILE.label)).toBeTruthy();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(Object.keys(body)).toEqual(["plot", "start", "end", "year", "bands", "maxCloud"]);
    expect(body).toMatchObject({ bands: "true-colour", maxCloud: 30 });
  });

  it("a Sentinel-2 year requests that calendar year's composite; the last 12 months send no window", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Sentinel-2 year" }), { target: { value: "2020" } });
    expect(screen.getByRole("radio", { name: "Sentinel-2 2020" })).toBeTruthy();
    // Debounced: nothing is requested until the slider rests.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastBody(fetchMock)).toEqual({ ...firstBody(fetchMock), compositeStart: "2020-01-01", compositeEnd: "2021-01-01" });
    const slider = screen.getByRole("slider", { name: "Sentinel-2 year" }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: slider.max } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(lastBody(fetchMock)).toEqual(firstBody(fetchMock));
  });

  it("the band selector re-requests the row's tiles, sending bands only when not the default, and keeps the active layer", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Sentinel-2 bands" }), { target: { value: "true-colour" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/tiles/sentinel2");
    expect(Object.keys(lastBody(fetchMock))).toEqual(["plot", "start", "end", "bands"]);
    expect(lastBody(fetchMock).bands).toBe("true-colour");
    expect((screen.getByRole("radio", { name: "Sentinel-2, last 12 months" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Sentinel-2 bands" }), { target: { value: "false-colour" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(lastBody(fetchMock)).toEqual(firstBody(fetchMock));
  });

  it("each side of Compare follows its own row's year and bands; a row compared with itself still reuses the left tiles", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Compare with/ }));
    expect(await screen.findByText(`Right: ${LANDSAT_TILE.label}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByRole("combobox", { name: "Landsat bands" }), { target: { value: "true-colour" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/tiles/landsat");
    expect(lastBody(fetchMock).bands).toBe("true-colour");

    fireEvent.change(screen.getByRole("slider", { name: "Sentinel-2 year" }), { target: { value: "2019" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).toBe("/api/tiles/sentinel2");
    expect(lastBody(fetchMock)).toMatchObject({ compositeStart: "2019-01-01", compositeEnd: "2020-01-01" });
    expect(lastBody(fetchMock).bands).toBeUndefined();
    // The slider moved while comparing: Sentinel-2 stays on the left.
    expect((screen.getByRole("radio", { name: "Sentinel-2 2019" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "Compare layer" }), { target: { value: "0" } });
    expect(await screen.findByText(`Right: ${TILE.label}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("without a configuration shows the six standard cards in order, Sentinel-1 and rainfall collapsed, and no notice", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    await screen.findByTestId("card-ccdc");
    expect(cardIds()).toEqual(["card-landsat", "card-sentinel2", "card-ccdc", "card-modis", "card-sentinel1", "card-precipitation"]);
    expect(JSON.parse(screen.getByTestId("card-sentinel1").getAttribute("data-params")!).collapsed).toBe(true);
    expect(JSON.parse(screen.getByTestId("card-precipitation").getAttribute("data-params")!).collapsed).toBe(true);
    expect(JSON.parse(screen.getByTestId("card-ccdc").getAttribute("data-params")!).band).toBe("NDFI");
    expect(screen.queryByText(/settings were partly ignored/)).toBeNull();
  });

  it("shows only the configuration's charts, passing each its params", async () => {
    window.history.replaceState({}, "", withConfig({ v: 1, charts: [{ type: "modis" }, { type: "ccdc", band: "NDVI" }] }));
    render(<App />);
    await screen.findByTestId("card-modis");
    expect(cardIds()).toEqual(["card-modis", "card-ccdc"]);
    expect(JSON.parse(screen.getByTestId("card-ccdc").getAttribute("data-params")!).band).toBe("NDVI");
    // The layers half is standard: the map still opens on Sentinel-2.
    expect(await screen.findByText(TILE.label)).toBeTruthy();
    expect(callsTo(fetchMock, "/api/tiles/sentinel2")).toHaveLength(1);
  });

  it("puts a summary line per open Landsat/Sentinel-2 chart above the charts, each card in a box its line scrolls to", async () => {
    window.history.replaceState({}, "", withConfig({ v: 1, charts: [{ type: "modis" }, { type: "landsat-series", index: "NDMI" }, { type: "sentinel2-series", collapsed: true }] }));
    render(<App />);
    const summary = screen.getByRole("list", { name: "Summary" });
    expect(summary.textContent).toBe("Landsat NDMI: loading…");
    expect((await screen.findByTestId("card-landsat")).parentElement!.id).toBe("chart-1");
  });

  it("reads the configuration from the fragment and lists what it skipped above the charts", async () => {
    const config = { v: 1, layers: [{ type: "planet" }, { type: "landsat" }], charts: [] };
    window.history.replaceState(
      {},
      "",
      `/#geoJson=${encodeURIComponent(GEOJSON)};plotId=frag;startTime=2000-01-01;config=${encodeURIComponent(JSON.stringify(config))};`,
    );
    render(<App />);
    const notice = screen.getByText(/^This survey's Explorer settings were partly ignored:/);
    expect(notice.className).toBe("config-notice");
    expect(notice.textContent).toContain("planet");
    // An empty chart list is honoured: heading, dates and the notice only.
    expect(screen.getByRole("heading", { name: "Plot frag" })).toBeTruthy();
    expect(screen.queryByText("Loading charts…")).toBeNull();
    expect(cardIds()).toEqual([]);
    expect(await screen.findByText(LANDSAT_TILE.label)).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  // A 500 the server marks retryable: a 503 or 429 is retried by postApi itself first (api.test.ts).
  it("shows a retryable imagery error with a Retry button that re-requests the tiles", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    const busy = { error: { code: "busy", message: "Earth Engine is busy", retryable: true } };
    let sentinelCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tiles/landsat") return json(LANDSAT_TILE);
      return ++sentinelCalls === 1 ? json(busy, 500) : json(TILE);
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

  it("shows a non-retryable (404) imagery error without a Retry button", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    const missing = { error: { code: "no_imagery", message: "No imagery for this plot", retryable: false } };
    fetchMock.mockImplementation(async () => json(missing, 404));
    render(<App />);

    expect(await screen.findByText(/Imagery failed: No imagery for this plot/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(callsTo(fetchMock, "/api/tiles/sentinel2")).toHaveLength(1);
  });

  it("comparing a layer with itself reuses the left tiles for the right side instead of requesting twice", async () => {
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(await screen.findByText(TILE.label)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /Compare with/ }));
    expect(await screen.findByText(`Right: ${LANDSAT_TILE.label}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Right = Sentinel-2 = left: no third request, both sides show the same tiles and label.
    fireEvent.change(screen.getByRole("combobox", { name: "Compare layer" }), { target: { value: "0" } });
    expect(screen.getByText(`Left: ${TILE.label}`)).toBeTruthy();
    expect(screen.getByText(`Right: ${TILE.label}`)).toBeTruthy();
    const compareMap = screen.getByTestId("compare-map");
    expect(compareMap.getAttribute("data-left")).toBe(TILE.tileUrl);
    expect(compareMap.getAttribute("data-right")).toBe(TILE.tileUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Moving the right side back to Landsat requests it again (the hook was paused, its data kept).
    fireEvent.change(screen.getByRole("combobox", { name: "Compare layer" }), { target: { value: "1" } });
    expect(await screen.findByText(`Right: ${LANDSAT_TILE.label}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    // Sentinel-2 against Landsat: no difference between two sensors.
    expect((screen.getByRole("checkbox", { name: /Difference/ }) as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Compare with/ }));
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.queryByTestId("compare-map")).toBeNull();
    expect(screen.queryByText(/^Right:/)).toBeNull();
    // Unticking does not request anything.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ticking Difference posts tiles/difference with both sides and shows one map; unticking returns to the swipe", async () => {
    const CHANGE = { tileUrl: "https://tiles.example/change/{z}/{x}/{y}", label: "NDVI change: a → b" };
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/tiles/landsat" ? json(LANDSAT_TILE) : url === "/api/tiles/difference" ? json(CHANGE) : json(TILE),
    );
    // Two Landsat years: a difference needs the same sensor on both sides.
    window.history.replaceState({}, "", withConfig({ v: 1, layers: [{ type: "landsat", year: 2010 }, { type: "landsat" }] }));
    render(<App />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Compare with/ }));
    expect(await screen.findByText(`Right: ${LANDSAT_TILE.label}`)).toBeTruthy();
    const landsatYear = bodyOf(callsTo(fetchMock, "/api/tiles/landsat")[1]).year;

    fireEvent.click(screen.getByRole("checkbox", { name: /Difference/ }));
    expect(await screen.findByText(CHANGE.label)).toBeTruthy();
    expect(screen.queryByTestId("compare-map")).toBeNull();
    expect(screen.getByTestId("map").getAttribute("data-tile")).toBe(CHANGE.tileUrl);
    expect(screen.queryByText(/^(Left|Right):/)).toBeNull();
    const calls = callsTo(fetchMock, "/api/tiles/difference");
    expect(calls).toHaveLength(1);
    const body = bodyOf(calls[0]);
    expect(body.left).toEqual({ path: "tiles/landsat", year: 2010 });
    expect(body.right).toEqual({ path: "tiles/landsat", year: landsatYear });
    expect(body.plot.type).toBe("Polygon");

    fireEvent.click(screen.getByRole("checkbox", { name: /Difference/ }));
    expect(screen.getByTestId("compare-map")).toBeTruthy();
    expect(await screen.findByText(`Right: ${LANDSAT_TILE.label}`)).toBeTruthy();
    expect(callsTo(fetchMock, "/api/tiles/difference")).toHaveLength(1);
  });

  // After the tests above: rendering a card here loads the lazy chunks, and one above expects their fallback.
  it("a Polygon without a usable outline ends on the welcome page's bad-plot text", () => {
    window.history.replaceState({}, "", `/?geoJson=${encodeURIComponent('{"type":"Polygon","coordinates":[]}')}`);
    render(<App />);
    expect(screen.getByText(/The plot in the address cannot be read/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a chart card that throws leaves a line in its place and the rest of the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crash.card = "landsat";
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(await screen.findByText("This chart could not be shown.")).toBeTruthy();
    expect(screen.getByTestId("card-ccdc")).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
    vi.mocked(console.error).mockRestore();
  });

  it("a viewer that throws shows the welcome page's bad-plot text instead of a blank page", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crash.map = true;
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(screen.getByText(/The plot in the address cannot be read/)).toBeTruthy();
    vi.mocked(console.error).mockRestore();
  });
});
