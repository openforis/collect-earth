import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { LAST_12_MONTHS, PlotProvider, usePlot } from "./PlotContext";
import type { PlotParams } from "../lib/urlParams";
import { resolveConfig } from "../lib/config";

const params: PlotParams = {
  plot: { type: "Polygon", coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] },
  start: "2000-01-01",
  end: "2025-06-15",
  plotId: "demo",
};

const standard = resolveConfig(undefined, 2026);
const wrapper = ({ children }: { children: ReactNode }) => (
  <PlotProvider params={params} config={standard}>{children}</PlotProvider>
);
const withLayers = (layers: object[]) => {
  const config = resolveConfig(JSON.stringify({ v: 1, layers }), 2026);
  return ({ children }: { children: ReactNode }) => (
    <PlotProvider params={params} config={config}>{children}</PlotProvider>
  );
};

describe("PlotProvider / usePlot", () => {
  it("exposes the plot params and sensible defaults", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    expect(result.current.plot).toEqual(params.plot);
    expect(result.current.start).toBe("2000-01-01");
    expect(result.current.end).toBe("2025-06-15");
    expect(result.current.plotId).toBe("demo");
    // Layers are entry positions: 0 = Sentinel-2, 1 = Landsat, 2 = Sentinel-1 in the standard configuration.
    expect(result.current.layers.map((l) => l.type)).toEqual(["sentinel2", "landsat", "sentinel1"]);
    expect(result.current.charts).toHaveLength(6);
    expect(result.current.notices).toEqual([]);
    expect(result.current.activeLayer).toBe(0);
    expect(result.current.yearOf(1)).toBe(2024);
    expect(result.current.yearOf(2)).toBe(2024);
    expect(result.current.scene).toBeUndefined();
    expect(result.current.compare).toBe(false);
    expect(result.current.compareLayer).toBe(1);
  });

  it("setScene stores the scene and switches the active layer to it", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    const scene = { sensor: "landsat" as const, timeStart: 1700000000000, label: "Landsat 8 2023-11-14" };
    act(() => result.current.setScene(scene));
    expect(result.current.scene).toEqual(scene);
    expect(result.current.activeLayer).toBe("scene");
  });

  it("difference starts off, stays on through compareAround, and turning Compare off clears it", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    expect(result.current.difference).toBe(false);
    act(() => result.current.setCompare(true));
    act(() => result.current.setDifference(true));
    expect(result.current.difference).toBe(true);
    act(() => result.current.compareAround("landsat", 2015));
    expect(result.current.difference).toBe(true);
    act(() => result.current.setCompare(false));
    expect(result.current.difference).toBe(false);
    expect(result.current.compare).toBe(false);
  });

  it("setActiveLayer and setYear update state", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    act(() => result.current.setActiveLayer(1));
    act(() => result.current.setYear(1, 1999));
    expect(result.current.activeLayer).toBe(1);
    expect(result.current.yearOf(1)).toBe(1999);
  });

  it("selectYear sets the year and the active layer in a single render", () => {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders++;
        return usePlot();
      },
      { wrapper },
    );
    const before = renders;
    act(() => result.current.selectYear(1, 2010));
    expect(result.current.yearOf(1)).toBe(2010);
    expect(result.current.activeLayer).toBe(1);
    expect(renders).toBe(before + 1);
  });

  it("keeps a stable context value across re-renders when nothing changed", () => {
    const { result, rerender } = renderHook(() => usePlot(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.setScene).toBe(first.setScene);
  });

  it("keeps a separate year for each Landsat entry", () => {
    const { result } = renderHook(() => usePlot(), { wrapper: withLayers([{ type: "landsat" }, { type: "landsat", year: 2000 }]) });
    expect(result.current.yearOf(0)).toBe(2024);
    expect(result.current.yearOf(1)).toBe(2000);
    act(() => result.current.selectYear(1, 2005));
    expect(result.current.yearOf(0)).toBe(2024);
    expect(result.current.yearOf(1)).toBe(2005);
    expect(result.current.activeLayer).toBe(1);
  });

  it("starts a Landsat entry at its year, else the last of its years, clamped into its years", () => {
    const { result } = renderHook(() => usePlot(), {
      wrapper: withLayers([
        { type: "landsat", years: [2000, 2010] },
        { type: "landsat", years: [2000, 2010], year: 2015 },
        { type: "landsat", years: [2000, 2010], year: 2003 },
        { type: "landsat", years: [2025, 2026] },
      ]),
    });
    expect([0, 1, 2, 3].map(result.current.yearOf)).toEqual([2010, 2010, 2003, 2026]);
  });

  it("starts a Sentinel-2 entry at the last 12 months, else its year clamped into its years; a fixed window has no year", () => {
    const { result } = renderHook(() => usePlot(), {
      wrapper: withLayers([
        { type: "sentinel2" },
        { type: "sentinel2", years: [2018, 2020] },
        { type: "sentinel2", year: 2019 },
        { type: "sentinel2", years: [2018, 2020], year: 2023 },
        { type: "sentinel2", start: "2022-01-01", end: "2022-07-01" },
      ]),
    });
    expect([0, 1, 2, 3, 4].map(result.current.yearOf)).toEqual([LAST_12_MONTHS, LAST_12_MONTHS, 2019, 2020, undefined]);
    act(() => result.current.setYear(0, 2017));
    expect(result.current.yearOf(0)).toBe(2017);
    act(() => result.current.setYear(0, LAST_12_MONTHS));
    expect(result.current.yearOf(0)).toBe(LAST_12_MONTHS);
  });

  it("keeps the bands of each entry, starting at its bands parameter, without changing the active layer", () => {
    const { result } = renderHook(() => usePlot(), {
      wrapper: withLayers([{ type: "sentinel2", bands: "true-colour" }, { type: "sentinel2" }, { type: "landsat" }]),
    });
    expect([0, 1, 2].map(result.current.bandsOf)).toEqual(["true-colour", "false-colour", "false-colour"]);
    act(() => result.current.setBands(2, "true-colour"));
    expect([0, 1, 2].map(result.current.bandsOf)).toEqual(["true-colour", "false-colour", "true-colour"]);
    expect(result.current.activeLayer).toBe(0);
  });

  it("compares with the first entry when there is only one", () => {
    const { result } = renderHook(() => usePlot(), { wrapper: withLayers([{ type: "landsat" }]) });
    expect(result.current.activeLayer).toBe(0);
    expect(result.current.compareLayer).toBe(0);
  });

  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => usePlot())).toThrow(/outside PlotProvider/);
  });
});
