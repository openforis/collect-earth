const { mergedLandsat } = require("./landsat");
const { indexImage, formulaOf, LANDSAT_BANDS } = require("./indices");
const { meanSeries, evaluateSeries } = require("./series");

/**
 * Per-scene mean of the named `index` (catalogue.json "indices"), or of `formula` when given, over `plot` from cloud-masked Landsat 5/7/8/9 scenes in
 * [start, end). Each point carries the scene's SPACECRAFT_ID as `sensor` and its CLOUD_COVER (percent of the whole scene) as `cloud`.
 */
async function landsatSeries(plot, start, end, index = "NDVI", formula = formulaOf(index)) {
  const col = mergedLandsat(plot, start, end, true).map((img) => indexImage(img, formula, LANDSAT_BANDS));
  const points = await evaluateSeries(meanSeries(col, "index", plot, 30, landsatPointProps));
  return { points };
}

/** The scene properties each Landsat point carries besides date, value and id. */
const landsatPointProps = (img) => ({ sensor: img.get("SPACECRAFT_ID"), cloud: img.get("CLOUD_COVER") });

module.exports = { landsatSeries, landsatPointProps };
