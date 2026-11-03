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
    expect(enabled).toEqual(["importCep", "joinCloud", "cloudStatus", "language", "quit", "export", "importZip", "updateCsv",
      "saiku", "saikuTool", "lulucf", "loadKml", "dataFolder", "myDashboard", "missingPlots", "divideCsv", "deletePlots", "properties",
      "manual", "support", "log", "showExceptions", "updates", "disclaimer", "about"]);
    // The survey guide only when the survey has one, as the Swing menu showed it
    expect(appMenus({ plotsMap: true, surveyGuide: true }).find((m) => m.id === "help")?.items[0].id).toBe("surveyGuide");
  });

  it("offers to open the plots map only with the Google Earth Pro viewer", () => {
    const ids = (plotsMap: boolean) => appMenus({ plotsMap }).flatMap((m) => m.items).map((i) => i.id);
    expect(ids(false)).toContain("openPlotsMap");
    expect(ids(true)).not.toContain("openPlotsMap");
  });

  it("has Show exception errors in Help, as a toggle, disabled until it is built", () => {
    const help = appMenus({ plotsMap: true }).find((m) => m.id === "help")!;
    const toggles = appMenus({ plotsMap: true }).flatMap((m) => m.items).filter((i) => i.kind === "toggle");
    expect(toggles.map((i) => i.id)).toEqual(["showExceptions"]);
    expect(help.items).toContainEqual({ id: "showExceptions", label: "CollectEarthMenu.9", enabled: true, kind: "toggle" });
  });

  it("opens the properties from the Settings menu", () => {
    const settings = appMenus({ plotsMap: true }).find((m) => m.id === "settings")!;
    expect(settings.items.map((i) => i.id)).toEqual(["properties"]);
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

describe("my dashboard", () => {
  it("is in the Tools menu when working alone, not in a cloud project, which has the cloud's", () => {
    const tools = (cloud: boolean) => appMenus({ plotsMap: true, cloud }).find((m) => m.id === "tools")?.items.map((i) => i.id);
    expect(tools(false)).toContain("myDashboard");
    expect(tools(true)).not.toContain("myDashboard");
  });
});

describe("client mode", () => {
  it("drops the entries that act on the data of this instance, as the Swing window disabled them", () => {
    const menus = appMenus({ plotsMap: false, client: true });
    expect(menus.map((m) => m.id)).toEqual(["project", "tools", "settings", "help"]);
    expect(menus.find((m) => m.id === "tools")?.items.map((i) => i.id)).toEqual(["saiku", "saikuTool", "lulucf"]);
  });
});
