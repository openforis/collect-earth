import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlotProvider, usePlot } from "./PlotContext";
import type { PlotParams } from "../lib/urlParams";

const params: PlotParams = {
  plot: { type: "Polygon", coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] },
  start: "2000-01-01",
  end: "2025-06-15",
  plotId: "demo",
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <PlotProvider params={params}>{children}</PlotProvider>
);

describe("PlotProvider / usePlot", () => {
  it("exposes the plot params and sensible defaults", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    expect(result.current.plot).toEqual(params.plot);
    expect(result.current.start).toBe("2000-01-01");
    expect(result.current.end).toBe("2025-06-15");
    expect(result.current.plotId).toBe("demo");
    expect(result.current.activeLayer).toBe("sentinel2");
    expect(result.current.landsatYear).toBe(2024);
    expect(result.current.scene).toBeUndefined();
    expect(result.current.compare).toBe(false);
    expect(result.current.compareLayer).toBe("landsat");
  });

  it("setScene stores the scene and switches the active layer to it", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    const scene = { sensor: "landsat" as const, timeStart: 1700000000000, label: "Landsat 8 2023-11-14" };
    act(() => result.current.setScene(scene));
    expect(result.current.scene).toEqual(scene);
    expect(result.current.activeLayer).toBe("scene");
  });

  it("setActiveLayer and setLandsatYear update state", () => {
    const { result } = renderHook(() => usePlot(), { wrapper });
    act(() => result.current.setActiveLayer("landsat"));
    act(() => result.current.setLandsatYear(1999));
    expect(result.current.activeLayer).toBe("landsat");
    expect(result.current.landsatYear).toBe(1999);
  });

  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => usePlot())).toThrow(/outside PlotProvider/);
  });
});
