import { describe, expect, it } from "vitest";
import type { PlotLayoutSettings } from "./api";
import { checkLayout, distanceMeaning, isShown, layoutDiffers, wholeIn, type LayoutKey } from "./plotLayoutView";

const SQUARE: PlotLayoutSettings = {
  sample_shape: "SQUARE", number_of_sampling_points_in_plot: "25", distance_between_sample_points: "10", distance_to_plot_boundaries: "5",
  inner_point_side: "2", large_central_plot_side: "20", distance_between_plots: "100", distance_to_buffers: "100", buffer_shape: "SQUARE",
};
const shown = (layout: PlotLayoutSettings) => (Object.keys(layout) as LayoutKey[]).filter((k) => isShown(k, layout));

describe("the plot layout's settings", () => {
  it("shows those of the shape chosen, as the desktop's settings page does", () => {
    expect(shown(SQUARE)).toEqual(["sample_shape", "number_of_sampling_points_in_plot", "distance_between_sample_points", "distance_to_plot_boundaries",
      "inner_point_side", "distance_to_buffers", "buffer_shape"]);
    // one point: no distance between points; none: no side of the points either
    expect(shown({ ...SQUARE, number_of_sampling_points_in_plot: "1" })).not.toContain("distance_between_sample_points");
    expect(shown({ ...SQUARE, number_of_sampling_points_in_plot: "0" })).not.toContain("inner_point_side");
    expect(shown({ ...SQUARE, sample_shape: "SQUARE_WITH_LARGE_CENTRAL_PLOT" })).toContain("large_central_plot_side");
    expect(shown({ ...SQUARE, sample_shape: "CIRCLE", buffer_shape: "NONE" })).toEqual(["sample_shape", "number_of_sampling_points_in_plot",
      "distance_between_sample_points", "inner_point_side", "buffer_shape"]);
    expect(shown({ ...SQUARE, sample_shape: "NFI_FOUR_CIRCLES" })).toEqual(["sample_shape", "distance_between_sample_points", "inner_point_side", "distance_between_plots"]);
    expect(shown({ ...SQUARE, sample_shape: "WKT_POLYGON" })).toEqual(["sample_shape"]);
    expect([distanceMeaning("SQUARE"), distanceMeaning("HEXAGON"), distanceMeaning("NFI_THREE_CIRCLES")]).toEqual(["square", "round", "cluster"]);
  });

  it("checks the numbers shown, and the reference area against the plot", () => {
    // a 50 m square: 0.25 ha; its reference area 200 m across: 4 ha
    expect(checkLayout(SQUARE)).toEqual({ invalid: [], tooClose: null, small: null, plotHa: 0.25, referenceHa: 4 });
    expect(checkLayout({ ...SQUARE, distance_between_sample_points: "1", inner_point_side: "x", large_central_plot_side: "0" }).invalid)
      .toEqual(["distance_between_sample_points", "inner_point_side"]);
    // inside the plot: cannot be saved
    expect(checkLayout({ ...SQUARE, distance_to_buffers: "20" })).toMatchObject({ tooClose: 26, small: null });
    // enclosing it, but less than ten times its area: the distance that is
    expect(checkLayout({ ...SQUARE, distance_to_buffers: "40" })).toMatchObject({ tooClose: null, small: 80 });
    expect(checkLayout({ ...SQUARE, buffer_shape: "NONE", distance_to_buffers: "1" })).toMatchObject({ tooClose: null, small: null, referenceHa: null });
    expect(checkLayout({ ...SQUARE, sample_shape: "KML_POLYGON" }).plotHa).toBeNull();
    expect([wholeIn(" 12 ", 2, 100), wholeIn("1", 2, 100), wholeIn("2.5", 2, 100)]).toEqual([12, null, null]);
  });

  it("tells a change of a setting shown from one of a setting hidden", () => {
    expect(layoutDiffers({ ...SQUARE, distance_to_plot_boundaries: "6" }, SQUARE)).toBe(true);
    expect(layoutDiffers({ ...SQUARE, large_central_plot_side: "30" }, SQUARE)).toBe(false);
    expect(layoutDiffers({ ...SQUARE, sample_shape: "CIRCLE" }, SQUARE)).toBe(true);
  });
});
