import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appMenus } from "./menus";

describe("appMenus", () => {
  it("keeps the order of the Swing menu bar", () => {
    expect(appMenus({ plotsMap: true }).map((m) => m.id)).toEqual(["project", "data", "tools", "utilities", "settings", "help"]);
  });

  it("only enables what is built", () => {
    const enabled = appMenus({ plotsMap: true }).flatMap((m) => m.items).filter((i) => i.enabled).map((i) => i.id);
    expect(enabled).toEqual(["quit"]);
  });

  it("offers to open the plots map only with the Google Earth Pro viewer", () => {
    const ids = (plotsMap: boolean) => appMenus({ plotsMap }).flatMap((m) => m.items).map((i) => i.id);
    expect(ids(false)).toContain("openPlotsMap");
    expect(ids(true)).not.toContain("openPlotsMap");
  });

  it("has no entry twice", () => {
    const ids = appMenus({ plotsMap: false }).flatMap((m) => [m.id, ...m.items.map((i) => "item." + i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels everything with keys of Messages.properties", () => {
    // The base bundle, the English one: the other languages fall back to it for a key they lack
    const file = resolve(import.meta.dirname, "../../resources/org/openforis/collect/earth/app/view/Messages.properties");
    const keys = new Set([...readFileSync(file, "latin1").matchAll(/^([^#!\s=:][^\s=:]*)\s*[=:]/gm)].map((m) => m[1]));
    const labels = appMenus({ plotsMap: false }).flatMap((m) => [m.label, ...m.items.map((i) => i.label)]);
    expect(labels.filter((label) => !keys.has(label))).toEqual([]);
  });
});
