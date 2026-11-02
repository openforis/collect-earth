const { ee } = require("./auth");

const CLOUD_SCORE_THRESHOLD = 0.6;
const CLOUD_PROBABILITY_THRESHOLD = 65;
const COMMON_BANDS = ["B2", "B3", "B4", "B6", "B8", "B8A", "B9", "B11", "B12", "QA60"];
const RENAMED = ["blue", "green", "red", "red2", "nir", "red4", "h2o", "swir1", "swir2", "QA60"];

function rename(img) { return img.select(COMMON_BANDS, RENAMED); }

function cloudScoreMask(image) {
  const cloudScore = ee.Image(image.get("cloudScore"));
  return cloudScore.gt(CLOUD_SCORE_THRESHOLD).reduce(ee.Reducer.min());
}

function maskWithCloudScore(collection) {
  return ee.ImageCollection(
    ee.Join.saveFirst({ matchKey: "cloudScore", outer: true }).apply({
      primary: collection.linkCollection({ imageCollection: ee.ImageCollection("COPERNICUS/S2_CLOUD_PROBABILITY"), linkedBands: ["probability"] }),
      secondary: ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"),
      condition: ee.Filter.equals({ leftField: "system:index", rightField: "system:index" }),
    })
  ).map((image) => {
    const mask = ee.Image(ee.Algorithms.If(image.get("cloudScore"), cloudScoreMask(image), image.select("probability").lt(CLOUD_PROBABILITY_THRESHOLD)));
    return rename(image).updateMask(mask);
  });
}

/** Sentinel-2 L1C harmonized scenes over the plot, bands renamed, optionally cloud-masked. */
function sentinel2Images(plot, start, end, { maxCloudyPercent = 70, mask = true } = {}) {
  let filter = ee.Filter.and(ee.Filter.date(start, end), ee.Filter.bounds(plot), ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", maxCloudyPercent));
  let col = ee.ImageCollection("COPERNICUS/S2_HARMONIZED").filter(filter).select(COMMON_BANDS);
  return mask ? maskWithCloudScore(col) : col.map(rename);
}

/** One scene by system:time_start, preferring the SR product when it exists. Port of getImageTimeStart. */
function sentinel2Scene(plot, timeStart) {
  const filter = ee.Filter.and(ee.Filter.bounds(plot), ee.Filter.equals("system:time_start", timeStart));
  const sr = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filter(filter);
  const toa = ee.ImageCollection(ee.Join.inverted().apply({
    primary: ee.ImageCollection("COPERNICUS/S2_HARMONIZED").filter(filter),
    secondary: sr,
    condition: ee.Filter.equals({ leftField: "system:index", rightField: "system:index" }),
  }));
  return ee.Image(sr.merge(toa).first());
}

const SENTINEL_FALSE_COLOUR = { bands: ["B8", "B11", "B4"], min: 0, max: 3000 };
const SENTINEL_FALSE_COLOUR_RENAMED = { bands: ["nir", "swir1", "red"], min: 0, max: 3000 };

module.exports = { sentinel2Images, sentinel2Scene, SENTINEL_FALSE_COLOUR, SENTINEL_FALSE_COLOUR_RENAMED };
