import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LayersPanel from "./LayersPanel";
import { LAST_12_MONTHS, PlotProvider, usePlot } from "../state/PlotContext";
import type { PlotParams } from "../lib/urlParams";
import { resolveConfig } from "../lib/config";

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
      {/* The standard configuration's Landsat entry is at position 1. */}
      <span data-testid="year">{p.yearOf(1)}</span>
      <span data-testid="s2-year">{p.yearOf(0)}</span>
      <span data-testid="active-layer">{p.activeLayer}</span>
      <span data-testid="compare-layer">{p.compareLayer}</span>
      <button onClick={() => p.setScene(SCENE)}>set scene</button>
    </>
  );
}

function setup(configText?: string) {
  render(
    <PlotProvider params={params} config={resolveConfig(configText, 2026)}>
      <LayersPanel />
      <Probe />
    </PlotProvider>,
  );
}

const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
// The standard configuration has three sliders: Sentinel-2's, Landsat's and Sentinel-1's.
const slider = () => screen.getByRole("slider", { name: "Landsat year" }) as HTMLInputElement;
const s2Slider = () => screen.getByRole("slider", { name: "Sentinel-2 year" }) as HTMLInputElement;
const s2Year = () => screen.getByTestId("s2-year").textContent;
const bands = (name: string) => screen.getByRole("combobox", { name: `${name} bands` }) as HTMLSelectElement;
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

  it("renders four radios with Sentinel-2 checked and the Scene radio disabled", () => {
    setup();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
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
    expect(compareSelect()!.value).toBe("1");
    fireEvent.click(compareCheckbox());
    expect(compareSelect()).toBeNull();
  });

  it("offers Sentinel-2, Landsat with the committed year, and a Scene option disabled until a scene exists", () => {
    setup();
    fireEvent.click(compareCheckbox());
    const options = Array.from(compareSelect()!.options);
    expect(options.map((o) => o.value)).toEqual(["0", "1", "2", "scene"]);
    expect(options[1].textContent).toBe("Landsat 2024");
    expect(options[2].textContent).toBe("Sentinel-1 2024");
    expect(options[3].disabled).toBe(true);
    expect(options[3].textContent).toBe("Scene (click a chart point)");

    // A slider drag updates the radio label at once but the compare option only on commit.
    fireEvent.change(slider(), { target: { value: "2010" } });
    expect(radio(/Landsat 2010/)).toBeTruthy();
    expect(Array.from(compareSelect()!.options)[1].textContent).toBe("Landsat 2024");
    act(() => vi.advanceTimersByTime(400));
    expect(Array.from(compareSelect()!.options)[1].textContent).toBe("Landsat 2010");

    fireEvent.click(screen.getByRole("button", { name: "set scene" }));
    const scene = Array.from(compareSelect()!.options)[3];
    expect(scene.disabled).toBe(false);
    expect(scene.textContent).toBe("Scene: Landsat 8 2023-11-14");
  });

  it("selecting a compare layer updates compareLayer in the context", () => {
    setup();
    fireEvent.click(compareCheckbox());
    expect(compareLayer()).toBe("1");
    fireEvent.change(compareSelect()!, { target: { value: "0" } });
    expect(compareLayer()).toBe("0");
    expect(compareSelect()!.value).toBe("0");
    // The primary layer is untouched by the compare selection.
    expect(radio(/Sentinel-2/).checked).toBe(true);
  });

  it("offers Difference under the compare select, disabled for radar, the same image and two sensors, with a loss-to-gain legend when ticked", () => {
    setup();
    const difference = () => screen.queryByRole("checkbox", { name: /Difference \(NDVI change\)/ }) as HTMLInputElement | null;
    expect(difference()).toBeNull();
    fireEvent.click(compareCheckbox());
    // Sentinel-2 on the left, Landsat on the right: their NDVI differ systematically.
    expect(difference()!.disabled).toBe(true);
    expect(difference()!.closest("label")!.title).toBe("Only between two images of the same sensor");

    // A Landsat scene on the left, the Landsat layer on the right.
    fireEvent.click(screen.getByRole("button", { name: "set scene" }));
    expect(activeLayer()).toBe("scene");
    expect(compareLayer()).toBe("1");
    expect(difference()!.disabled).toBe(false);
    expect(screen.queryByText("loss")).toBeNull();

    fireEvent.click(difference()!);
    expect(difference()!.checked).toBe(true);
    expect(screen.getByText("loss")).toBeTruthy();
    expect(screen.getByText("gain")).toBeTruthy();

    // Sentinel-1 on the right: radar has no NDVI.
    fireEvent.change(compareSelect()!, { target: { value: "2" } });
    expect(difference()!.disabled).toBe(true);
    expect(difference()!.checked).toBe(false);
    expect(difference()!.closest("label")!.title).toBe("Not available for radar");
    expect(screen.queryByText("loss")).toBeNull();

    // The same scene on both sides.
    fireEvent.change(compareSelect()!, { target: { value: "scene" } });
    expect(difference()!.disabled).toBe(true);
    expect(difference()!.closest("label")!.title).toBe("Both sides show the same image");

    // A Landsat scene against Sentinel-2.
    fireEvent.change(compareSelect()!, { target: { value: "0" } });
    expect(difference()!.disabled).toBe(true);
    expect(difference()!.closest("label")!.title).toBe("Only between two images of the same sensor");

    // Sentinel-1 on the left.
    fireEvent.change(compareSelect()!, { target: { value: "1" } });
    expect(difference()!.disabled).toBe(false);
    fireEvent.click(radio(/Sentinel-1/));
    expect(difference()!.disabled).toBe(true);
    expect(difference()!.closest("label")!.title).toBe("Not available for radar");
  });

  describe("slider commit in compare mode", () => {
    it("commits the year for the right-hand Landsat layer without switching the left layer", () => {
      setup();
      fireEvent.click(compareCheckbox());
      expect(activeLayer()).toBe("0");
      fireEvent.change(slider(), { target: { value: "2010" } });
      act(() => vi.advanceTimersByTime(400));
      expect(committedYear()).toBe(2010);
      expect(activeLayer()).toBe("0");
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
      expect(activeLayer()).toBe("1");
      expect(radio(/Landsat 1999/).checked).toBe(true);
    });

    it("goes back to switching the left layer once Compare is unticked", () => {
      setup();
      fireEvent.click(compareCheckbox());
      fireEvent.click(compareCheckbox());
      fireEvent.change(slider(), { target: { value: "2010" } });
      act(() => vi.advanceTimersByTime(400));
      expect(committedYear()).toBe(2010);
      expect(activeLayer()).toBe("1");
    });
  });

  describe("built from the configuration", () => {
    const doc = (layers: object[]) => JSON.stringify({ v: 1, layers });
    const radioNames = () => screen.getAllByRole("radio").map((r) => r.parentElement!.textContent);

    it("lists the entries in the document's order, then the scene", () => {
      setup(doc([{ type: "landsat" }, { type: "sentinel2" }]));
      expect(radioNames()).toEqual(["Landsat 2024", "Sentinel-2, last 12 months", "Scene (click a chart point)"]);
      expect(radio(/Landsat 2024/).checked).toBe(true);
      fireEvent.click(compareCheckbox());
      expect(Array.from(compareSelect()!.options).map((o) => o.textContent)).toEqual([
        "Landsat 2024",
        "Sentinel-2, last 12 months",
        "Scene (click a chart point)",
      ]);
      expect(compareSelect()!.value).toBe("1");
    });

    it("uses an entry's label, keeping the year after a Landsat label", () => {
      setup(doc([{ type: "sentinel2", label: "Recent imagery" }, { type: "landsat", label: "Landsat yearly" }]));
      expect(radioNames()).toEqual(["Recent imagery", "Landsat yearly 2024", "Scene (click a chart point)"]);
      expect(screen.getByRole("slider", { name: "Landsat yearly year" })).toBeTruthy();
    });

    it("labels an unlabelled Sentinel-2 entry with its dates when it has them", () => {
      setup(doc([{ type: "sentinel2", start: "2022-01-01", end: "2022-07-01" }, { type: "sentinel2" }]));
      expect(radioNames()).toEqual(["Sentinel-2 2022-01-01 to 2022-07-01", "Sentinel-2, last 12 months", "Scene (click a chart point)"]);
    });

    it("gives each Landsat entry its own slider and year", () => {
      setup(doc([{ type: "landsat", label: "A" }, { type: "landsat", label: "B", year: 2000 }]));
      const [a, b] = screen.getAllByRole("slider") as HTMLInputElement[];
      expect([a.value, b.value]).toEqual(["2024", "2000"]);
      fireEvent.change(b, { target: { value: "2005" } });
      expect(radioNames()).toEqual(["A 2024", "B 2005", "Scene (click a chart point)"]);
      act(() => vi.advanceTimersByTime(400));
      expect(committedYear()).toBe(2005);
      expect(radio(/B 2005/).checked).toBe(true);
      expect(radio(/A 2024/).checked).toBe(false);
      expect(a.value).toBe("2024");
    });

    it("limits a slider to the entry's years", () => {
      setup(doc([{ type: "landsat", years: [2000, 2010] }]));
      expect(slider().min).toBe("2000");
      expect(slider().max).toBe("2010");
      expect(slider().value).toBe("2010");
    });

    it("shows no slider for an entry of a single year", () => {
      setup(doc([{ type: "landsat", years: [2015, 2015] }]));
      expect(radio(/Landsat 2015/)).toBeTruthy();
      expect(screen.queryByRole("slider")).toBeNull();
    });
  });

  describe("Sentinel-2 year slider", () => {
    it("offers the years from 2016 to the plot's end year and a last stop for the last 12 months, where it starts", () => {
      setup();
      expect(s2Slider().min).toBe("2016");
      expect(s2Slider().max).toBe("2026");
      expect(s2Slider().value).toBe("2026");
      expect(s2Slider().getAttribute("aria-valuetext")).toBe("Last 12 months");
      expect(radio(/Sentinel-2/).parentElement!.textContent).toBe("Sentinel-2, last 12 months");
      expect(s2Year()).toBe(LAST_12_MONTHS);
    });

    it("labels a year at once, commits it after 400 ms making the row active, and returns to the last 12 months", () => {
      setup();
      fireEvent.click(radio(/Landsat 2024/));
      fireEvent.change(s2Slider(), { target: { value: "2020" } });
      expect(radio(/Sentinel-2 2020/).checked).toBe(false);
      act(() => vi.advanceTimersByTime(399));
      expect(s2Year()).toBe(LAST_12_MONTHS);
      act(() => vi.advanceTimersByTime(1));
      expect(s2Year()).toBe("2020");
      expect(activeLayer()).toBe("0");
      fireEvent.change(s2Slider(), { target: { value: "2026" } });
      expect(radio(/Sentinel-2, last 12 months/)).toBeTruthy();
      act(() => vi.advanceTimersByTime(400));
      expect(s2Year()).toBe(LAST_12_MONTHS);
    });

    it("while comparing sets the year without making the row active", () => {
      setup();
      fireEvent.click(radio(/Landsat 2024/));
      fireEvent.click(compareCheckbox());
      fireEvent.change(s2Slider(), { target: { value: "2019" } });
      act(() => vi.advanceTimersByTime(400));
      expect(s2Year()).toBe("2019");
      expect(activeLayer()).toBe("1");
      expect(Array.from(compareSelect()!.options)[0].textContent).toBe("Sentinel-2 2019");
    });

    it("puts the year after a label, starts at the entry's year, limits the stops to its years, and has no slider for a fixed window", () => {
      setup(JSON.stringify({ v: 1, layers: [
        { type: "sentinel2", label: "A", year: 2019 },
        { type: "sentinel2", label: "B", years: [2018, 2020] },
        { type: "sentinel2", start: "2022-01-01", end: "2022-07-01" },
      ] }));
      const [a, b] = screen.getAllByRole("slider") as HTMLInputElement[];
      expect(screen.getAllByRole("slider")).toHaveLength(2);
      expect([a.value, b.min, b.max, b.value]).toEqual(["2019", "2018", "2021", "2021"]);
      expect(radio(/^A 2019$/)).toBeTruthy();
      expect(radio(/^B$/)).toBeTruthy();
      fireEvent.change(b, { target: { value: "2018" } });
      expect(radio(/^B 2018$/)).toBeTruthy();
      act(() => vi.advanceTimersByTime(400));
      expect(radio(/^B 2018$/).checked).toBe(true);
      expect(radio(/^A 2019$/).checked).toBe(false);
      expect(a.value).toBe("2019");
    });
  });

  describe("band selector", () => {
    it("offers the catalogue's band choices on every imagery row, starting at the entry's bands", () => {
      setup(JSON.stringify({ v: 1, layers: [{ type: "sentinel2", bands: "true-colour" }, { type: "landsat" }] }));
      expect(Array.from(bands("Sentinel-2").options).map((o) => [o.value, o.textContent])).toEqual([
        ["false-colour", "False colour"],
        ["true-colour", "True colour"],
      ]);
      expect(bands("Sentinel-2").value).toBe("true-colour");
      expect(bands("Landsat").value).toBe("false-colour");
    });

    it("a Sentinel-1 row is named Sentinel-1 <year>, offers its radar bands as VV and VH, and its slider starts in 2015", () => {
      setup(JSON.stringify({ v: 1, layers: [{ type: "sentinel1", bands: "vh" }] }));
      expect(radio(/^Sentinel-1 2024$/)).toBeTruthy();
      expect(Array.from(bands("Sentinel-1").options).map((o) => [o.value, o.textContent])).toEqual([
        ["false-colour", "False colour"],
        ["vv", "VV"],
        ["vh", "VH"],
      ]);
      expect(bands("Sentinel-1").value).toBe("vh");
      const s1Slider = screen.getByRole("slider", { name: "Sentinel-1 year" }) as HTMLInputElement;
      expect([s1Slider.min, s1Slider.max]).toEqual(["2015", "2025"]);
    });

    it("changing it keeps the active layer and leaves the other rows' bands alone", () => {
      setup(JSON.stringify({ v: 1, layers: [{ type: "landsat", label: "A" }, { type: "landsat", label: "B" }] }));
      fireEvent.change(bands("B"), { target: { value: "true-colour" } });
      expect(bands("B").value).toBe("true-colour");
      expect(bands("A").value).toBe("false-colour");
      expect(activeLayer()).toBe("0");
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
      expect(screen.getAllByRole("radio")).toHaveLength(4);
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
      expect(screen.getAllByRole("radio")).toHaveLength(4);
    });

    it("collapses when the window narrows and reappears when it is widened again", () => {
      setup();
      expect(screen.getAllByRole("radio")).toHaveLength(4);

      resizeTo(true);
      expect(toggleButton().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("radio")).toBeNull();

      resizeTo(false);
      expect(toggleButton().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("radio")).toHaveLength(4);
    });

    it("reopens a panel the user closed on a narrow screen once widened, and closes one they opened once narrowed", () => {
      stubMatchMedia(true);
      setup();
      fireEvent.click(toggleButton());
      expect(screen.getAllByRole("radio")).toHaveLength(4);
      resizeTo(false);
      expect(screen.getAllByRole("radio")).toHaveLength(4);
      resizeTo(true);
      expect(screen.queryByRole("radio")).toBeNull();
    });

    it("unsubscribes from the media query on unmount", () => {
      const { unmount } = render(
        <PlotProvider params={params} config={resolveConfig(undefined, 2026)}>
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
      expect(screen.getAllByRole("radio")).toHaveLength(4);
    });
  });
});
