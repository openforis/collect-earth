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

/** Cloud-masked median of the 12 months ending at `end`, sharpened, false colour. */
async function sentinel2CompositeTiles(plot, end) {
  const start = monthsBefore(end, 12);
  const composite = sharpen(sentinel2Images(plot, start, end).median());
  const tileUrl = await getTileUrl(composite.visualize(SENTINEL_FALSE_COLOUR_RENAMED));
  return { tileUrl, label: `Sentinel-2 composite ${start} to ${end}`, dateRange: { start, end } };
}

module.exports = { sentinel2CompositeTiles, monthsBefore };
