const crypto = require("node:crypto");

/** Recursively sorts object keys so that JSON.stringify is independent of insertion order. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((o, k) => { o[k] = stable(value[k]); return o; }, {});
  }
  return value;
}

/**
 * SHA-1 hex key (40 chars) for one cacheable request: the endpoint, the parsed plot and
 * date range, plus the endpoint-specific `extras` (year, band, ...). `areaHa` is derived
 * from the plot, so it is deliberately left out.
 */
function cacheKey(endpoint, parsed, extras) {
  const payload = JSON.stringify(stable({ endpoint, plot: parsed.plot, start: parsed.start, end: parsed.end, extras: extras || {} }));
  return crypto.createHash("sha1").update(payload).digest("hex");
}

module.exports = { cacheKey };
