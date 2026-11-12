import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGewStatus, fetchImageryStatus, fetchMapConfig, fetchPlots, fetchStatuses } from "./api";
import { MapController } from "./controller";
import type { PlotFeature } from "./types";

vi.mock("./api", () => ({
  fetchMapConfig: vi.fn(), fetchPlots: vi.fn(), fetchStatuses: vi.fn(), fetchGewStatus: vi.fn(), fetchImageryStatus: vi.fn(),
  formUrl: vi.fn(), gewMoveCamera: vi.fn(), openAuxiliaryWindows: vi.fn(), postGewContext: vi.fn(), showImagerySource: vi.fn(),
}));

const plot = (id: string): PlotFeature => ({
  type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: { id, latitude: "1", longitude: "2" },
});

describe("the plot list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:8028" }, addEventListener: vi.fn(),
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (id: number) => clearTimeout(id),
    });
    vi.mocked(fetchMapConfig).mockResolvedValue({});
    vi.mocked(fetchGewStatus).mockRejectedValue(new Error("not now"));
    vi.mocked(fetchImageryStatus).mockRejectedValue(new Error("not now"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it("loads the plots of another plot file once the statuses tell it, as after Apply in the settings", async () => {
    vi.mocked(fetchPlots).mockResolvedValueOnce({ features: [plot("1"), plot("2")], plots: "all.csv@1" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: { 1: "saved" }, plots: "all.csv@1" });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().order).toEqual(["1", "2"]);
    expect(controller.getSnapshot().statuses["1"]).toBe("saved");
    expect(fetchPlots).toHaveBeenCalledTimes(1);

    // The assigned plot file chosen and applied: the next poll tells it, and its statuses are asked for from the start
    vi.mocked(fetchPlots).mockResolvedValueOnce({ features: [plot("7")], plots: "assigned.csv@2" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 200, statuses: {}, plots: "assigned.csv@2" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getSnapshot().order).toEqual(["7"]);
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 300, statuses: { 7: "partial" }, plots: "assigned.csv@2" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.mocked(fetchStatuses).mock.calls.at(-1)).toEqual([null]);
    expect(controller.getSnapshot().statuses["7"]).toBe("partial");
    expect(fetchPlots).toHaveBeenCalledTimes(2);
  });

  it("loads the plots once there is a plot file, when there was none", async () => {
    vi.mocked(fetchPlots).mockResolvedValueOnce({ features: [], warning: "No survey plot file loaded", plots: "" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: {}, plots: "" });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getSnapshot()).toMatchObject({ order: [], loaded: true });

    vi.mocked(fetchPlots).mockResolvedValueOnce({ features: [plot("3")], plots: "plots.csv@1" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 200, statuses: {}, plots: "plots.csv@1" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getSnapshot().order).toEqual(["3"]);
  });
});
