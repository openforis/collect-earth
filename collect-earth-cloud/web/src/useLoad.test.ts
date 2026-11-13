import { describe, expect, it } from "vitest";
import { samePlace } from "./queryClient";

describe("what a screen keeps showing while its next answer loads", () => {
  it("the last answer of the same project, or of the same kind outside any project", () => {
    expect(samePlace(["project", "p1", "getPerson", "u1"], ["project", "p1", "getPerson", "u2"])).toBe(true);
    expect(samePlace(["project", "p1", "getOverview"], ["project", "p2", "getOverview"])).toBe(false);
    expect(samePlace(["app", "listUsers", { page: 1 }], ["app", "listUsers", { page: 2 }])).toBe(true);
    expect(samePlace(["app", "listUsers"], ["project", "p1", "listUsers"])).toBe(false);
  });
});
