const area = require("@turf/area").default;
const { BadRequest, NotFound } = require("./errors");

const MIN_DATE = "1984-01-01";
const MAX_AREA_HA = 100;

function validatePosition(pos) {
  if (!Array.isArray(pos) || pos.length < 2 || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) {
    throw new BadRequest("plot coordinate is not a finite number");
  }
  const [lon, lat] = pos;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new BadRequest("plot coordinate out of range");
}

/** Checks a ring is an array of at least 3 valid [lon, lat] positions (before closing). */
function validateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) throw new BadRequest("plot ring needs at least 3 positions");
  ring.forEach(validatePosition);
}

function closeRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/**
 * Normalises any geometry Collect Earth sends into a single-ring Polygon.
 * Known limitation: plots crossing the antimeridian are measured as their
 * complement by @turf/area and rejected as oversize.
 */
function toPolygon(geometry) {
  if (!geometry || typeof geometry !== "object") throw new BadRequest("plot geometry is required");
  const { type, coordinates } = geometry;
  if (type === "Polygon" || type === "MultiLineString" || type === "LineString") {
    // Polygon: outer ring only. MultiLineString: first line only; Collect Earth only sends one.
    const ring = type === "LineString" ? coordinates : Array.isArray(coordinates) ? coordinates[0] : undefined;
    validateRing(ring);
    return { type: "Polygon", coordinates: [closeRing(ring)] };
  }
  if (type === "Point") {
    validatePosition(coordinates);
    const d = 0.0005; // ~55 m half-side square
    const [x, y] = coordinates;
    return { type: "Polygon", coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] };
  }
  throw new BadRequest(`unsupported plot geometry type ${type}`);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

/**
 * Parses "YYYY-M-D" (padding optional) as a UTC date. Anything that is missing
 * or does not match the shape falls back to the default: Collect Earth has sent
 * oddly formatted dates in the past, so only a well-shaped but impossible date
 * (e.g. 2000-02-31) is rejected.
 */
function clampDate(value, fallback, min, max) {
  const m = typeof value === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value) : null;
  let d;
  if (m) {
    const [y, mo, day] = m.slice(1).map(Number);
    d = new Date(Date.UTC(y, mo - 1, day));
    if (mo < 1 || mo > 12 || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) {
      throw new BadRequest(`invalid date ${value}`);
    }
  } else {
    d = new Date(fallback);
  }
  if (d < new Date(min)) return min;
  if (d > new Date(max)) return max;
  return isoDate(d);
}

/** Validates and normalises the body shared by every endpoint. */
function parsePlotRequest(body, now = new Date()) {
  if (!body || !body.plot) throw new BadRequest("plot is required");
  const plot = toPolygon(body.plot);
  const ha = area(plot) / 10000;
  if (ha > MAX_AREA_HA) throw new BadRequest(`plot is ${ha.toFixed(1)} ha; maximum is ${MAX_AREA_HA} ha`);
  const today = isoDate(now);
  const start = clampDate(body.start, MIN_DATE, MIN_DATE, today);
  const end = clampDate(body.end, today, MIN_DATE, today);
  if (start > end) throw new BadRequest("start must be before end");
  return { plot, start, end, areaHa: ha };
}

module.exports = { parsePlotRequest, toPolygon, BadRequest, NotFound, MIN_DATE };
