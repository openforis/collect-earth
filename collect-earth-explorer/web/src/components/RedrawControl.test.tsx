import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "../App";
import { FakeMap } from "../test/fakeMaplibre";
import { toPolygon } from "../lib/urlParams";

vi.mock("maplibre-gl", async () => {
  const { fakeMaplibreModule } = await import("../test/fakeMaplibre");
  return fakeMaplibreModule();
});
// One probe card standing for every chart: it shows the plot the charts are given.
vi.mock("./charts/CcdcCard", async () => {
  const { usePlot } = await import("../state/PlotContext");
  const Probe = () => <div data-testid="probe">{JSON.stringify(usePlot().plot)}</div>;
  return { default: Probe };
});
vi.mock("./charts/LandsatNdviCard", () => ({ default: () => null }));
vi.mock("./charts/Sentinel2NdviCard", () => ({ default: () => null }));
vi.mock("./charts/ModisCard", () => ({ default: () => null }));
vi.mock("./charts/Sentinel1Card", () => ({ default: () => null }));
vi.mock("./charts/PrecipitationCard", () => ({ default: () => null }));
vi.mock("./charts/HlsCard", () => ({ default: () => null }));

const RING = [[-88.76, 17.25], [-88.759, 17.25], [-88.759, 17.251], [-88.76, 17.251], [-88.76, 17.25]];
const PLOT_URL = `/?geoJson=${encodeURIComponent(JSON.stringify({ type: "Polygon", coordinates: [RING] }))}&startTime=2015-01-01&plot_id=test`;
const TILE = { tileUrl: "https://tiles.example/s2/{z}/{x}/{y}", label: "Sentinel-2 composite 2024-11-01 to 2025-11-01" };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("Redraw polygon", () => {
  const fetchMock = vi.fn();
  let map: FakeMap;
  const tilePlots = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).plot.coordinates[0]);
  const button = (name: string) => screen.getByRole("button", { name });
  const draw = (...corners: [number, number][]) => {
    fireEvent.click(button("Redraw polygon"));
    act(() => corners.forEach(([x, y]) => map.click(x, y)));
  };

  beforeEach(async () => {
    FakeMap.instances.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json(TILE));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", PLOT_URL);
    render(<App />);
    expect(screen.queryByRole("button", { name: "Redraw polygon" })).toBeNull();
    map = FakeMap.instances.at(-1)!;
    act(() => map.fire("load"));
    await screen.findByText(TILE.label);
    expect(tilePlots()).toEqual([RING]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("a drawn polygon replaces the plot: outline, tiles and charts; Original plot returns to the address's", async () => {
    draw([-88.75, 17.25], [-88.749, 17.25], [-88.749, 17.251]);
    expect(screen.getByRole("status").textContent).toBe("Click the corners of the new shape, or one place for a point.");
    expect(map.getCanvas().style.cursor).toBe("crosshair");
    expect(map.doubleClickZoom.disable).toHaveBeenCalled();
    expect(map.sources["redraw"].setData).toHaveBeenCalled();
    fireEvent.click(button("Done"));
    const drawn = [[-88.75, 17.25], [-88.749, 17.25], [-88.749, 17.251], [-88.75, 17.25]];
    await vi.waitFor(() => expect(tilePlots().at(-1)).toEqual(drawn));
    expect(map.sources["plot"].setData).toHaveBeenLastCalledWith(expect.objectContaining({ geometry: { type: "Polygon", coordinates: [drawn] } }));
    expect(JSON.parse((await screen.findByTestId("probe")).textContent!).coordinates[0]).toEqual(drawn);
    // Drawing is over: the draft, its handlers and the crosshair are gone.
    expect(map.sources["redraw"]).toBeUndefined();
    expect(map.handlers.click).toEqual([]);
    expect(map.getCanvas().style.cursor).toBe("");
    expect(map.doubleClickZoom.enable).toHaveBeenCalled();

    fireEvent.click(button("Original plot"));
    await vi.waitFor(() => expect(tilePlots().at(-1)).toEqual(RING));
    expect(screen.queryByRole("button", { name: "Original plot" })).toBeNull();
  });

  it("one corner gives the ~55 m square of a point; Done is disabled with none or two", async () => {
    fireEvent.click(button("Redraw polygon"));
    expect((button("Done") as HTMLButtonElement).disabled).toBe(true);
    act(() => map.click(-88.7, 17.2));
    expect((button("Done") as HTMLButtonElement).disabled).toBe(false);
    act(() => map.click(-88.701, 17.2));
    expect((button("Done") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Cancel"));
    draw([-88.7, 17.2]);
    fireEvent.click(button("Done"));
    await vi.waitFor(() => expect(tilePlots()).toHaveLength(2));
    expect(tilePlots()[1]).toEqual(toPolygon({ type: "Point", coordinates: [-88.7, 17.2] }).coordinates[0]);
  });

  it("Cancel and Escape end drawing and change nothing", () => {
    draw([-88.75, 17.25], [-88.749, 17.25], [-88.749, 17.251]);
    fireEvent.click(button("Cancel"));
    draw([-88.75, 17.25], [-88.749, 17.25], [-88.749, 17.251]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Original plot" })).toBeNull();
    expect(map.sources["redraw"]).toBeUndefined();
    expect(map.handlers.click).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a shape over 100 ha or crossing itself with a message, and keeps drawing", () => {
    draw([0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]);
    fireEvent.click(button("Done"));
    expect(screen.getByRole("alert").textContent).toMatch(/100 ha/);
    expect(button("Done")).toBeTruthy();
    fireEvent.click(button("Cancel"));
    draw([0, 0], [0.001, 0.001], [0.001, 0], [0, 0.001]);
    fireEvent.click(button("Done"));
    expect(screen.getByRole("alert").textContent).toMatch(/crosses itself/);
    // Another corner clears the message.
    act(() => map.click(0.0005, 0.002));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
