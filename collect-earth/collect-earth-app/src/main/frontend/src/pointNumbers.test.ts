import { describe, expect, it } from "vitest";
import { pointNumbersOf } from "./plots";
import type { LatLng, PlotFeature } from "./types";

/** A plot of an outline and n × n sample squares 10 m apart, laid out (and closed) as PlotGeoJsonBuilder writes them */
function plot(n: number, samplePoints: string | undefined) {
  const square = (lat: number, lng: number): LatLng[] => [[lat, lng], [lat, lng + 1e-5], [lat - 1e-5, lng + 1e-5], [lat - 1e-5, lng], [lat, lng]];
  const outline = square(1, 1);
  // Collect Earth's order: from the north-west corner, down each column, the columns from west to east
  const samples: LatLng[][] = [];
  for (let col = 0; col < n; col++) for (let row = 0; row < n; row++) samples.push(square(-row * 1e-4, col * 1e-4));
  const feature = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: { id: "7", latitude: "0", longitude: "0", ...(samplePoints !== undefined ? { samplePoints } : {}) } } as PlotFeature;
  return { feature, rings: [outline, ...samples] };
}

describe("the numbers of the sample points", () => {
  it("numbers the last rings in Collect Earth's order, each at its centre", () => {
    const numbers = pointNumbersOf(plot(3, "9"));
    expect(numbers.map((p) => p.text)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    // 1 north-west, 3 at the bottom of the first column, 4 at the top of the second
    expect(numbers[0].at[0]).toBeCloseTo(-0.5e-5, 9);
    expect(numbers[0].at[1]).toBeCloseTo(0.5e-5, 9);
    expect(numbers[2].at[0]).toBeCloseTo(-2e-4 - 0.5e-5, 9);
    expect(numbers[3].at[1]).toBeCloseTo(1e-4 + 0.5e-5, 9);
  });

  it("numbers nothing for a single point, or a plot that does not say how many points it has", () => {
    expect(pointNumbersOf(plot(1, "1"))).toEqual([]);
    expect(pointNumbersOf(plot(3, undefined))).toEqual([]);
    expect(pointNumbersOf(plot(3, "12"))).toEqual([]);
  });
});
