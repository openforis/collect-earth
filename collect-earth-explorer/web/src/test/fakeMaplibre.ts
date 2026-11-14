import { vi } from "vitest";

type Handler = () => void;

export class FakeSource {
  setTiles = vi.fn();
}

/**
 * Stand-in for `maplibre-gl`'s `Map` in component tests. Records every call made
 * against the map, per instance, so a test can assert what reached which map and
 * that nothing reached a map after `remove()`.
 */
export class FakeMap {
  static instances: FakeMap[] = [];
  options: Record<string, unknown>;
  calls: string[] = [];
  callsAfterRemove: string[] = [];
  removed = false;
  handlers: Record<string, Handler[]> = {};
  sources: Record<string, FakeSource> = {};
  /** layer id -> beforeId it was inserted under */
  layers: Record<string, string | undefined> = {};
  addSource = vi.fn((id: string, _spec: unknown) => {
    this.record("addSource");
    this.sources[id] = new FakeSource();
  });
  addLayer = vi.fn((layer: { id: string }, before?: string) => {
    this.record("addLayer");
    this.layers[layer.id] = before;
  });
  removeLayer = vi.fn((id: string) => {
    this.record("removeLayer");
    delete this.layers[id];
  });
  removeSource = vi.fn((id: string) => {
    this.record("removeSource");
    delete this.sources[id];
  });
  getSource = vi.fn((id: string) => {
    this.record("getSource");
    return this.sources[id];
  });
  getLayer = vi.fn((id: string) => {
    this.record("getLayer");
    return id in this.layers ? { id } : undefined;
  });
  getContainer = vi.fn(() => this.options.container as HTMLElement);
  addControl = vi.fn(() => this);
  isStyleLoaded = () => false;
  on = vi.fn((ev: string, h: Handler) => {
    this.record("on");
    (this.handlers[ev] ??= []).push(h);
    return this;
  });
  off = vi.fn(() => this);
  remove = vi.fn(() => {
    this.removed = true;
  });
  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
    FakeMap.instances.push(this);
  }
  record(name: string) {
    this.calls.push(name);
    if (this.removed) this.callsAfterRemove.push(name);
  }
  fire(ev: string) {
    for (const h of this.handlers[ev] ?? []) h();
  }
}

/** Factory for `vi.mock("maplibre-gl", fakeMaplibreModule)`. */
export const fakeMaplibreModule = () => ({
  Map: FakeMap,
  NavigationControl: class {},
  ScaleControl: class {},
});
