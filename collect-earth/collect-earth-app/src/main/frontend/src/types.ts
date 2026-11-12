export type LatLng = [number, number];
export type PlotStatus = "empty" | "partial" | "saved";
export type ListFilter = "all" | "pending" | "saved";

export interface PlotFeature {
  type: "Feature";
  geometry: { type: "GeometryCollection"; geometries: { type: string; coordinates: number[][][] }[] };
  /** id: every key joined by "," (what the records use); visibleId: the keys the collector may see (what is shown) */
  properties: Record<string, string | null> & { id: string; visibleId?: string | null; latitude: string; longitude: string };
}

export interface MapConfig {
  /** Collect Earth UI language (ISO code, e.g. "es") */
  language?: string;
  /** "generated" (from the survey, the default) or "balloon" (the CEP's balloon HTML) */
  webForm?: string;
}

export type GewState = "CLOSED" | "OPENING" | "MOVING" | "READY" | "WAITING" | "ERROR";

/** What the Google Earth Web window is doing (/googleEarthWeb/status): what the panel reads of it. */
export interface GewStatus {
  state: GewState;
}

export type ImagerySource = "GOOGLE_EARTH_WEB" | "ESRI_WAYBACK" | "PLANET" | "GEE_APP" | "EARTH_MAP"
  | "STREET_VIEW" | "EXTRA_MAP" | "SECURE_WATCH";

/** The tabs of the imagery window (/imagery/status). */
export interface ImageryStatus { sources: ImagerySource[]; visible: ImagerySource | null }

/** Where Google Earth Web looks: the centre and the height of ground in view (metres). */
export interface GroundView {
  center: LatLng;
  heightMeters: number;
}

export const STATUS_COLORS: Record<PlotStatus, string> = {
  empty: "#e53935",
  partial: "#fdd835",
  saved: "#43a047",
};
