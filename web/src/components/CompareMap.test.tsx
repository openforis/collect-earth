import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { StrictMode } from "react";
import CompareMap from "./CompareMap";
import { IMAGERY_SOURCE } from "./MapView";
import { FakeMap } from "../test/fakeMaplibre";
import type { Polygon } from "../lib/urlParams";

const { FakeCompare } = vi.hoisted(() => {
  /** Records constructor arguments and remove() per instance. */
  class FakeCompare {
    static instances: FakeCompare[] = [];
    args: unknown[];
    remove = vi.fn();
    constructor(...args: unknown[]) {
      this.args = args;
      FakeCompare.instances.push(this);
    }
  }
  return { FakeCompare };
});

vi.mock("maplibre-gl", async () => {
  const { fakeMaplibreModule } = await import("../test/fakeMaplibre");
  return fakeMaplibreModule();
});
vi.mock("@maplibre/maplibre-gl-compare", () => ({ default: FakeCompare }));

const plot: Polygon = { type: "Polygon", coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] };
const URL_A = "https://tiles.example/a/{z}/{x}/{y}";
const URL_B = "https://tiles.example/b/{z}/{x}/{y}";
const URL_C = "https://tiles.example/c/{z}/{x}/{y}";
const imagerySource = (map: FakeMap) => map.addSource.mock.calls.find(([id]) => id === IMAGERY_SOURCE)?.[1];

describe("CompareMap", () => {
  beforeEach(() => {
    FakeMap.instances.length = 0;
    FakeCompare.instances.length = 0;
  });

  it("creates two synced maps with their own imagery, swaps each side independently and tears down on unmount", () => {
    const { rerender, unmount } = render(
      <StrictMode>
        <CompareMap plot={plot} leftTileUrl={URL_A} rightTileUrl={URL_B} />
      </StrictMode>,
    );
    // StrictMode runs the effect twice: the first pair of maps and compare are discarded.
    expect(FakeMap.instances).toHaveLength(4);
    expect(FakeCompare.instances).toHaveLength(2);
    const [deadLeft, deadRight, left, right] = FakeMap.instances;
    const [deadCompare, compare] = FakeCompare.instances;
    expect(deadLeft.removed).toBe(true);
    expect(deadRight.removed).toBe(true);
    expect(deadCompare.remove).toHaveBeenCalledTimes(1);
    expect(left.removed).toBe(false);
    expect(right.removed).toBe(false);
    expect(compare.remove).not.toHaveBeenCalled();

    // Compare wraps the two live maps inside the component's container.
    expect(compare.args[0]).toBe(left);
    expect(compare.args[1]).toBe(right);
    const wrap = compare.args[2] as HTMLElement;
    expect(wrap).toBeInstanceOf(HTMLElement);
    expect(wrap.contains(left.options.container as HTMLElement)).toBe(true);
    expect(wrap.contains(right.options.container as HTMLElement)).toBe(true);
    expect(left.options.container).not.toBe(right.options.container);

    // A late "load" on the discarded maps must not touch them.
    act(() => {
      deadLeft.fire("load");
      deadRight.fire("load");
    });
    expect(deadLeft.callsAfterRemove).toEqual([]);
    expect(deadRight.callsAfterRemove).toEqual([]);

    act(() => {
      left.fire("load");
      right.fire("load");
    });
    for (const m of [left, right]) {
      expect(m.addSource).toHaveBeenCalledWith("plot", expect.objectContaining({ type: "geojson" }));
      expect(m.layers[IMAGERY_SOURCE]).toBe("plot-outline");
    }
    expect(imagerySource(left)).toEqual(expect.objectContaining({ tiles: [URL_A] }));
    expect(imagerySource(right)).toEqual(expect.objectContaining({ tiles: [URL_B] }));

    // Changing the right URL swaps tiles in place on the right map only.
    rerender(
      <StrictMode>
        <CompareMap plot={plot} leftTileUrl={URL_A} rightTileUrl={URL_C} />
      </StrictMode>,
    );
    expect(right.sources[IMAGERY_SOURCE].setTiles).toHaveBeenCalledWith([URL_C]);
    expect(left.sources[IMAGERY_SOURCE].setTiles).not.toHaveBeenCalled();
    expect(right.removeSource).not.toHaveBeenCalled();

    // And the left URL swaps the left map only.
    rerender(
      <StrictMode>
        <CompareMap plot={plot} leftTileUrl={URL_B} rightTileUrl={URL_C} />
      </StrictMode>,
    );
    expect(left.sources[IMAGERY_SOURCE].setTiles).toHaveBeenCalledWith([URL_B]);
    expect(right.sources[IMAGERY_SOURCE].setTiles).toHaveBeenCalledTimes(1);

    unmount();
    expect(compare.remove).toHaveBeenCalledTimes(1);
    expect(left.removed).toBe(true);
    expect(right.removed).toBe(true);
    // The compare control is detached before the maps it references are removed.
    expect(compare.remove.mock.invocationCallOrder[0]).toBeLessThan(left.remove.mock.invocationCallOrder[0]);
    expect(compare.remove.mock.invocationCallOrder[0]).toBeLessThan(right.remove.mock.invocationCallOrder[0]);
  });

  it("applies the tile URLs that are current when each style loads", () => {
    const { rerender } = render(<CompareMap plot={plot} />);
    const [left, right] = FakeMap.instances;
    rerender(<CompareMap plot={plot} leftTileUrl={URL_A} rightTileUrl={URL_B} />);
    expect(left.addSource).not.toHaveBeenCalled();
    expect(right.addSource).not.toHaveBeenCalled();
    act(() => {
      left.fire("load");
      right.fire("load");
    });
    expect(imagerySource(left)).toEqual(expect.objectContaining({ tiles: [URL_A] }));
    expect(imagerySource(right)).toEqual(expect.objectContaining({ tiles: [URL_B] }));
  });
});
