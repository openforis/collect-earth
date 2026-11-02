import { describe, it, expect } from "vitest";
import { pointsToCsv } from "./csv";

describe("pointsToCsv", () => {
  it("writes ISO dates and values", () => {
    const csv = pointsToCsv([{ date: Date.UTC(2020, 0, 2), value: 0.5, sensor: "LANDSAT_8" }], ["sensor"]);
    expect(csv).toBe("date,value,sensor\n2020-01-02,0.5,LANDSAT_8\n");
  });
});
