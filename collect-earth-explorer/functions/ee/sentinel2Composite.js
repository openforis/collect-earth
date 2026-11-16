const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { sentinel2Images, SENTINEL_FALSE_COLOUR_RENAMED, SENTINEL_TRUE_COLOUR_RENAMED } = require("./sentinel2");

function sharpen(image) {
  const log = image.convolve(ee.Kernel.gaussian(10, 7, "meters")).convolve(ee.Kernel.laplacian8(0.5));
  return image.subtract(log);
}

function monthsBefore(isoDate, months) {
  const d = new Date(isoDate);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Cloud-masked median of `[start, end)` (by default the 12 months ending at `end`), sharpened,
 * limited to the bands of the chosen combination (selected before sharpening: identical result,
 * fewer bands convolved). `maxCloud` is the scene-level cloudy-pixel limit (percent).
 * Returns the unvisualised image and its visualisation so callers and tests can inspect them.
 */
function buildComposite(plot, end, { bands, maxCloud, start = monthsBefore(end, 12) } = {}) {
  const viz = bands === "true-colour" ? SENTINEL_TRUE_COLOUR_RENAMED : SENTINEL_FALSE_COLOUR_RENAMED;
  const median = sentinel2Images(plot, start, end, { maxCloudyPercent: maxCloud }).median().select(viz.bands);
  return { image: sharpen(median), start, viz };
}

/** Tile URL for the composite ending at `end`; options as buildComposite. */
async function sentinel2CompositeTiles(plot, end, options) {
  const { image, start, viz } = buildComposite(plot, end, options);
  const tileUrl = await getTileUrl(image.visualize(viz));
  return { tileUrl, label: `Sentinel-2 composite ${start} to ${end}`, dateRange: { start, end } };
}

module.exports = { sentinel2CompositeTiles, buildComposite, monthsBefore };
