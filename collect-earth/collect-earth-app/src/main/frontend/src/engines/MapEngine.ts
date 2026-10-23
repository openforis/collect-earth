import type { MessageKey } from "../i18n";
import type { GroundView, LatLng } from "../types";

export interface EngineCallbacks {
  onPlotClick(id: string): void;
  onZoomChange(): void;
  /** The user (not the code) moved or zoomed the map; called once it comes to rest. */
  onUserViewChange(view: GroundView): void;
}

export interface EngineConfig {
  /** Zoom at/above which plots are drawn as polygons instead of dots. */
  zoomThreshold: number;
  emptyColor: string;
  apiKey: string;
  /** Runtime failure (e.g. Google key rejected): the controller swaps in Leaflet. */
  onEngineFailure(reason: MessageKey): void;
  /** Preferred base layer name (from the viewer's saved preferences). */
  baseLayer?: string;
}

/**
 * A map rendering engine (Leaflet or Google Maps). The controller owns the plots and
 * their statuses; an engine only draws them and reports clicks/zoom changes.
 */
export interface MapEngine {
  readonly name: "leaflet" | "google";
  init(container: HTMLElement, config: EngineConfig, callbacks: EngineCallbacks): void;
  /** rings: [lat,lng] arrays; center: [lat,lng] */
  addPlot(id: string, rings: LatLng[][], center: LatLng): void;
  /** Takes the plot off the map (no longer in the plots loaded); nothing if it is not there. */
  removePlot(id: string): void;
  /** Applies to both the polygons and the dot marker. */
  setPlotColor(id: string, color: string): void;
  /** Center on `center`, zooming in to at least `minZoom` (never zooming out). */
  flyTo(center: LatLng, minZoom: number): void;
  fitAll(centers: LatLng[]): void;
  zoomBy(delta: number): void;
  setZoomVisibilityMode(showPolygons: boolean): void;
  isAboveThreshold(): boolean;
  /** The container was resized: re-measure, keeping the same geographic center. */
  invalidateSize(): void;
  /** Outline of the area shown in Google Earth Web (null hides it). */
  setFootprint(corners: LatLng[] | null): void;
  /** Where the map looks (null before it is ready). */
  getView(): GroundView | null;
  /** Looks at `view` (following Google Earth Web); not reported as a user move. */
  showView(view: GroundView): void;
  /** The user is dragging, zooming or has just let go: the map must not be moved under them. */
  isUserInteracting(): boolean;
  baseLayers(): string[];
  currentBaseLayer(): string;
  setBaseLayer(name: string): void;
  destroy(): void;
}
