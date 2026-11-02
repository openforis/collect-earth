const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { sentinel2Images, SENTINEL_FALSE_COLOUR_RENAMED } = require("./sentinel2");

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
 * Cloud-masked median of the 12 months ending at `end`, sharpened, limited to the
 * false-colour bands (selected before sharpening: identical result, fewer bands convolved).
 * Returns the unvisualised image so callers and tests can inspect it.
 */
function buildComposite(plot, end) {
  const start = monthsBefore(end, 12);
  const median = sentinel2Images(plot, start, end).median().select(SENTINEL_FALSE_COLOUR_RENAMED.bands);
  return { image: sharpen(median), start };
}

/** Tile URL for the false-colour composite ending at `end`. */
async function sentinel2CompositeTiles(plot, end) {
  const { image, start } = buildComposite(plot, end);
  const tileUrl = await getTileUrl(image.visualize(SENTINEL_FALSE_COLOUR_RENAMED));
  return { tileUrl, label: `Sentinel-2 composite ${start} to ${end}`, dateRange: { start, end } };
}

module.exports = { sentinel2CompositeTiles, buildComposite, monthsBefore };
