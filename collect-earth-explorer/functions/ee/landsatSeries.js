const { mergedLandsat } = require("./landsat");
const { indexImage, LANDSAT_NAMES } = require("./indices");
const { meanSeries, evaluateSeries } = require("./series");

/**
 * Per-scene mean `index` (NDVI, NDMI, NBR or EVI) over `plot` from cloud-masked Landsat 5/7/8/9 scenes in
 * [start, end). Each point carries the scene's SPACECRAFT_ID as `sensor`.
 */
async function landsatSeries(plot, start, end, index = "NDVI") {
  const col = mergedLandsat(plot, start, end, true).map((img) => indexImage(img, index, LANDSAT_NAMES));
  const points = await evaluateSeries(meanSeries(col, index, plot, 30, (img) => ({ sensor: img.get("SPACECRAFT_ID") })));
  return { points };
}

module.exports = { landsatSeries };
