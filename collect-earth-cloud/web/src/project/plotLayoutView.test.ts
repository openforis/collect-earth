import { describe, expect, it } from "vitest";
import { isShown, layoutChanges, layoutErrors, minimumReferenceDistance, numberLabel, shownLayout } from "./plotLayoutView";

const demo = { sample_shape: "SQUARE", number_of_sampling_points_in_plot: "49", distance_between_sample_points: "10", distance_to_plot_boundaries: "5", inner_point_side: "2" };

describe("plot layout card", () => {
  it("shows the stored values as Collect Earth's settings do", () => {
    expect(shownLayout(demo)).toMatchObject({ sample_shape: "SQUARE", number_of_sampling_points_in_plot: "49", buffer_shape: "NONE", large_central_plot_side: "20", distance_to_buffers: "100" });
    expect(shownLayout({ sample_shape: "circle", number_of_sampling_points_in_plot: "7", distance_to_buffers: "50,80", distance_between_sample_points: "5000" }))
      .toMatchObject({ sample_shape: "CIRCLE", number_of_sampling_points_in_plot: "25", buffer_shape: "SQUARE", distance_to_buffers: "50", distance_between_sample_points: "1000" });
  });

  it("shows the fields of the shape, with the distance named a radius for round plots", () => {
    const square = shownLayout(demo);
    expect(isShown("distance_to_plot_boundaries", square)).toBe(true);
    expect(isShown("large_central_plot_side", square)).toBe(false);
    expect(isShown("distance_between_sample_points", { ...square, number_of_sampling_points_in_plot: "1" })).toBe(false);
    const circle = { ...square, sample_shape: "CIRCLE" };
    expect(isShown("distance_to_plot_boundaries", circle)).toBe(false);
    expect(numberLabel("distance_between_sample_points", circle)).toBe("file.layout.radius");
    const polygon = { ...square, sample_shape: "KML_POLYGON" };
    expect(["number_of_sampling_points_in_plot", "buffer_shape", "inner_point_side"].some((k) => isShown(k, polygon))).toBe(false);
  });

  it("checks the ranges and that the reference area holds the plot", () => {
    const v = { ...shownLayout(demo), buffer_shape: "SQUARE", distance_to_buffers: "35" };
    expect(minimumReferenceDistance(v)).toBe(36);
    expect(layoutErrors(v)).toEqual({ distance_to_buffers: { key: "file.layout.referenceMin", min: 36 } });
    expect(layoutErrors({ ...v, distance_to_buffers: "36", distance_between_sample_points: "1" }).distance_between_sample_points).toEqual({ key: "file.layout.range", min: 2, max: 1000 });
    expect(layoutErrors({ ...v, distance_to_buffers: "36" })).toEqual({});
  });

  it("sends what changed, and a blank for a value Collect Earth keeps blank while hidden", () => {
    const initial = shownLayout(demo);
    expect(layoutChanges(demo, initial, initial)).toEqual({});
    expect(layoutChanges(demo, initial, { ...initial, sample_shape: "CIRCLE", distance_between_sample_points: "15" })).toEqual({ sample_shape: "CIRCLE", distance_between_sample_points: "15" });
    // One point: the distance between points is hidden, and blanked
    expect(layoutChanges(demo, initial, { ...initial, number_of_sampling_points_in_plot: "1" })).toEqual({ number_of_sampling_points_in_plot: "1", distance_between_sample_points: "" });
  });
});
