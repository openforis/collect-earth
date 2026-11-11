export type LatLng = [number, number];
export type PlotStatus = "empty" | "partial" | "saved";
export type ListFilter = "all" | "pending" | "saved";
/** What the collector said of a plot of a repeat survey against its earlier period (the survey's period_status) */
export type PeriodAnswer = "same" | "changed" | "corrected";
/** The plots of a repeat survey shown by that answer: all, those of one answer, or those not answered yet */
export type PeriodFilter = "all" | PeriodAnswer | "none";
export const PERIOD_FILTERS: PeriodFilter[] = ["all", "same", "changed", "corrected", "none"];

export interface PlotFeature {
  type: "Feature";
  geometry: { type: "GeometryCollection"; geometries: { type: string; coordinates: number[][][] }[] };
  /** id: every key joined by "," (what the records use); visibleId: the keys the collector may see (what is shown) */
  properties: Record<string, string | null> & { id: string; visibleId?: string | null; latitude: string; longitude: string };
}

export interface MapConfig {
  engine?: string;
  googleMapsApiKey?: string;
  viewerType?: string;
  /** Collect Earth UI language (ISO code, e.g. "es") */
  language?: string;
  /** "generated" (from the survey, the default) or "balloon" (the CEP's balloon HTML) */
  webForm?: string;
  /** The open plot's sample points numbered, as the rows of the form's table per point (sample_point_numbers) */
  samplePointNumbers?: boolean;
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
  /** Whether the camera can follow the plots map (false when Google Earth Web needs page loads). */
  cameraSync?: boolean;
}

export type ImagerySource = "GOOGLE_EARTH_WEB" | "ESRI_WAYBACK" | "PLANET" | "GEE_APP" | "EARTH_MAP"
  | "STREET_VIEW" | "EXTRA_MAP" | "SECURE_WATCH";

/** The tabs of the imagery window (/imagery/status). */
export interface ImageryStatus { sources: ImagerySource[]; visible: ImagerySource | null }

/** Where a map or Google Earth Web looks: the centre and the height of ground in view (metres). */
export interface GroundView {
  center: LatLng;
  heightMeters: number;
}

export const STATUS_COLORS: Record<PlotStatus, string> = {
  empty: "#e53935",
  partial: "#fdd835",
  saved: "#43a047",
};
/** A plot the filter by the earlier period leaves out, on the map: grey, the plots shown keep their status colours */
export const FADED_COLOR = "#9e9e9e";
/** The selected plot, in the yellow Collect Earth has always drawn plots in (as in Google Earth Web and Pro). */
export const ACTIVE_COLOR = "#ffff00";
