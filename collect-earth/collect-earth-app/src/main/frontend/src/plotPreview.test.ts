import { describe, expect, it } from "vitest";
import { CIRCLE_PLOT_MARGIN, gridPoints, hexagonPoints, plotDrawing, scaleBarLength } from "./plotPreview";

describe("plot drawing", () => {
  it("draws a square plot as its grid of points inside the margin", () => {
    const d = plotDrawing({ sample_shape: "SQUARE", number_of_sampling_points_in_plot: "4", distance_between_sample_points: "10",
      distance_to_plot_boundaries: "5", inner_point_side: "2", buffer_shape: "SQUARE", distance_to_buffers: "50" })!;
    expect(d.outline).toEqual({ kind: "square", half: 10 });
    expect(d.points).toEqual([{ x: -5, y: -5, side: 2 }, { x: 5, y: -5, side: 2 }, { x: -5, y: 5, side: 2 }, { x: 5, y: 5, side: 2 }]);
    expect(d.randomPoints).toBe(0);
    expect(d.centralPlot).toBeNull();
    expect(d.reference).toEqual({ kind: "square", half: 50 });
    expect(d.extent).toBeCloseTo(55);
  });

  it("sizes a square of one point or none by its margin, and draws the large central plot", () => {
    const one = plotDrawing({ sample_shape: "SQUARE", number_of_sampling_points_in_plot: "1", distance_to_plot_boundaries: "12", buffer_shape: "NONE" })!;
    expect(one.outline).toEqual({ kind: "square", half: 12 });
    expect(one.points).toEqual([{ x: 0, y: 0, side: 2 }]);
    expect(one.reference).toBeNull();
    const none = plotDrawing({ sample_shape: "SQUARE", number_of_sampling_points_in_plot: "0", distance_to_plot_boundaries: "12" })!;
    expect(none.points).toEqual([]);
    const central = plotDrawing({ sample_shape: "SQUARE_WITH_LARGE_CENTRAL_PLOT", number_of_sampling_points_in_plot: "25",
      distance_between_sample_points: "10", large_central_plot_side: "20" })!;
    expect(central.outline).toEqual({ kind: "square", half: 20 });
    expect(central.centralPlot).toEqual({ half: 10 });
    expect(central.points).toHaveLength(25);
  });

  it("draws a round plot with the generator's margin and only its central point", () => {
    const d = plotDrawing({ sample_shape: "CIRCLE", number_of_sampling_points_in_plot: "9", distance_between_sample_points: "15",
      inner_point_side: "3", buffer_shape: "HEXAGON", distance_to_buffers: "40" })!;
    expect(d.outline).toEqual({ kind: "circle", r: 15 + CIRCLE_PLOT_MARGIN });
    expect(d.points).toEqual([{ x: 0, y: 0, side: 3 }]);
    expect(d.randomPoints).toBe(8);
    expect(d.reference).toEqual({ kind: "hexagon", r: 40 });
    expect(plotDrawing({ sample_shape: "HEXAGON", number_of_sampling_points_in_plot: "0", distance_between_sample_points: "15" })!.points).toEqual([]);
    expect(plotDrawing({ sample_shape: "hexagon " })!.outline.kind).toBe("hexagon");
  });

  it("draws an NFI cluster as its circular plots east and north, and north-east for four", () => {
    const three = plotDrawing({ sample_shape: "NFI_THREE_CIRCLES", distance_between_sample_points: "15", distance_between_plots: "100", inner_point_side: "2" })!;
    expect(three.outline).toEqual({ kind: "circle", r: 15 });
    expect(three.clusterPlots).toEqual([{ x: 130, y: 0, r: 15 }, { x: 0, y: 130, r: 15 }]);
    expect(three.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [130, 0], [0, 130]]);
    expect(three.reference).toBeNull();
    expect(three.extent).toBeCloseTo(145 * 1.1);
    const four = plotDrawing({ sample_shape: "NFI_FOUR_CIRCLES", distance_between_sample_points: "15", distance_between_plots: "100" })!;
    expect(four.clusterPlots).toHaveLength(3);
    expect(four.clusterPlots[2]).toEqual({ x: 130, y: 130, r: 15 });
  });

  it("draws nothing for a shape read from the file", () => {
    expect(plotDrawing({ sample_shape: "KML_POLYGON" })).toBeNull();
    expect(plotDrawing({ sample_shape: "NFMA" })).toBeNull();
    expect(plotDrawing({ sample_shape: "SQUARE_CIRCLE" })).toBeNull();
  });

  it("reads blank or wrong values as the dialog did", () => {
    const d = plotDrawing({})!;
    expect(d.outline).toEqual({ kind: "square", half: 0 });
    expect(d.points).toEqual([]);
    expect(plotDrawing({ number_of_sampling_points_in_plot: "x", distance_between_sample_points: "5000" })!.points).toEqual([]);
  });
});

describe("helpers", () => {
  it("lays out a grid centred on the origin", () => {
    expect(gridPoints(9, 10, 2).map((p) => [p.x, p.y])).toEqual([[-10, -10], [0, -10], [10, -10], [-10, 0], [0, 0], [10, 0], [-10, 10], [0, 10], [10, 10]]);
  });
  it("writes a hexagon with a vertex to the east", () => {
    expect(hexagonPoints(0, 0, 10).split(" ")[0]).toBe("10.00,0.00");
    expect(hexagonPoints(0, 0, 10).split(" ")).toHaveLength(6);
  });
  it("picks a round scale bar", () => {
    expect(scaleBarLength(55)).toBe(20);
    expect(scaleBarLength(100)).toBe(50);
    expect(scaleBarLength(12)).toBe(5);
    expect(scaleBarLength(1.5)).toBe(1);
  });
});
