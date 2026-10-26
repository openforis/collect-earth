import { describe, expect, it } from "vitest";
import { isInPanel } from "./panel";

describe("isInPanel", () => {
  it("is the page Google Earth Web's panel loads", () => {
    expect(isInPanel("?panel")).toBe(true);
    expect(isInPanel("?plot=id_1&panel=1")).toBe(true);
  });
  it("is not the plots map window", () => {
    expect(isInPanel("")).toBe(false);
    expect(isInPanel("?plot=panel")).toBe(false);
  });
});
