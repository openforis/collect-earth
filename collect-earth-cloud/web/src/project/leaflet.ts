import type * as Leaflet from "leaflet";
import type { Translate } from "../i18n";
import { escapeHtml } from "../mapView";

export type LeafletModule = typeof Leaflet;

/** A group of plots on a map: grey, not a status colour (it holds plots of any), with its count. */
export function clusterIcon(L: LeafletModule, cluster: Leaflet.MarkerCluster, language: string, t: Translate): Leaflet.DivIcon {
  const n = cluster.getChildCount();
  const size = n < 100 ? 32 : n < 1000 ? 38 : n < 10000 ? 44 : 50;
  let text = String(n);
  try {
    text = new Intl.NumberFormat(language, { notation: "compact" }).format(n);
  } catch {
    // the plain number
  }
  const label = escapeHtml(t("map.cluster", { n: text }));
  return L.divIcon({
    html: `<div role="img" aria-label="${label}" style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(33,33,33,0.8);border:2px solid #fff;color:#fff;font:600 12px/1 Roboto,sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box">${text}</div>`,
    className: "",
    iconSize: L.point(size, size),
  });
}

let loading: Promise<LeafletModule> | null = null;

/**
 * Leaflet and leaflet.markercluster, bundled (no CDN) and loaded only when a map is shown, so
 * the other pages do not carry them. leaflet.markercluster 1.5 is a plugin that extends the
 * global `L`, so Leaflet is put there before it is loaded.
 */
export function loadLeaflet(): Promise<LeafletModule> {
  loading ??= (async () => {
    const L = ((await import("leaflet")) as unknown as { default: LeafletModule }).default;
    await Promise.all([import("leaflet/dist/leaflet.css"), import("leaflet.markercluster/dist/MarkerCluster.css")]);
    (globalThis as { L?: LeafletModule }).L = L;
    await import("leaflet.markercluster");
    return L;
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
