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
}

export const STATUS_COLORS: Record<PlotStatus, string> = {
  empty: "#e53935",
  partial: "#fdd835",
  saved: "#43a047",
};
export const ACTIVE_COLOR = "#00e5ff";
export const STATUS_LABELS: Record<PlotStatus, string> = {
  empty: "Not started",
  partial: "In progress",
  saved: "Completed",
};
