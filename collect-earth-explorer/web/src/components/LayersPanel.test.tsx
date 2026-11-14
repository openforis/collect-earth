import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LayersPanel from "./LayersPanel";
import { PlotProvider, usePlot } from "../state/PlotContext";
import type { PlotParams } from "../lib/urlParams";

const params: PlotParams = {
  plot: { type: "Polygon", coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] },
  start: "2000-01-01",
  end: "2025-06-15",
  plotId: "demo",
};

const SCENE = { sensor: "landsat" as const, timeStart: 1700000000000, label: "Landsat 8 2023-11-14" };

/** Shows the committed landsat year and lets the test set a scene through the context. */
function Probe() {
  const p = usePlot();
  return (
    <>
      <span data-testid="year">{p.landsatYear}</span>
      <span data-testid="active-layer">{p.activeLayer}</span>
      <span data-testid="compare-layer">{p.compareLayer}</span>
      <button onClick={() => p.setScene(SCENE)}>set scene</button>
    </>
  );
}

function setup() {
  render(
    <PlotProvider params={params}>
      <LayersPanel />
      <Probe />
    </PlotProvider>,
  );
}

const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const slider = () => screen.getByRole("slider") as HTMLInputElement;
const committedYear = () => Number(screen.getByTestId("year").textContent);
const activeLayer = () => screen.getByTestId("active-layer").textContent;
const compareCheckbox = () => screen.getByRole("checkbox", { name: /Compare with/ }) as HTMLInputElement;
const compareSelect = () => screen.queryByRole("combobox", { name: "Compare layer" }) as HTMLSelectElement | null;
const compareLayer = () => screen.getByTestId("compare-layer").textContent;
const toggleButton = () => screen.getByRole("button", { name: "Layers" });

/**
 * jsdom has no `window.matchMedia`. This controllable fake answers the narrow-screen
 * query with `narrow` and lets a test flip it, as a window resize would.
 */
type Listener = (e: { matches: boolean }) => void;
const media = { narrow: false, query: "", listeners: [] as Listener[] };
function stubMatchMedia(narrow: boolean) {
  media.narrow = narrow;
  media.listeners = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      media.query = query;
      return {
        get matches() {
          return media.narrow;
        },
        media: query,
        addEventListener: (_type: "change", l: Listener) => media.listeners.push(l),
        removeEventListener: (_type: "change", l: Listener) => {
          media.listeners = media.listeners.filter((x) => x !== l);
        },
      };
    }),
  );
}
function resizeTo(narrow: boolean) {
  media.narrow = narrow;
  act(() => media.listeners.forEach((l) => l({ matches: narrow })));
}

