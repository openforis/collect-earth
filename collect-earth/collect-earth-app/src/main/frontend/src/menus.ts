/**
 * An entry of the app bar's menus. `label` is a key of Messages*.properties (serverTexts.ts). A "toggle" is an
 * entry with a check mark, whose state comes from the server once it is built.
 */
export interface MenuItem { id: string; label: string; enabled: boolean; kind?: "toggle" }
export interface Menu { id: string; label: string; items: MenuItem[] }

// The entries built so far: the others show, disabled, until their stage of docs/plans/2026-10-28-html-ui-design.md
const BUILT = new Set(["quit", "properties", "export", "importZip", "updateCsv",
  "saiku", "saikuTool", "lulucf", "loadKml", "dataFolder", "openPlotsMap", "missingPlots", "divideCsv", "deletePlots",
  "importCep", "joinCloud", "cloudStatus", "language", "surveyGuide", "manual", "support", "log", "showExceptions", "updates", "disclaimer", "about"]);

/**
 * The entries the Swing window disabled when Collect Earth acts as a client of another instance (serverMenuItems):
 * they act on data this instance does not hold.
 */
const SERVER_ONLY = new Set(["export", "importZip", "updateCsv", "loadKml", "dataFolder", "openPlotsMap", "missingPlots", "divideCsv", "deletePlots"]);

const item = (id: string, label: string): MenuItem => ({ id, label, enabled: BUILT.has(id) });
const toggle = (id: string, label: string): MenuItem => ({ ...item(id, label), kind: "toggle" });

export interface MenuContext {
  plotsMap: boolean;
  /** The survey has a guide: the Swing menu showed the entry only then */
  surveyGuide?: boolean;
  /** A client of another Collect Earth: the entries that act on the data go */
  client?: boolean;
}

/**
 * The menus of the app bar, in the order of the Swing menu bar (CollectEarthMenu), so users find things where they
 * were. Swing nests Data Import/Export, Utilities, Properties and Language in its Tools menu; here they are menus of
 * their own (Language goes to Project), and the export entries of the Data menu are a single one, the export dialog.
 */
export function appMenus(app: MenuContext): Menu[] {
  const menus = allMenus(app);
  if (!app.client) return menus;
  return menus.map((m) => ({ ...m, items: m.items.filter((i) => !SERVER_ONLY.has(i.id)) })).filter((m) => m.items.length > 0);
}

function allMenus(app: MenuContext): Menu[] {
  return [
    { id: "project", label: "CollectEarthWindow.10", items: [
      item("importCep", "CollectEarthMenu.0"),
      item("joinCloud", "CollectEarthMenu.joinCloudProject"),
      item("cloudStatus", "CloudSyncStatusDialog.menuItem"),
      item("language", "CollectEarthWindow.2"),
      item("quit", "CollectEarthWindow.11"),
    ] },
    { id: "data", label: "CollectEarthWindow.44", items: [
      item("export", "CollectEarthWindow.13"),
      item("importZip", "CollectEarthWindow.46"),
      item("updateCsv", "CollectEarthWindow.55"),
    ] },
    { id: "tools", label: "CollectEarthWindow.12", items: [
      item("saiku", "CollectEarthWindow.14"),
      item("saikuTool", "CollectEarthWindow.71"),
      item("lulucf", "CollectEarthWindow.72"),
      item("loadKml", "CollectEarthWindow.54"),
      item("dataFolder", "CollectEarthWindow.67"),
      // The plots map is already the page when it is the viewer
      ...(app.plotsMap ? [] : [item("openPlotsMap", "CollectEarthMenu.openPlotsMap")]),
    ] },
    { id: "utilities", label: "CollectEarthMenu.2", items: [
      item("missingPlots", "CollectEarthWindow.18"),
      item("divideCsv", "CollectEarthMenu.3"),
      item("deletePlots", "CollectEarthMenu.10"),
    ] },
    { id: "settings", label: "CollectEarthWindow.15", items: [item("properties", "CollectEarthWindow.15")] },
    { id: "help", label: "CollectEarthWindow.16", items: [
      ...(app.surveyGuide ? [item("surveyGuide", "CollectEarthWindow.70")] : []),
      item("manual", "CollectEarthWindow.50"),
      item("support", "CollectEarthWindow.64"),
      item("log", "CollectEarthWindow.52"),
      toggle("showExceptions", "CollectEarthMenu.9"),
      item("updates", "CollectEarthWindow.51"),
      item("disclaimer", "CollectEarthWindow.17"),
      item("about", "CollectEarthWindow.56"),
    ] },
  ];
}
