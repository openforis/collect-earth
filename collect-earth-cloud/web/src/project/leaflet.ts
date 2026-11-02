import type * as Leaflet from "leaflet";

export type LeafletModule = typeof Leaflet;

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
