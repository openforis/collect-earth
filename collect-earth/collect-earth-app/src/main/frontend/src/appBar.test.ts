import { describe, expect, it } from "vitest";
import { ApiError } from "./apiClient";
import { actionOf, comingSoon, errorText, operatorRequired, quitServer } from "./appBar";
import type { AppInfo } from "./appInfo";
import { appMenus } from "./menus";

const info = (operator: string | null): AppInfo =>
  ({ project: "p", operator, language: "en", viewer: "plots_map", plotsMap: true, version: "2.0.0" });

describe("app bar", () => {
  it("shows every entry that does nothing yet as coming soon", () => {
    const items = appMenus({ plotsMap: false }).flatMap((m) => m.items);
    expect(items.filter((i) => !comingSoon(i)).map((i) => i.id)).toEqual(["quit", "export", "importZip", "updateCsv", "properties"]);
    // An entry enabled by menus.ts but with no action here yet is not offered either
    expect(comingSoon({ id: "about", label: "x", enabled: true })).toBe(true);
    expect(comingSoon({ id: "quit", label: "x", enabled: false })).toBe(true);
  });

  it("dispatches an entry to its action, and nothing for the others", () => {
    expect(actionOf({ id: "quit", label: "x", enabled: true })).toBe("quit");
    expect(actionOf({ id: "properties", label: "x", enabled: true })).toBe("settings");
    expect(actionOf({ id: "export", label: "x", enabled: true })).toBe("export");
    expect(actionOf({ id: "about", label: "x", enabled: false })).toBeNull();
    // Not a property of every object
    expect(actionOf({ id: "constructor", label: "x", enabled: true })).toBeNull();
  });

  it("asks for the operator, without a way out, only once the app is known to have none", () => {
    expect(operatorRequired(null)).toBe(false);
    expect(operatorRequired(info("Jane Doe"))).toBe(false);
    expect(operatorRequired(info(null))).toBe(true);
    expect(operatorRequired(info(""))).toBe(true);
    expect(operatorRequired(info("   "))).toBe(true);
  });

  it("takes a server gone before it answered for a server that quit", async () => {
    await expect(quitServer(() => Promise.resolve(undefined))).resolves.toBeUndefined();
    await expect(quitServer(() => Promise.reject(new ApiError("network", "Failed to fetch", 0)))).resolves.toBeUndefined();
    await expect(quitServer(() => Promise.reject(new ApiError("http.500", "Boom", 500)))).rejects.toThrow("Boom");
  });
});

describe("errorText", () => {
  it("says the server could not be reached, rather than the browser's words", () => {
    expect(errorText(new ApiError("network", "Failed to fetch", 0), "Unreachable")).toBe("Unreachable");
    expect(errorText(new ApiError("operator.length", "Too short", 400), "Unreachable")).toBe("Too short");
    expect(errorText(new Error("Boom"), "Unreachable")).toBe("Boom");
  });
});