describe("LayersPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders three radios with Sentinel-2 checked and the Scene radio disabled", () => {
    setup();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(radio(/Sentinel-2/).checked).toBe(true);
    expect(radio(/Landsat 2024/).checked).toBe(false);
    expect(radio(/Scene/).disabled).toBe(true);
    expect(slider().min).toBe("1984");
    expect(slider().max).toBe("2025");
    expect(slider().value).toBe("2024");
  });

  it("moving the slider updates the label immediately and commits year + layer together after 400 ms", () => {
    setup();
    fireEvent.change(slider(), { target: { value: "2010" } });
    // Only the label follows the drag; the layer and year are committed atomically later.
    expect(radio(/Landsat 2010/).checked).toBe(false);
    expect(radio(/Sentinel-2/).checked).toBe(true);
    expect(committedYear()).toBe(2024);

    act(() => vi.advanceTimersByTime(399));
    expect(committedYear()).toBe(2024);
    expect(radio(/Sentinel-2/).checked).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(committedYear()).toBe(2010);
    expect(radio(/Landsat 2010/).checked).toBe(true);
    expect(radio(/Sentinel-2/).checked).toBe(false);
  });

  it("two quick slider changes commit only once, with the last value", () => {
    setup();
    fireEvent.change(slider(), { target: { value: "2005" } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(slider(), { target: { value: "2010" } });
    expect(radio(/Landsat 2010/)).toBeTruthy();
    expect(radio(/Sentinel-2/).checked).toBe(true);

    // 400 ms after the first change: the 2005 commit must have been cancelled.
    act(() => vi.advanceTimersByTime(300));
    expect(committedYear()).toBe(2024);
    expect(radio(/Sentinel-2/).checked).toBe(true);
    // 400 ms after the second change: 2010 is committed.
    act(() => vi.advanceTimersByTime(100));
    expect(committedYear()).toBe(2010);
    expect(radio(/Landsat 2010/).checked).toBe(true);
  });

  it("clicking the Landsat radio selects the layer with the committed year, without a pending commit", () => {
    setup();
    fireEvent.click(radio(/Landsat 2024/));
    expect(radio(/Landsat 2024/).checked).toBe(true);
    expect(committedYear()).toBe(2024);
    // Nothing is pending: idle time changes neither the year nor the layer.
    act(() => vi.advanceTimersByTime(1000));
    expect(committedYear()).toBe(2024);
    expect(radio(/Landsat 2024/).checked).toBe(true);
  });

  it("does not switch to Landsat on its own when the slider is untouched", () => {
    setup();
    act(() => vi.advanceTimersByTime(1000));
    expect(radio(/Sentinel-2/).checked).toBe(true);
    expect(radio(/Landsat 2024/).checked).toBe(false);
  });

  it("enables the Scene radio and shows the scene label once a scene is set", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "set scene" }));
    const sceneRadio = radio(/Scene: Landsat 8 2023-11-14/);
    expect(sceneRadio.disabled).toBe(false);
    expect(sceneRadio.checked).toBe(true);
  });

  it("shows the compare layer select only while Compare is ticked", () => {
    setup();
    expect(compareCheckbox().checked).toBe(false);
    expect(compareSelect()).toBeNull();
    fireEvent.click(compareCheckbox());
    expect(compareCheckbox().checked).toBe(true);
    expect(compareSelect()!.value).toBe("landsat");
    fireEvent.click(compareCheckbox());
    expect(compareSelect()).toBeNull();
  });

  it("offers Sentinel-2, Landsat with the committed year, and a Scene option disabled until a scene exists", () => {
    setup();
    fireEvent.click(compareCheckbox());
    const options = Array.from(compareSelect()!.options);
    expect(options.map((o) => o.value)).toEqual(["sentinel2", "landsat", "scene"]);
    expect(options[1].textContent).toBe("Landsat 2024");
    expect(options[2].disabled).toBe(true);
    expect(options[2].textContent).toBe("Scene (click a chart point)");

    // A slider drag updates the radio label at once but the compare option only on commit.
    fireEvent.change(slider(), { target: { value: "2010" } });
    expect(radio(/Landsat 2010/)).toBeTruthy();
    expect(Array.from(compareSelect()!.options)[1].textContent).toBe("Landsat 2024");
    act(() => vi.advanceTimersByTime(400));
    expect(Array.from(compareSelect()!.options)[1].textContent).toBe("Landsat 2010");

    fireEvent.click(screen.getByRole("button", { name: "set scene" }));
    const scene = Array.from(compareSelect()!.options)[2];
    expect(scene.disabled).toBe(false);
    expect(scene.textContent).toBe("Scene: Landsat 8 2023-11-14");
  });

  it("selecting a compare layer updates compareLayer in the context", () => {
    setup();
    fireEvent.click(compareCheckbox());
    expect(compareLayer()).toBe("landsat");
    fireEvent.change(compareSelect()!, { target: { value: "sentinel2" } });
    expect(compareLayer()).toBe("sentinel2");
    expect(compareSelect()!.value).toBe("sentinel2");
    // The primary layer is untouched by the compare selection.
    expect(radio(/Sentinel-2/).checked).toBe(true);
  });

  describe("slider commit in compare mode", () => {
    it("commits the year for the right-hand Landsat layer without switching the left layer", () => {
      setup();
      fireEvent.click(compareCheckbox());
      expect(activeLayer()).toBe("sentinel2");
      fireEvent.change(slider(), { target: { value: "2010" } });
      act(() => vi.advanceTimersByTime(400));
      expect(committedYear()).toBe(2010);
      expect(activeLayer()).toBe("sentinel2");
      expect(radio(/Sentinel-2/).checked).toBe(true);
      expect(radio(/Landsat 2010/).checked).toBe(false);
      expect(Array.from(compareSelect()!.options)[1].textContent).toBe("Landsat 2010");
    });

    it("leaves a left-hand Landsat layer selected, now at the committed year", () => {
      setup();
      fireEvent.click(radio(/Landsat 2024/));
      fireEvent.click(compareCheckbox());
      fireEvent.change(slider(), { target: { value: "1999" } });
      act(() => vi.advanceTimersByTime(400));
      expect(committedYear()).toBe(1999);
      expect(activeLayer()).toBe("landsat");
      expect(radio(/Landsat 1999/).checked).toBe(true);
    });

    it("goes back to switching the left layer once Compare is unticked", () => {
      setup();
      fireEvent.click(compareCheckbox());
      fireEvent.click(compareCheckbox());
      fireEvent.change(slider(), { target: { value: "2010" } });
      act(() => vi.advanceTimersByTime(400));
      expect(committedYear()).toBe(2010);
      expect(activeLayer()).toBe("landsat");
    });
  });

  describe("collapsing on narrow screens", () => {
    it("subscribes to the 900 px media query", () => {
      setup();
      expect(media.query).toBe("(max-width: 900px)");
      expect(media.listeners).toHaveLength(1);
    });

    it("starts collapsed on a narrow screen, showing only the Layers button, and the button opens and closes it", () => {
      stubMatchMedia(true);
      setup();
      expect(toggleButton().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByRole("slider")).toBeNull();

      fireEvent.click(toggleButton());
      expect(toggleButton().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("radio")).toHaveLength(3);
      expect(radio(/Sentinel-2/).checked).toBe(true);

      fireEvent.click(toggleButton());
      expect(toggleButton().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("radio")).toBeNull();
    });

    it("keeps the context state while collapsed", () => {
      stubMatchMedia(true);
      setup();
      fireEvent.click(toggleButton());
      fireEvent.change(slider(), { target: { value: "2010" } });
      act(() => vi.advanceTimersByTime(400));
      fireEvent.click(compareCheckbox());
      fireEvent.click(toggleButton());
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(committedYear()).toBe(2010);
      fireEvent.click(toggleButton());
      expect(compareCheckbox().checked).toBe(true);
      expect(radio(/Landsat 2010/).checked).toBe(true);
    });

    it("starts open on a wide screen; the toggle is still in the DOM (hidden by CSS) and reports expanded", () => {
      setup();
      expect(toggleButton().getAttribute("aria-expanded")).toBe("true");
      expect(toggleButton().className).toBe("layers-toggle");
      expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    it("collapses when the window narrows and reappears when it is widened again", () => {
      setup();
      expect(screen.getAllByRole("radio")).toHaveLength(3);

      resizeTo(true);
      expect(toggleButton().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("radio")).toBeNull();

      resizeTo(false);
      expect(toggleButton().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    it("reopens a panel the user closed on a narrow screen once widened, and closes one they opened once narrowed", () => {
      stubMatchMedia(true);
      setup();
      fireEvent.click(toggleButton());
      expect(screen.getAllByRole("radio")).toHaveLength(3);
      resizeTo(false);
      expect(screen.getAllByRole("radio")).toHaveLength(3);
      resizeTo(true);
      expect(screen.queryByRole("radio")).toBeNull();
    });

    it("unsubscribes from the media query on unmount", () => {
      const { unmount } = render(
        <PlotProvider params={params}>
          <LayersPanel />
        </PlotProvider>,
      );
      expect(media.listeners).toHaveLength(1);
      unmount();
      expect(media.listeners).toHaveLength(0);
    });

    it("treats a missing window.matchMedia (e.g. jsdom) as a wide screen", () => {
      vi.stubGlobal("matchMedia", undefined);
      setup();
      expect(toggleButton().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("radio")).toHaveLength(3);
    });
  });
});
