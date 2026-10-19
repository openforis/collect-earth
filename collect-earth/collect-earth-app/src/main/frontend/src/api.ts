import type { MapConfig, PlotFeature, PlotStatus } from "./types";

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

/** /balloon does server-side $[...] substitution with the plot's CSV properties. */
export function formUrl(feature: PlotFeature): string {
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
