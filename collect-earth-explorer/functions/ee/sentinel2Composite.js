const { ee } = require("./auth");
const { getTileUrl, evaluate } = require("./promise");
const { notFoundIfEmpty } = require("../lib/errors");
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
 * Returns the unvisualised image, the collection it reduces and its visualisation so callers and tests can inspect them.
 */
function buildComposite(plot, end, { bands, maxCloud, start = monthsBefore(end, 12) } = {}) {
  const viz = bands === "true-colour" ? SENTINEL_TRUE_COLOUR_RENAMED : SENTINEL_FALSE_COLOUR_RENAMED;
  const collection = sentinel2Images(plot, start, end, { maxCloudyPercent: maxCloud });
  return { image: sharpen(collection.median().select(viz.bands)), collection, start, viz };
}

/**
 * Whether the composite's window can plausibly hold no scene: only an explicit window or a cloud limit
 * (the route passes them only when not the default). The standard 12 months always has scenes, so it skips the check. Pure.
 */
function mayBeEmpty(options = {}) {
  return options.start !== undefined || options.maxCloud !== undefined;
}

/** The unvisualised composite ending at `end` with its label; options as buildComposite. 404 not_found when a custom window has no scene. */
async function sentinel2CompositeImage(plot, end, options) {
  const { image, collection, start, viz } = buildComposite(plot, end, options);
  if (mayBeEmpty(options)) notFoundIfEmpty(await evaluate(collection.size()), `no Sentinel-2 scenes from ${start} to ${end}`);
  return { image, start, viz, label: `Sentinel-2 composite ${start} to ${end}` };
}

/** Tile URL for the composite ending at `end`; options and 404 as sentinel2CompositeImage. */
async function sentinel2CompositeTiles(plot, end, options) {
  const { image, start, viz, label } = await sentinel2CompositeImage(plot, end, options);
  const tileUrl = await getTileUrl(image.visualize(viz));
  return { tileUrl, label, dateRange: { start, end } };
}

module.exports = { sentinel2CompositeTiles, sentinel2CompositeImage, buildComposite, monthsBefore, mayBeEmpty };
