const { mergedLandsat, ndvi } = require("./landsat");
const { meanSeries, evaluateSeries } = require("./series");

/**
 * Per-scene mean NDVI over `plot` from cloud-masked Landsat 5/7/8/9 scenes in
 * [start, end). Each point carries the scene's SPACECRAFT_ID as `sensor`.
 */
async function landsatSeries(plot, start, end) {
  const col = mergedLandsat(plot, start, end, true).map(ndvi);
  const points = await evaluateSeries(meanSeries(col, "NDVI", plot, 30, (img) => ({ sensor: img.get("SPACECRAFT_ID") })));
  return { points };
}

module.exports = { landsatSeries };
