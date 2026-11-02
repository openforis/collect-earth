export type Polygon = { type: "Polygon"; coordinates: number[][][] };
type AnyGeometry = { type: string; coordinates: any };

export interface PlotParams {
  plot: Polygon;
  start: string;
  end: string;
  plotId: string;
}

export function toPolygon(g: AnyGeometry): Polygon {
  if (g.type === "Polygon") return g as Polygon;
  if (g.type === "MultiLineString" || g.type === "LineString") {
    const ring: number[][] = g.type === "LineString" ? g.coordinates : g.coordinates[0];
    const first = ring[0], last = ring[ring.length - 1];
    const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
    return { type: "Polygon", coordinates: [closed] };
  }
  if (g.type === "Point") {
    // Same ~55 m half-side square the backend's toPolygon builds, so the map and the API agree.
    const [x, y] = g.coordinates as number[];
    const d = 0.0005;
    return { type: "Polygon", coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] };
  }
  throw new Error(`unsupported geometry ${g.type}`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function parsePlotUrl(search: string, now: Date = new Date()): PlotParams {
  const q = new URLSearchParams(search);
  const geoJson = q.get("geoJson");
  if (!geoJson) throw new Error("geoJson URL parameter is required");
  return {
    plot: toPolygon(JSON.parse(geoJson)),
    start: q.get("startTime") || "1984-01-01",
    end: q.get("endTime") || iso(now),
    plotId: q.get("plot_id") || "",
  };
}

export function polygonBounds(p: Polygon): [[number, number], [number, number]] {
  const xs = p.coordinates[0].map((c) => c[0]), ys = p.coordinates[0].map((c) => c[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
