import { describe, expect, it } from "vitest";
import type { SigridFacts } from "./api";
import { districtOptions, firstSpacing, sigridFileName } from "./sigridView";

const facts: SigridFacts = {
  country: "Benin",
  spacings: [1, 2, 4],
  provinces: [
    { name: "A", plots: [80000, 20000, 5000], districts: [{ name: "a1", plots: [1, 1, 1] }, { name: "", plots: [0, 0, 0] }] },
    { name: "B", plots: [1, 1, 1], districts: [{ name: "a1", plots: [1, 1, 1] }] },
  ],
  selected: [80001, 20001, 5001],
  max: 50000,
};

describe("SIGRID choice", () => {
  it("names the plot file after the country and the spacing", () => {
    expect(sigridFileName("Cote_d_Ivoire", 8)).toBe("SIGRID_Cote_d_Ivoire_8km.csv");
  });

  it("lists the districts with their province (the same name in two provinces stays two districts)", () => {
    expect(districtOptions(facts).map((d) => d.key)).toEqual(["A\u0000a1", "B\u0000a1"]);
  });

  it("starts at the finest spacing within the limit", () => {
    expect(firstSpacing(facts)).toBe(2);
    expect(firstSpacing({ ...facts, selected: [9e5, 9e5, 9e5] })).toBe(4);
    expect(firstSpacing({ ...facts, spacings: [], selected: [] })).toBeNull();
  });
});
