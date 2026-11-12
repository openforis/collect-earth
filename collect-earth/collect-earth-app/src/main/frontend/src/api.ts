import type { GewStatus, GroundView, ImagerySource, ImageryStatus, MapConfig, PlotFeature, PlotStatus } from "./types";

/**
 * Base URL of the Collect Earth embedded server (the page is served from it). Read at each call, not when the module
 * is imported, so that the tests, which run in node without a window, can import the modules that use it.
 */
export const earthBase = () => window.location.origin + "/earth/";

export async function fetchMapConfig(): Promise<MapConfig> {
  const r = await fetch(earthBase() + "mapConfig");
  return (await r.json()) ?? {};
}

export async function fetchPlots(): Promise<{ features?: PlotFeature[]; warning?: string }> {
  const r = await fetch(earthBase() + "plotsGeoJson");
  if (!r.ok) throw new Error("plotsGeoJson HTTP " + r.status);
  return r.json();
}

export async function fetchStatuses(since: number | null): Promise<{ now: number; statuses: Record<string, PlotStatus> }> {
  const r = await fetch(earthBase() + "plotStatuses" + (since ? "?since=" + since : ""));
  return r.json();
}

/**
 * The form of a plot: by default the one Collect Earth generates from the survey (/form, which
 * reads the plot file values itself), or the CEP's balloon, where /balloon substitutes the $[...]
 * tokens with the plot's properties.
 */
export function formUrl(feature: PlotFeature, webForm = "generated", language = "en"): string {
  if (webForm !== "balloon") {
    return earthBase() + "form?id=" + encodeURIComponent(feature.properties.id) + "&lang=" + encodeURIComponent(language);
  }
  const params = Object.entries(feature.properties).map(
    ([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v ?? ""));
  params.push("host=" + encodeURIComponent(earthBase()));
  params.push("local_port=" + encodeURIComponent(window.location.port));
  params.push("randomNumber=" + Date.now());
  return earthBase() + "balloon?" + params.join("&") + "&web=true";
}

/** Opens the auxiliary windows (GEE App, Google Earth Web, ...) like a balloon would. The
 *  plotId is needed because the coordinates-only path leaves placemarkId null. */
export function openAuxiliaryWindows(feature: PlotFeature): void {
  const p = feature.properties;
  fetch(earthBase() + "openAuxiliaryWindows?latLongCoordinates=" + p.latitude + "," + p.longitude
    + "&plotId=" + encodeURIComponent(p.id)).catch(() => { /* non-fatal */ });
}

// ---------- Google Earth Web, around the panel ----------

export async function fetchGewStatus(): Promise<GewStatus> {
  const r = await fetch(earthBase() + "googleEarthWeb/status");
  if (!r.ok) throw new Error("googleEarthWeb/status HTTP " + r.status);
  return r.json();
}

/** Google Earth Web looks at this place, with as much ground in view. */
export function gewMoveCamera(view: GroundView): void {
  fetch(earthBase() + "googleEarthWeb/camera?latitude=" + view.center[0] + "&longitude=" + view.center[1]
    + "&heightMeters=" + view.heightMeters).catch(() => {});
}

// ---------- The imagery window: a tab per source ----------

/** The tabs open in the imagery window, in their order, and the one shown. */
export async function fetchImageryStatus(): Promise<ImageryStatus> {
  const r = await fetch(earthBase() + "imagery/status");
  if (!r.ok) throw new Error("imagery/status HTTP " + r.status);
  return r.json();
}

/** Brings the tab of the source to the front, and the imagery window over the others. */
export function showImagerySource(source: ImagerySource): void {
  fetch(earthBase() + "imagery/show?source=" + encodeURIComponent(source)).catch(() => { /* the next status shows what is open */ });
}

/** Neighbouring plots (with statuses) that Google Earth Web draws around the plot. */
export interface GewContextPlot { id: string; status: PlotStatus; rings: [number, number][][] }

export function postGewContext(plotId: string, plots: GewContextPlot[]): void {
  fetch(earthBase() + "googleEarthWeb/context", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plotId, plots }),
  }).catch(() => {});
}
