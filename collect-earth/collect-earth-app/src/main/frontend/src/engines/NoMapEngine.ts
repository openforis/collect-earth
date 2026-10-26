import type { GroundView, LatLng } from "../types";
import type { EngineCallbacks, EngineConfig, MapEngine } from "./MapEngine";

/**
 * No map: the plots map in a panel of Google Earth Web's page (see panel.ts), where Google Earth Web is the map and the
 * panel shows only the plot list and the form. Every call does nothing, so the controller runs as with a map.
 */
export class NoMapEngine implements MapEngine {
  readonly name = "none" as const;
  init(_container: HTMLElement | null, _config: EngineConfig, _callbacks: EngineCallbacks): void {}
  addPlot(_id: string, _rings: LatLng[][], _center: LatLng): void {}
  removePlot(_id: string): void {}
  setPlotColor(_id: string, _color: string): void {}
  flyTo(_center: LatLng, _minZoom: number): void {}
  fitAll(_centers: LatLng[]): void {}
  zoomBy(_delta: number): void {}
  setZoomVisibilityMode(_showPolygons: boolean): void {}
  isAboveThreshold(): boolean { return false; }
  invalidateSize(): void {}
  setFootprint(_corners: LatLng[] | null): void {}
  getView(): GroundView | null { return null; }
  showView(_view: GroundView): void {}
  isUserInteracting(): boolean { return false; }
  baseLayers(): string[] { return []; }
  currentBaseLayer(): string { return ""; }
  setBaseLayer(_name: string): void {}
  destroy(): void {}
}
