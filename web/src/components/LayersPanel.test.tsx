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

describe("LayersPanel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
});
