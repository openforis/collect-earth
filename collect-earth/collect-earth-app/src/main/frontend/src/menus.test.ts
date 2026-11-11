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
    // Cloud sync status is a cloud project's (see "cloud and local projects")
    expect(enabled).toEqual(["importCep", "projects", "joinCloud", "language", "quit", "export", "import",
      "analyse", "lulucf", "loadKml", "dataFolder", "myDashboard", "missingPlots", "divideCsv", "deletePlots", "properties",
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
    const labels = [false, true].flatMap((cloud) =>
      appMenus({ plotsMap: false, cloud }).flatMap((m) => [m.label, ...m.items.flatMap((i) => [i.label, i.disabledReason, i.note].filter((k): k is string => !!k))]));
    expect(labels.filter((label) => !keys.has(label))).toEqual([]);
  });
});

describe("switch project", () => {
  it("is right under Import CEP file, in a local project and a cloud one", () => {
    for (const cloud of [false, true]) {
      const project = appMenus({ plotsMap: true, cloud }).find((m) => m.id === "project")!.items.map((i) => i.id);
      expect(project.slice(0, 2)).toEqual(["importCep", "projects"]);
    }
  });
});

describe("cloud and local projects", () => {
  const entry = (cloud: boolean, id: string) => appMenus({ plotsMap: true, cloud }).flatMap((m) => m.items).find((i) => i.id === id);

  it("disables the import in a cloud project, whose sync would never send the imported records", () => {
    expect(entry(false, "import")).toEqual({ id: "import", label: "DataPage.import.menu", enabled: true });
    expect(entry(true, "import")).toMatchObject({ enabled: false, disabledReason: "DataPage.import.cloudProject" });
  });

  it("disables the cloud sync status in a local project, which has no sync", () => {
    expect(entry(true, "cloudStatus")).toEqual({ id: "cloudStatus", label: "CloudSyncStatusDialog.menuItem", enabled: true });
    expect(entry(false, "cloudStatus")).toMatchObject({ enabled: false, disabledReason: "CloudSyncStatusDialog.localProject" });
  });

  it("says that what reads the database reads only this computer's records in a cloud project", () => {
    for (const id of ["export", "lulucf"]) {
      expect(entry(true, id)).toMatchObject({ enabled: true, note: "CollectEarthMenu.thisComputerOnly" });
      expect(entry(false, id)?.note).toBeUndefined();
    }
  });

  it("leaves to the dashboard the utilities it does for the whole team, and deletes only your own records", () => {
    expect(entry(true, "missingPlots")).toMatchObject({ enabled: false, disabledReason: "CollectEarthMenu.missingPlotsCloud" });
    expect(entry(true, "divideCsv")).toMatchObject({ enabled: false, disabledReason: "CollectEarthMenu.divideCsvCloud" });
    expect(entry(true, "deletePlots")).toMatchObject({ enabled: true, note: "CollectEarthMenu.ownRecordsOnly" });
    for (const id of ["missingPlots", "divideCsv", "deletePlots"]) expect(entry(false, id)).toEqual(expect.objectContaining({ enabled: true }));
    expect(entry(false, "deletePlots")?.note).toBeUndefined();
  });
});

describe("my dashboard", () => {
  it("is in the Tools menu, enabled: this computer's dashboard, or the cloud's page of a cloud project", () => {
    const tools = (cloud: boolean) => appMenus({ plotsMap: true, cloud }).find((m) => m.id === "tools")?.items.map((i) => i.id);
    const mine = (cloud: boolean) => appMenus({ plotsMap: true, cloud }).flatMap((m) => m.items).find((i) => i.id === "myDashboard");
    expect(mine(false)).toEqual({ id: "myDashboard", label: "LocalDashboard.menu", enabled: true });
    // The cloud's is a website with a sign-in of its own: its label says so, and its note names the server
    expect(mine(true)).toEqual({ id: "myDashboard", label: "LocalDashboard.cloudMenu", enabled: true, note: "LocalDashboard.cloudNote" });
    // Analyse the data: first, for a local project and a cloud one (the cloud's page)
    expect(tools(false)?.[0]).toBe("analyse");
    expect(tools(true)?.[0]).toBe("analyse");
  });
});

describe("send this computer's records to the cloud project", () => {
  it("is in the Data menu, enabled only in a cloud project", () => {
    const send = (cloud: boolean) => appMenus({ plotsMap: true, cloud }).find((m) => m.id === "data")?.items.find((i) => i.id === "sendToCloud");
    expect(send(true)).toEqual({ id: "sendToCloud", label: "CloudSend.menu", enabled: true });
    expect(send(false)).toEqual({ id: "sendToCloud", label: "CloudSend.menu", enabled: false, disabledReason: "CloudSend.notCloud" });
    // A client of another Collect Earth holds no records
    expect(appMenus({ plotsMap: true, cloud: true, client: true }).flatMap((m) => m.items).map((i) => i.id)).not.toContain("sendToCloud");
  });
});

describe("client mode", () => {
  it("drops the entries that act on the data of this instance, as the Swing window disabled them", () => {
    const menus = appMenus({ plotsMap: false, client: true });
    expect(menus.map((m) => m.id)).toEqual(["project", "tools", "settings", "help"]);
    expect(menus.find((m) => m.id === "tools")?.items.map((i) => i.id)).toEqual(["lulucf"]);
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
    const entries = drawerSections(appMenus({ plotsMap: true, cloud: true })).sections.flatMap((m) => m.items);
    expect(entries.find((i) => i.id === "divideCsv")).toMatchObject({ enabled: false, disabledReason: "CollectEarthMenu.divideCsvCloud" });
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
