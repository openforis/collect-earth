import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Configure from "./Configure";

const open = (config?: string) => {
  window.history.replaceState(null, "", config === undefined ? "/configure" : `/configure?config=${encodeURIComponent(config)}`);
  return render(<Configure />);
};
const row = (name: RegExp) => screen.getByRole("button", { name });
const lastConfig = (post: ReturnType<typeof vi.fn>) => post.mock.calls.at(-1)![0];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Configure", () => {
  it("tells the host what to store, on load and after every change", () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    open();
    expect(post).toHaveBeenLastCalledWith({ source: "collect-earth-explorer", type: "config", config: "", valid: true }, "*");
    fireEvent.click(row(/1\. Landsat index over time/));
    fireEvent.change(screen.getByLabelText("Index"), { target: { value: "NBR" } });
    expect(lastConfig(post).config).toContain('{"type":"landsat-series","index":"NBR"}');
    expect(lastConfig(post).valid).toBe(true);
    parent.mockRestore();
  });

  it("replaces the setup with a starting point, and Undo brings the previous one back", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Cloudy tropics/ }));
    expect(screen.getByRole("status")).toHaveTextContent("The setup was replaced by the “Cloudy tropics” starting point.");
    expect(row(/1\. Sentinel-1 radar composite/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(row(/1\. Sentinel-2 composite/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Fire/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back to the standard window" }));
    expect(screen.getByRole("status")).toHaveTextContent("The standard window was restored.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(row(/1\. Landsat index over time · |1\. Landsat index over time/)).toHaveTextContent("NBR");
  });

  it("shows one entry open at a time, its summary on the row", () => {
    open('{"charts":[{"type":"landsat-series","trend":false,"maxCloud":"20","collapsed":true},{"type":"ccdc"}]}');
    const first = row(/1\. Landsat index over time/);
    expect(first).toHaveTextContent("Trend off, cloud limit 20 %, folded");
    expect(first).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Analyses shown when the chart opens" })).toBeInTheDocument();
    // The cloud limit is under More options.
    expect(screen.queryByLabelText("Most cloud cover allowed (%)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByLabelText("Most cloud cover allowed (%)")).toHaveValue("20");
    fireEvent.click(row(/2\. Change over time/));
    expect(first).toHaveAttribute("aria-expanded", "false");
  });

  it("switches a Sentinel-2 layer between the year slider and a fixed period, clearing the other's values", () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    open('{"layers":[{"type":"sentinel2","year":2020}]}');
    fireEvent.click(row(/1\. Sentinel-2 composite/));
    expect(screen.getByLabelText("Year shown first")).toHaveValue(2020);
    fireEvent.click(screen.getByLabelText("Fixed period"));
    expect(screen.queryByLabelText("Year shown first")).not.toBeInTheDocument();
    // Both dates are needed: not valid until they are set, the error tied to the field.
    expect(lastConfig(post).valid).toBe(false);
    expect(screen.getByLabelText("Start date")).toHaveAccessibleDescription("Enter a date, or choose the year slider above");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2019-06-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2019-09-30" } });
    expect(lastConfig(post)).toMatchObject({ valid: true, config: expect.stringContaining('{"type":"sentinel2","start":"2019-06-01","end":"2019-09-30"}') });
    fireEvent.click(screen.getByLabelText("Year slider"));
    expect(lastConfig(post).config).toContain('"layers":[{"type":"sentinel2"}]');
    parent.mockRestore();
  });

  it("offers a custom formula at the end of the index list, and a named index clears it", () => {
    open('{"charts":[{"type":"sentinel2-series"}]}');
    fireEvent.click(row(/1\. Sentinel-2 index over time/));
    expect(screen.queryByLabelText("Formula")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Index"), { target: { value: "*custom" } });
    expect(screen.getByLabelText("Formula")).toHaveAccessibleDescription(/^Enter a formula, or choose a named index above Bands: blue/);
    fireEvent.change(screen.getByLabelText("Formula"), { target: { value: "(nir - rededge1) / (nir + rededge1)" } });
    expect(screen.getByLabelText("Formula")).toHaveAccessibleDescription(/^Bands: blue, green, red, nir, swir1, swir2, rededge1/);
    fireEvent.change(screen.getByLabelText("Name of your formula"), { target: { value: "NDRE" } });
    expect(row(/1\. Sentinel-2 index over time/)).toHaveTextContent("NDRE");
    fireEvent.change(screen.getByLabelText("Index"), { target: { value: "EVI" } });
    expect(screen.queryByLabelText("Formula")).not.toBeInTheDocument();
    expect(row(/1\. Sentinel-2 index over time/)).toHaveTextContent("EVI");
  });

  it("gives every chart optional From year and To year fields, blank for everything available", () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    open('{"charts":[{"type":"modis"}]}');
    fireEvent.click(row(/^1\. MODIS/));
    expect(screen.getByRole("group", { name: "Years shown" })).toHaveTextContent("Leave both blank to show all the years available.");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2020" } });
    fireEvent.change(screen.getByLabelText("To year"), { target: { value: "2015" } });
    expect(screen.getByLabelText("To year")).toHaveAccessibleDescription("The first year must not be after the last");
    expect(lastConfig(post).valid).toBe(false);
    fireEvent.change(screen.getByLabelText("To year"), { target: { value: "" } });
    expect(lastConfig(post)).toMatchObject({ valid: true, config: expect.stringContaining('{"type":"modis","startYear":2020}') });
    expect(row(/^1\. MODIS/)).toHaveTextContent("from 2020");
    parent.mockRestore();
  });

  it("chooses the rainfall chart's dataset, each option saying its detail, start and area, and its Against normal switch", () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    open('{"charts":[{"type":"precipitation"}]}');
    fireEvent.click(row(/^1\. Monthly rainfall/));
    expect(screen.getByRole("option", { name: "CHIRPS: about 5 km, from 1981, latitudes 50°S to 50°N, with rain gauges" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rainfall data"), { target: { value: "imerg" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Against normal" }));
    expect(lastConfig(post)).toMatchObject({ valid: true, config: expect.stringContaining('{"type":"precipitation","dataset":"imerg","anomaly":true}') });
    fireEvent.change(screen.getByLabelText("Rainfall data"), { target: { value: "era5-land" } });
    expect(lastConfig(post).config).toContain('{"type":"precipitation","anomaly":true}');
    parent.mockRestore();
  });

  it("keeps the last layer, but lets every chart go", () => {
    open('{"layers":[{"type":"landsat"}],"charts":[{"type":"ccdc"}]}');
    const [layers, charts] = screen.getAllByRole("list").filter((l) => l.tagName === "OL");
    expect(within(layers).getByRole("button", { name: "Remove" })).toBeDisabled();
    fireEvent.click(within(charts).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No charts: the window shows only the map.")).toBeInTheDocument();
  });

  it("describes each type in the Add menu and opens the one added", () => {
    open();
    const add = screen.getByRole("button", { name: "+ Add layer" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: /Sentinel-1 radar composite Radar: sees through cloud/ }));
    expect(row(/4\. Sentinel-1 radar composite/)).toHaveAttribute("aria-expanded", "true");
  });

  it("adds the HLS chart, which takes the six Landsat bands in a formula", () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    open('{"charts":[{"type":"ccdc"}]}');
    fireEvent.click(screen.getByRole("button", { name: "+ Add chart" }));
    fireEvent.click(screen.getByRole("button", { name: /Landsat and Sentinel-2 \(HLS\) index over time Landsat and Sentinel-2 combined/ }));
    expect(lastConfig(post).config).toContain('{"type":"hls-series"}');
    fireEvent.change(screen.getByLabelText("Index"), { target: { value: "*custom" } });
    fireEvent.change(screen.getByLabelText("Formula"), { target: { value: "(nir - rededge1) / (nir + rededge1)" } });
    expect(screen.getByLabelText("Formula")).toHaveAccessibleDescription(/Bands: blue, green, red, nir, swir1, swir2 \(/);
    expect(lastConfig(post).valid).toBe(false);
    parent.mockRestore();
  });

  it("warns that saving drops what it does not know", () => {
    open('{"layers":[{"type":"planet"},{"type":"landsat"}]}');
    expect(screen.getByRole("alert")).toHaveTextContent("Saving will remove them.");
  });

  it("reloads the preview 800 ms after the last valid change, not while invalid", () => {
    vi.useFakeTimers();
    open();
    const frame = () => new URL(screen.getByTitle("Preview").getAttribute("src")!, "https://x.org").searchParams;
    expect(frame().get("config")).toBeNull();
    expect(JSON.parse(frame().get("geoJson")!)).toEqual({ type: "Point", coordinates: [-62.98, -9.97] });
    fireEvent.click(row(/1\. Sentinel-2 composite/));
    fireEvent.click(screen.getByLabelText("Fixed period"));
    act(() => vi.advanceTimersByTime(2000));
    expect(frame().get("config")).toBeNull();
    fireEvent.click(screen.getByLabelText("Year slider"));
    fireEvent.change(screen.getByLabelText("Colours"), { target: { value: "true-colour" } });
    act(() => vi.advanceTimersByTime(700));
    expect(frame().get("config")).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(frame().get("config")).toContain('"bands":"true-colour"');
  });
});
