import type { GewStatus, LatLng, MapConfig, PlotFeature, PlotStatus } from "./types";

/** Base URL of the Collect Earth embedded server (the page is served from it). */
export const HOST = window.location.origin + "/earth/";

export async function fetchMapConfig(): Promise<MapConfig> {
  const r = await fetch(HOST + "mapConfig");
  return (await r.json()) ?? {};
}

export async function fetchPlots(): Promise<{ features?: PlotFeature[]; warning?: string }> {
  const r = await fetch(HOST + "plotsGeoJson");
  if (!r.ok) throw new Error("plotsGeoJson HTTP " + r.status);
  return r.json();
}

export async function fetchStatuses(since: number | null): Promise<{ now: number; statuses: Record<string, PlotStatus> }> {
  const r = await fetch(HOST + "plotStatuses" + (since ? "?since=" + since : ""));
  return r.json();
}

/**
 * The form next to the map: by default the one Collect Earth generates from the survey (/form, which
 * reads the plot file values itself), or the CEP's balloon, where /balloon substitutes the $[...]
 * tokens with the plot's properties.
 */
export function formUrl(feature: PlotFeature, webForm = "generated", language = "en"): string {
  if (webForm !== "balloon") {
    return HOST + "form?id=" + encodeURIComponent(feature.properties.id) + "&lang=" + encodeURIComponent(language);
  }
  const params = Object.entries(feature.properties).map(
    ([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v ?? ""));
  params.push("host=" + encodeURIComponent(HOST));
  params.push("local_port=" + encodeURIComponent(window.location.port));
  params.push("randomNumber=" + Date.now());
  return HOST + "balloon?" + params.join("&") + "&web=true";
}

/** Opens the auxiliary windows (GEE App, Google Earth Web, ...) like a balloon would. The
 *  plotId is needed because the coordinates-only path leaves placemarkId null. */
export function openAuxiliaryWindows(feature: PlotFeature): void {
  const p = feature.properties;
  fetch(HOST + "openAuxiliaryWindows?latLongCoordinates=" + p.latitude + "," + p.longitude
    + "&plotId=" + encodeURIComponent(p.id)).catch(() => { /* non-fatal */ });
}

// ---------- Google Earth Web window (plot viewer "Plots map + Google Earth Web") ----------

export async function fetchGewStatus(): Promise<GewStatus> {
  const r = await fetch(HOST + "googleEarthWeb/status");
  if (!r.ok) throw new Error("googleEarthWeb/status HTTP " + r.status);
  return r.json();
}

/** Shows the plot even if it was the last one opened (reopens a closed window). */
export function gewShowPlot(feature: PlotFeature): void {
  const p = feature.properties;
  fetch(HOST + "googleEarthWeb/show?latLongCoordinates=" + p.latitude + "," + p.longitude
    + "&plotId=" + encodeURIComponent(p.id)).catch(() => { /* reported through the status */ });
}

/** Opens the window over the survey area before any plot is selected (no-op if open). */
export function gewOpenOverview(center: LatLng): void {
  fetch(HOST + "googleEarthWeb/open?latLongCoordinates=" + center[0] + "," + center[1]).catch(() => {});
}

export function gewArrangeWindows(): void {
  fetch(HOST + "googleEarthWeb/arrange").catch(() => {});
}

/** Neighbouring plots (with statuses) that Google Earth Web draws around the plot. */
export interface GewContextPlot { id: string; status: PlotStatus; rings: [number, number][][] }

export function postGewContext(plotId: string, plots: GewContextPlot[]): void {
  fetch(HOST + "googleEarthWeb/context", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plotId, plots }),
  }).catch(() => {});
}
