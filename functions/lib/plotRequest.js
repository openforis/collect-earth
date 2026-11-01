const area = require("@turf/area").default;

const MIN_DATE = "1984-01-01";
const MAX_AREA_HA = 100;

class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; this.code = "bad_request"; }
}

function toPolygon(geometry) {
  if (!geometry || typeof geometry !== "object") throw new BadRequest("plot geometry is required");
  if (geometry.type === "Polygon") return geometry;
  if (geometry.type === "MultiLineString" || geometry.type === "LineString") {
    const ring = geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates[0];
    const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring : [...ring, ring[0]];
    return { type: "Polygon", coordinates: [closed] };
  }
  if (geometry.type === "Point") {
    const d = 0.0005; // ~55 m half-side square
    const [x, y] = geometry.coordinates;
    return { type: "Polygon", coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] };
  }
  throw new BadRequest(`unsupported plot geometry type ${geometry.type}`);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function clampDate(value, fallback, min, max) {
  const s = typeof value === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) ? value : fallback;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequest(`invalid date ${value}`);
  if (d < new Date(min)) return min;
  if (d > new Date(max)) return max;
  return isoDate(d);
}

/** Validates and normalises the body shared by every endpoint. */
function parsePlotRequest(body, now = new Date()) {
  if (!body || !body.plot) throw new BadRequest("plot is required");
  const plot = toPolygon(body.plot);
  const ha = area(plot) / 10000;
  if (ha > MAX_AREA_HA) throw new BadRequest(`plot is ${ha.toFixed(0)} ha; maximum is ${MAX_AREA_HA} ha`);
  const today = isoDate(now);
  const start = clampDate(body.start, MIN_DATE, MIN_DATE, today);
  const end = clampDate(body.end, today, MIN_DATE, today);
  if (start > end) throw new BadRequest("start must be before end");
  return { plot, start, end, areaHa: ha };
}

module.exports = { parsePlotRequest, toPolygon, BadRequest, MIN_DATE };
