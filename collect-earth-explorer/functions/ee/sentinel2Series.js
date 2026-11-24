const { sentinel2Images } = require("./sentinel2");
const { indexImage, formulaOf, SENTINEL2_BANDS } = require("./indices");
const { meanSeries, evaluateSeries } = require("./series");

/** First day with Sentinel-2A data in COPERNICUS/S2_HARMONIZED. */
const SENTINEL_START = "2015-06-23";

/**
 * Clamps a "YYYY-MM-DD" start date to the first Sentinel-2 acquisition so an
 * earlier plot range does not request years of empty collection. Pure.
 */
function clampSentinelStart(start, first = SENTINEL_START) {
  return start < first ? first : start;
}

/**
 * The [start, end) window actually requested from Sentinel-2 for a plot range:
 * the start clamped to SENTINEL_START, or null when nothing of the range falls
 * on or after the first acquisition (so callers skip Earth Engine). `first` is another collection's first day (HLS). Pure.
 */
function sentinelWindow(start, end, first) {
  const s = clampSentinelStart(start, first);
  return s < end ? { start: s, end } : null;
}

/**
 * Per-scene mean of the named `index` (catalogue.json "indices"), or of `formula` when given, at 10 m over
 * `plot` from cloud-masked Sentinel-2 scenes in [start, end). Reflectance is 0..10000, scaled to 0..1 first;
 * copyProperties of the absent SPACECRAFT_ID is harmless. Each point carries CLOUDY_PIXEL_PERCENTAGE (whole scene) as `cloud`.
 * A range entirely before the first Sentinel-2 scene yields no points without
 * an Earth Engine round trip.
 */
async function sentinel2Series(plot, start, end, index = "NDVI", formula = formulaOf(index)) {
  const w = sentinelWindow(start, end);
  if (!w) return { points: [] };
  const col = sentinel2Images(plot, w.start, w.end).map((img) => indexImage(img, formula, SENTINEL2_BANDS, 10000));
  const points = await evaluateSeries(meanSeries(col, "index", plot, 10, sentinel2PointProps));
  return { points };
}

/** The scene property each Sentinel-2 point carries besides date, value and id. */
const sentinel2PointProps = (img) => ({ cloud: img.get("CLOUDY_PIXEL_PERCENTAGE") });

module.exports = { sentinel2Series, sentinel2PointProps, sentinelWindow, clampSentinelStart, SENTINEL_START };
