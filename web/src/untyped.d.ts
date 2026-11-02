declare module "plotly.js-dist-min";

// Ships no types; this mirrors the API in its index.js / API.md.
declare module "@maplibre/maplibre-gl-compare" {
  import type { Map } from "maplibre-gl";
  export interface CompareOptions {
    orientation?: "vertical" | "horizontal";
    mousemove?: boolean;
  }
  export default class Compare {
    constructor(a: Map, b: Map, container: string | HTMLElement, options?: CompareOptions);
    setSlider(x: number): void;
    on(type: "slideend", fn: (e: { currentPosition: number }) => void): this;
    off(type: "slideend", fn: (e: { currentPosition: number }) => void): this;
    remove(): void;
  }
}
