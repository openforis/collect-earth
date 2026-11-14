import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { StrictMode } from "react";
import MapView, { IMAGERY_SOURCE } from "./MapView";
import { FakeMap } from "../test/fakeMaplibre";
import type { Polygon } from "../lib/urlParams";

vi.mock("maplibre-gl", async () => {
  const { fakeMaplibreModule } = await import("../test/fakeMaplibre");
  return fakeMaplibreModule();
});

const plot: Polygon = { type: "Polygon", coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] };
const URL_A = "https://tiles.example/a/{z}/{x}/{y}";
const URL_B = "https://tiles.example/b/{z}/{x}/{y}";
/** How many times the imagery source (not the plot outline source) was added. */
const imageryAdds = (map: FakeMap) =>
  map.addSource.mock.calls.filter(([id]) => id === IMAGERY_SOURCE).length;

describe("MapView", () => {
  beforeEach(() => {
    FakeMap.instances.length = 0;
  });

  it("swaps the tile URL in place while tiles are loading and never touches the StrictMode-discarded map", () => {
    const { rerender } = render(
      <StrictMode>
        <MapView plot={plot} tileUrl={URL_A} />
      </StrictMode>,
    );
    // StrictMode mounts, unmounts and remounts the effect: two maps, the first removed.
    expect(FakeMap.instances).toHaveLength(2);
    const [dead, live] = FakeMap.instances;
    expect(dead.removed).toBe(true);
    expect(live.removed).toBe(false);

    // A late "load" on the removed map must be ignored (I1).
    act(() => dead.fire("load"));
    expect(dead.callsAfterRemove).toEqual([]);
    expect(dead.addSource).not.toHaveBeenCalled();

    act(() => live.fire("load"));
    expect(live.addSource).toHaveBeenCalledWith(
      IMAGERY_SOURCE,
      expect.objectContaining({ type: "raster", tiles: [URL_A], attribution: expect.stringContaining("Google Earth Engine") }),
    );
    expect(live.layers[IMAGERY_SOURCE]).toBe("plot-outline");

    // isStyleLoaded() is false (tiles still fetching): the swap must still happen (C1),
    // and in place rather than remove + add (I2).
    rerender(
      <StrictMode>
        <MapView plot={plot} tileUrl={URL_B} />
      </StrictMode>,
    );
    expect(live.sources[IMAGERY_SOURCE].setTiles).toHaveBeenCalledWith([URL_B]);
    expect(live.removeSource).not.toHaveBeenCalled();
    expect(live.removeLayer).not.toHaveBeenCalled();
    expect(imageryAdds(live)).toBe(1);

    // Clearing the URL removes the layer and source.
    rerender(
      <StrictMode>
        <MapView plot={plot} tileUrl={undefined} />
      </StrictMode>,
    );
    expect(live.removeLayer).toHaveBeenCalledWith(IMAGERY_SOURCE);
    expect(live.removeSource).toHaveBeenCalledWith(IMAGERY_SOURCE);

    // Setting it again re-adds the source under the outline.
    rerender(
      <StrictMode>
        <MapView plot={plot} tileUrl={URL_A} />
      </StrictMode>,
    );
    expect(imageryAdds(live)).toBe(2);
    expect(live.layers[IMAGERY_SOURCE]).toBe("plot-outline");

    // Nothing ever reached the discarded map after its remove().
    expect(dead.callsAfterRemove).toEqual([]);
  });

  it("applies the tile URL that is current when the style loads", () => {
    const { rerender } = render(<MapView plot={plot} tileUrl={undefined} />);
    const [map] = FakeMap.instances;
    rerender(<MapView plot={plot} tileUrl={URL_B} />);
    expect(map.addSource).not.toHaveBeenCalled();
    act(() => map.fire("load"));
    expect(map.addSource).toHaveBeenCalledWith(IMAGERY_SOURCE, expect.objectContaining({ tiles: [URL_B] }));
  });
});
