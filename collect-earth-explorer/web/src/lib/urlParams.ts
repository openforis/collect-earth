export type Polygon = { type: "Polygon"; coordinates: number[][][] };
type AnyGeometry = { type: string; coordinates: any };

export interface PlotParams {
  plot: Polygon;
  start: string;
  end: string;
  plotId: string;
  /** The survey's configuration document, decoded but not parsed. */
  configText?: string;
  /** The next plot Collect Earth will open (`next`, same form as `geoJson`), for warming its requests; undefined when absent or unreadable. */
  next?: Polygon;
}

export function toPolygon(g: AnyGeometry): Polygon {
  if (g.type === "Polygon") {
    const ring: unknown = g.coordinates?.[0];
    // At least two numbers per position, as the backend reads them (a third, an altitude, is ignored).
    const isPosition = (c: unknown) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
    if (!Array.isArray(ring) || ring.length < 3 || !ring.every(isPosition)) throw new Error("the plot has no outline");
    return g as Polygon;
  }
  if (g.type === "MultiLineString" || g.type === "LineString") {
    const ring: number[][] = g.type === "LineString" ? g.coordinates : g.coordinates[0];
    // Collect Earth sends empty coordinates for plots it holds only as a polygon (KML/WKT column, NFI tracts).
    if (!ring?.length) throw new Error("the plot has no outline");
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

/** The error `parsePlotUrl` throws for an address without a plot (the welcome page tells it apart). */
export const NO_PLOT = "geoJson URL parameter is required";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Reads the query (`?geoJson=…&plot_id=…`) and the fragment Collect Earth builds (`#geoJson=…;plotId=…;`); the fragment wins. */
export function parsePlotUrl(search: string, now: Date = new Date(), hash: string = ""): PlotParams {
  const q = new Map(new URLSearchParams(search));
  for (const segment of hash.replace(/^#/, "").split(";")) {
    const i = segment.indexOf("=");
    if (i < 1) continue;
    try {
      q.set(segment.slice(0, i), decodeURIComponent(segment.slice(i + 1)));
    } catch {
      // A badly encoded segment is skipped.
    }
  }
  const geoJson = q.get("geoJson");
  if (!geoJson) throw new Error(NO_PLOT);
  const end = q.get("endTime") || iso(now);
  return {
    plot: toPolygon(JSON.parse(geoJson)),
    start: q.get("startTime") || "1984-01-01",
    // A future end is clamped to today, as the API does: the year sliders would otherwise offer years it rejects.
    end: Date.parse(end) > now.getTime() ? iso(now) : end,
    plotId: q.get("plotId") || q.get("plot_id") || "",
    configText: q.get("config"),
    next: readPolygon(q.get("next")),
  };
}

function readPolygon(text: string | undefined): Polygon | undefined {
  try {
    return text ? toPolygon(JSON.parse(text)) : undefined;
  } catch {
    return undefined;
  }
}

export function polygonBounds(p: Polygon): [[number, number], [number, number]] {
  const xs = p.coordinates[0].map((c) => c[0]), ys = p.coordinates[0].map((c) => c[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** Why the server would refuse this plot, or undefined. */
export type ShapeProblem = "tooMany" | "tooWide" | "crosses" | "noArea" | "tooLarge";

/**
 * Mirrors functions/lib/plotRequest.js checkShape and its area limit (the server is the authority: change both together),
 * so a redrawn shape is refused before it is sent. The area is @turf/area's spherical ring formula.
 */
export function shapeProblem(p: Polygon): ShapeProblem | undefined {
  const ring = p.coordinates[0]; // closed
  const n = ring.length - 1;
  if (n > 500) return "tooMany";
  const [[x0, y0], [x1, y1]] = polygonBounds(p);
  if (x1 - x0 > 0.1 || y1 - y0 > 0.1) return "tooWide";
  const side = (a: number[], b: number[], c: number[]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edges share the closing vertex
      const [a, b, c, d] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return "crosses";
    }
  }
  const rad = Math.PI / 180;
  let sum = 0;
  if (n > 2) for (let i = 0; i < n; i++) sum += (ring[(i + 2) % n][0] - ring[i][0]) * rad * Math.sin(ring[(i + 1) % n][1] * rad);
  const ha = (Math.abs(sum) * 6371008.8 ** 2) / 2 / 10000;
  if (!(ha > 0)) return "noArea";
  if (ha > 100) return "tooLarge";
}
