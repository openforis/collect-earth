const { sentinel2Images } = require("./sentinel2");
const { ndvi } = require("./landsat");
const { meanSeries, evaluateSeries } = require("./series");

/** First day with Sentinel-2A data in COPERNICUS/S2_HARMONIZED. */
const SENTINEL_START = "2015-06-23";

/**
 * Clamps a "YYYY-MM-DD" start date to the first Sentinel-2 acquisition so an
 * earlier plot range does not request years of empty collection. Pure.
 */
function clampSentinelStart(start) {
  return start < SENTINEL_START ? SENTINEL_START : start;
}

/**
 * The [start, end) window actually requested from Sentinel-2 for a plot range:
 * the start clamped to SENTINEL_START, or null when nothing of the range falls
 * on or after the first acquisition (so callers skip Earth Engine). Pure.
 */
function sentinelWindow(start, end) {
  const s = clampSentinelStart(start);
  return s < end ? { start: s, end } : null;
}

/**
 * Per-scene mean NDVI at 10 m over `plot` from cloud-masked Sentinel-2 scenes
 * in [start, end). `ndvi` from landsat.js applies because both collections
 * rename to nir/red; copyProperties of the absent SPACECRAFT_ID is harmless.
 * A range entirely before the first Sentinel-2 scene yields no points without
 * an Earth Engine round trip.
 */
async function sentinel2Series(plot, start, end) {
  const w = sentinelWindow(start, end);
  if (!w) return { points: [] };
  const col = sentinel2Images(plot, w.start, w.end).map(ndvi);
  const points = await evaluateSeries(meanSeries(col, "NDVI", plot, 10));
  return { points };
}

module.exports = { sentinel2Series, sentinelWindow, clampSentinelStart, SENTINEL_START };
