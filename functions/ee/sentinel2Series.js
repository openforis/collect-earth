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
 * Per-scene mean NDVI at 10 m over `plot` from cloud-masked Sentinel-2 scenes
 * in [start, end). `ndvi` from landsat.js applies because both collections
 * rename to nir/red; copyProperties of the absent SPACECRAFT_ID is harmless.
 */
async function sentinel2Series(plot, start, end) {
  const col = sentinel2Images(plot, clampSentinelStart(start), end).map(ndvi);
  const points = await evaluateSeries(meanSeries(col, "NDVI", plot, 10));
  return { points };
}

module.exports = { sentinel2Series, clampSentinelStart, SENTINEL_START };
