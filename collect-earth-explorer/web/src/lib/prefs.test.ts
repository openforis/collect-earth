import { afterEach, describe, expect, it, vi } from "vitest";
import { endForSession, sessionNumber } from "./prefs";

describe("sessionNumber", () => {
  afterEach(() => vi.restoreAllMocks());

  it("counts each new tab session once, not its reloads", () => {
    expect(sessionNumber("k")).toBe(1);
    expect(sessionNumber("k")).toBe(1); // a reload in the same session
    sessionStorage.clear(); // a new session
    expect(sessionNumber("k")).toBe(2);
    expect(localStorage.getItem("k")).toBe("2");
  });

  it("is Infinity for the rest of the session once ended", () => {
    localStorage.setItem("k", "1");
    endForSession("k");
    expect(sessionNumber("k")).toBe(Infinity);
    expect(localStorage.getItem("k")).toBe("1");
  });

  it("is Infinity when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(sessionNumber("k")).toBe(Infinity);
  });
});
