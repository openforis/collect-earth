/**
 * An entry of the app bar's menus. `label` is a key of Messages*.properties (serverTexts.ts). A "toggle" is an
 * entry with a check mark, whose state comes from the server once it is built.
 */
export interface MenuItem { id: string; label: string; enabled: boolean; kind?: "toggle" }
export interface Menu { id: string; label: string; items: MenuItem[] }

// The entries built so far: the others show, disabled, until their stage of docs/plans/2026-10-28-html-ui-design.md
const BUILT = new Set(["quit", "properties", "export", "import",
  "analyse", "saiku", "saikuTool", "lulucf", "loadKml", "dataFolder", "openPlotsMap", "myDashboard", "missingPlots", "divideCsv", "deletePlots",
  "importCep", "joinCloud", "cloudStatus", "language", "surveyGuide", "manual", "support", "log", "showExceptions", "updates", "disclaimer", "about"]);

/**
 * The entries the Swing window disabled when Collect Earth acts as a client of another instance (serverMenuItems):
 * they act on data this instance does not hold.
 */
const SERVER_ONLY = new Set(["analyse", "export", "import", "loadKml", "dataFolder", "openPlotsMap", "myDashboard", "missingPlots", "divideCsv", "deletePlots"]);

const item = (id: string, label: string): MenuItem => ({ id, label, enabled: BUILT.has(id) });
const toggle = (id: string, label: string): MenuItem => ({ ...item(id, label), kind: "toggle" });

export interface MenuContext {
  plotsMap: boolean;
  /** The survey has a guide: the Swing menu showed the entry only then */
  surveyGuide?: boolean;
  /** A client of another Collect Earth: the entries that act on the data go */
  client?: boolean;
  /** A cloud project: its dashboard is the cloud's, so there is no local one (My dashboard) */
  cloud?: boolean;
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
      // One import, which asks what to import: a ZIP export of Collect Earth, or a CSV that updates attributes
      item("import", "DataPage.import.menu"),
    ] },
    { id: "tools", label: "CollectEarthWindow.12", items: [
      // The analysis page of the dashboard (docs/plans/2026-11-05-node-and-arena.md, stage 6a), what replaces Saiku: the
      // local dashboard's, or the cloud's for a cloud project. Saiku stays below it until it leaves the installer.
      item("analyse", "CollectEarthMenu.analyse"),
      item("saiku", "CollectEarthWindow.14"),
      item("saikuTool", "CollectEarthWindow.71"),
      item("lulucf", "CollectEarthWindow.72"),
      item("loadKml", "CollectEarthWindow.54"),
      item("dataFolder", "CollectEarthWindow.67"),
      // Your dashboard, on this computer (docs/plans/2026-11-03-desktop-dashboard.md); a cloud project has the cloud's
      ...(app.cloud ? [] : [item("myDashboard", "LocalDashboard.menu")]),
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

/** A section of the navigation drawer of the compact bar. */
export interface DrawerSection {
  id: string;
  label: string;
  items: MenuItem[];
  /** Under its label as a heading; a menu of a single entry of the same name (Settings) is that entry alone */
  heading: boolean;
  /** A menu used rarely, folded under its label until unfolded: the drawer of a narrow panel then needs no scrolling */
  folds: boolean;
}

// The everyday menus first, those of now and then folded last
const DRAWER_ORDER = ["project", "data", "tools", "settings", "utilities", "help"];
const FOLDED = new Set(["utilities", "help"]);

/**
 * The menus as the navigation drawer of the compact bar shows them: the sections in the order of DRAWER_ORDER, the
 * rare ones folded, and Quit out of its menu, to come last, apart. What appMenus decided (the entries, enabled or not,
 * those of a client or a cloud project) is kept as it is.
 */
export function drawerSections(menus: Menu[]): { sections: DrawerSection[]; quit: MenuItem | null } {
  const rank = (m: Menu) => {
    const i = DRAWER_ORDER.indexOf(m.id);
    return i < 0 ? DRAWER_ORDER.length : i;
  };
  const quit = menus.flatMap((m) => m.items).find((i) => i.id === "quit") ?? null;
  const sections = [...menus].sort((a, b) => rank(a) - rank(b))
    .map((m) => ({ id: m.id, label: m.label, items: m.items.filter((i) => i.id !== "quit") }))
    .filter((m) => m.items.length > 0)
    .map((m) => ({ ...m, heading: !(m.items.length === 1 && m.items[0].label === m.label), folds: FOLDED.has(m.id) }));
  return { sections, quit };
}

/**
 * The entry the keyboard moves to in a list of `count` (the drawer's, as MUI's menus do): up and down go round, Home and
 * End go to the ends; null for any other key, or no entries. From none (-1), down goes to the first and up to the last.
 */
export function nextEntry(current: number, count: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp": return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
