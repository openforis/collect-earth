import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appMenus, drawerSections, nextEntry } from "./menus";
import { MENU_ICONS } from "./menuIcons";

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

describe("the drawer of the compact bar", () => {
  const ids = (menus: ReturnType<typeof drawerSections>) => menus.sections.map((m) => m.id);

  it("shows the everyday menus first, the rare ones folded, and Quit last, out of its menu", () => {
    const drawer = drawerSections(appMenus({ plotsMap: true }));
    expect(ids(drawer)).toEqual(["project", "data", "tools", "settings", "utilities", "help"]);
    expect(drawer.sections.filter((m) => m.folds).map((m) => m.id)).toEqual(["utilities", "help"]);
    expect(drawer.quit?.id).toBe("quit");
    expect(drawer.sections.flatMap((m) => m.items).map((i) => i.id)).not.toContain("quit");
  });

  it("has every entry of the menus, as appMenus made it, and no other", () => {
    for (const context of [{ plotsMap: false, surveyGuide: true }, { plotsMap: true, cloud: true }, { plotsMap: true, client: true }]) {
      const menus = appMenus(context);
      const drawer = drawerSections(menus);
      const entries = [...drawer.sections.flatMap((m) => m.items), ...(drawer.quit ? [drawer.quit] : [])];
      expect(entries.sort((a, b) => a.id.localeCompare(b.id))).toEqual(menus.flatMap((m) => m.items).sort((a, b) => a.id.localeCompare(b.id)));
    }
  });

  it("keeps the filtering of a client and of a cloud project", () => {
    expect(ids(drawerSections(appMenus({ plotsMap: false, client: true })))).toEqual(["project", "tools", "settings", "help"]);
    const entries = drawerSections(appMenus({ plotsMap: true, cloud: true })).sections.flatMap((m) => m.items).map((i) => i.id);
    expect(entries).not.toContain("myDashboard");
  });

  it("shows Settings, a menu of one entry of the same name, as that entry alone", () => {
    const sections = drawerSections(appMenus({ plotsMap: true })).sections;
    expect(sections.filter((m) => !m.heading).map((m) => m.id)).toEqual(["settings"]);
  });

  it("drops a menu left empty without Quit", () => {
    const drawer = drawerSections([{ id: "project", label: "P", items: [{ id: "quit", label: "Q", enabled: true }] }]);
    expect(drawer.sections).toEqual([]);
    expect(drawer.quit?.id).toBe("quit");
  });

  it("gives every entry an icon", () => {
    const entries = appMenus({ plotsMap: false, surveyGuide: true }).flatMap((m) => m.items).map((i) => i.id);
    expect(entries.filter((id) => !(id in MENU_ICONS))).toEqual([]);
    // and none for an entry there is not
    expect(Object.keys(MENU_ICONS).filter((id) => !entries.includes(id))).toEqual([]);
  });
});

describe("nextEntry", () => {
  it("moves through the entries as a menu does, round at the ends", () => {
    expect(nextEntry(0, 3, "ArrowDown")).toBe(1);
    expect(nextEntry(2, 3, "ArrowDown")).toBe(0);
    expect(nextEntry(0, 3, "ArrowUp")).toBe(2);
    expect(nextEntry(1, 3, "Home")).toBe(0);
    expect(nextEntry(1, 3, "End")).toBe(2);
  });
  it("starts from the ends when no entry has the focus, and leaves other keys", () => {
    expect(nextEntry(-1, 3, "ArrowDown")).toBe(0);
    expect(nextEntry(-1, 3, "ArrowUp")).toBe(2);
    expect(nextEntry(1, 3, "Enter")).toBeNull();
    expect(nextEntry(-1, 0, "ArrowDown")).toBeNull();
  });
});
