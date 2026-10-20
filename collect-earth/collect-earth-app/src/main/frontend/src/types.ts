export type LatLng = [number, number];
export type PlotStatus = "empty" | "partial" | "saved";
export type ListFilter = "all" | "pending" | "saved";

export interface PlotFeature {
  type: "Feature";
  geometry: { type: "GeometryCollection"; geometries: { type: string; coordinates: number[][][] }[] };
  properties: Record<string, string | null> & { id: string; latitude: string; longitude: string };
}

export interface MapConfig {
  engine?: string;
  googleMapsApiKey?: string;
  viewerType?: string;
  /** Collect Earth UI language (ISO code, e.g. "es") */
  language?: string;
}

export type GewState = "CLOSED" | "OPENING" | "MOVING" | "READY" | "WAITING" | "ERROR";

/** Ground area shown by a top-down Google Earth Web view (heading: degrees clockwise from north). */
export interface GewView {
  latitude: number;
  longitude: number;
  widthMeters: number;
  heightMeters: number;
  heading: number;
}

/** What the Google Earth Web window is doing (/googleEarthWeb/status). */
export interface GewStatus {
  state: GewState;
  plotId: string | null;
  message: string | null;
  view?: GewView | null;
}

export const STATUS_COLORS: Record<PlotStatus, string> = {
  empty: "#e53935",
  partial: "#fdd835",
  saved: "#43a047",
};
export const ACTIVE_COLOR = "#00e5ff";
