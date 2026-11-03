import { describe, expect, it } from "vitest";
import { isHome, statusCounts } from "./home";

describe("home", () => {
  it("is the map page asked for with ?home", () => {
    expect(isHome("?home")).toBe(true);
    expect(isHome("?plot=12")).toBe(false);
  });
  it("counts the plots by status", () => {
    expect(statusCounts(["a", "b", "c", "d"], { a: "saved", b: "partial", c: "saved" }))
      .toEqual({ saved: 2, partial: 1, empty: 1, total: 4 });
  });
});
