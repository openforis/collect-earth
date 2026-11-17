import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGewStatus, fetchImageryStatus, fetchMapConfig, fetchPlotDetail, fetchPlots, fetchStatuses, formUrl, openAuxiliaryWindows, postGewContext } from "./api";
import { MapController } from "./controller";
import type { PlotFeature } from "./types";

vi.mock("./api", () => ({
  fetchMapConfig: vi.fn(), fetchPlots: vi.fn(), fetchPlotDetail: vi.fn(), fetchStatuses: vi.fn(), fetchGewStatus: vi.fn(), fetchImageryStatus: vi.fn(),
  formUrl: vi.fn(), gewMoveCamera: vi.fn(), openAuxiliaryWindows: vi.fn(), postGewContext: vi.fn(), showImagerySource: vi.fn(),
}));

const feature = (id: string): PlotFeature => ({
  type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: { id, latitude: "1", longitude: "2", climate: "10" },
});
/** The index of a plot file of these plots (fetchPlots) */
const index = (ids: string[], plots: string) => ({ ids, labels: ids.map(() => null), latitudes: ids.map(() => 1), longitudes: ids.map(() => 2), plots });

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
    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["1", "2"], "all.csv@1"));
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: { 1: "saved" }, plots: "all.csv@1" });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().order).toEqual(["1", "2"]);
    expect(controller.getSnapshot().statuses["1"]).toBe("saved");
    expect(fetchPlots).toHaveBeenCalledTimes(1);

    // The assigned plot file chosen and applied: the next poll tells it, and its statuses are asked for from the start
    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["7"], "assigned.csv@2"));
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
    vi.mocked(fetchPlots).mockResolvedValueOnce({ ...index([], ""), warning: "No survey plot file loaded" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: {}, plots: "" });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getSnapshot()).toMatchObject({ order: [], loaded: true });

    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["3"], "plots.csv@1"));
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 200, statuses: {}, plots: "plots.csv@1" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getSnapshot().order).toEqual(["3"]);
  });

  it("knows the plots are a training's, and no longer once the plot file is the interpreter's own", async () => {
    vi.mocked(fetchPlots).mockResolvedValueOnce({ ...index(["T-1", "T-3"], "day1.csv@1"), training: "Learning – Day 1" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: {}, plots: "day1.csv@1" });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot()).toMatchObject({ order: ["T-1", "T-3"], training: "Learning – Day 1" });

    // The training over: Collect Earth takes the interpreter's own plot file
    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["1"], "north.csv@2"));
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 200, statuses: {}, plots: "north.csv@2" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getSnapshot()).toMatchObject({ order: ["1"], training: null });
  });

  it("names a plot by the label the index gives, by its place when every key is hidden", async () => {
    vi.mocked(fetchPlots).mockResolvedValueOnce({ ids: ["105,2", "7,1", "9"], labels: ["105", "", null], latitudes: [1, 1, 1], longitudes: [2, 2, 2], plots: "p.csv@1" });
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: {}, plots: "p.csv@1" });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().labels).toEqual({ "105,2": "105", "7,1": "#2", 9: "9" });
  });

  it("opens the generated form at once and draws the plots around it once its details come", async () => {
    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["1", "2"], "all.csv@1"));
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: { 2: "saved" }, plots: "all.csv@1" });
    vi.mocked(formUrl).mockImplementation((f) => "form?id=" + f.properties.id);
    vi.mocked(fetchPlotDetail).mockResolvedValue({ feature: feature("1"), near: [{ id: "1", outline: [[2, 1]] }, { id: "2", outline: [[2, 1.001]] }] });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.selectPlot("1");
    expect(controller.getSnapshot()).toMatchObject({ activeId: "1", formUrl: "form?id=1" });
    expect(vi.mocked(openAuxiliaryWindows).mock.calls[0][0].properties).toMatchObject({ id: "1", latitude: "1", longitude: "2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPlotDetail).toHaveBeenCalledWith("1");
    expect(postGewContext).toHaveBeenCalledWith("1", [{ id: "1", status: "empty", rings: [[[2, 1]]] }, { id: "2", status: "saved", rings: [[[2, 1.001]]] }]);
  });

  it("opens the project's balloon with the row of the plot, and leaves the details of a plot no longer open", async () => {
    vi.mocked(fetchMapConfig).mockResolvedValue({ webForm: "balloon" });
    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["1", "2"], "all.csv@1"));
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: {}, plots: "all.csv@1" });
    vi.mocked(formUrl).mockImplementation((f) => "balloon?id=" + f.properties.id + "&climate=" + (f.properties.climate ?? ""));
    let answerFirst: (d: { feature: PlotFeature; near: [] }) => void = () => {};
    vi.mocked(fetchPlotDetail)
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce({ feature: feature("2"), near: [] });
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.selectPlot("1");
    // no form until the row of the plot is there
    expect(controller.getSnapshot()).toMatchObject({ activeId: "1", formUrl: null });
    controller.selectPlot("2");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot()).toMatchObject({ activeId: "2", formUrl: "balloon?id=2&climate=10" });
    // plot 1's details, come late, change nothing
    answerFirst({ feature: feature("1"), near: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().formUrl).toBe("balloon?id=2&climate=10");
    expect(postGewContext).toHaveBeenCalledTimes(1);
  });

  it("asks for the details again when they did not come, then opens the balloon with what the list knows", async () => {
    vi.mocked(fetchMapConfig).mockResolvedValue({ webForm: "balloon" });
    vi.mocked(fetchPlots).mockResolvedValueOnce(index(["1"], "all.csv@1"));
    vi.mocked(fetchStatuses).mockResolvedValue({ now: 100, statuses: {}, plots: "all.csv@1" });
    vi.mocked(formUrl).mockImplementation((f) => "balloon?id=" + f.properties.id + "&climate=" + (f.properties.climate ?? ""));
    vi.mocked(fetchPlotDetail).mockRejectedValue(new Error("busy"));
    const controller = new MapController();
    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.selectPlot("1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchPlotDetail).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().formUrl).toBe("balloon?id=1&climate=");
  });
});
