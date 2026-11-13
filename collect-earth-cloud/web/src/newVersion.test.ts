import { describe, expect, it } from "vitest";
import { newBuildAvailable } from "./newVersion";

describe("a page left open across an upgrade", () => {
  it("offers to reload only when the server serves another build", () => {
    expect(newBuildAvailable("aaa", "bbb")).toBe(true);
    expect(newBuildAvailable("aaa", "aaa")).toBe(false);
    // The development server serves no build; a page whose build is not known waits for one it knows.
    expect(newBuildAvailable(null, "bbb")).toBe(false);
    expect(newBuildAvailable("aaa", null)).toBe(false);
  });
});
