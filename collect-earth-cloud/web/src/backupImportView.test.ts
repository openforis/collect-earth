import { describe, expect, it } from "vitest";
import { layoutProblem, layoutSize, megabytes, round2 } from "./backupImportView";

const square = { shape: "SQUARE" as const, points: 49, distance: 10.1, boundary: 5.05, pointSide: 2 };

describe("the plot layout of a backup's project", () => {
  it("gives a square's side and area from its points and spacing, a circle's area from its radius", () => {
    // 7 points 10.1 m apart, 5.05 m from the edge: 70.7 m, half a hectare (the backup's collectearth:plotarea)
    const s = layoutSize(square)!;
    expect(round2(s.side!)).toBe("70.7");
    expect(round2(s.areaHa)).toBe("0.5");
    expect(round2(layoutSize({ ...square, shape: "CIRCLE", distance: 40 })!.areaHa)).toBe("0.5");
    expect(layoutSize({ ...square, distance: 0 })).toBeNull();
  });

  it("refuses a square of a number of points that is not a square", () => {
    expect(layoutProblem(square)).toBeNull();
    expect(layoutProblem({ ...square, points: 1 })).toBeNull();
    expect(layoutProblem({ ...square, points: 10 })).toBe("backupImport.squarePoints");
    expect(layoutProblem({ ...square, shape: "CIRCLE", points: 10 })).toBeNull();
    expect(layoutProblem({ ...square, distance: Number.NaN })).toBe("error.required");
  });

  it("writes sizes in megabytes", () => {
    expect(megabytes(23 * 1024 * 1024)).toBe("23.0");
  });
});
