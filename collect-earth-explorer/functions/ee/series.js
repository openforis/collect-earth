const { ee } = require("./auth");
const { evaluate } = require("./promise");

/**
 * Reduces one band of every image to its mean over `plot` and returns an
 * ee.FeatureCollection with properties {date, value, id, ...extra(image)}.
 * `date` is the image's system:time_start in epoch milliseconds.
 */
function meanSeries(collection, band, plot, scale, extra) {
  return ee.FeatureCollection(
    collection.map((img) => {
      const mean = img
        .select(band)
        .reduceRegion({ reducer: ee.Reducer.mean(), geometry: plot, scale, maxPixels: 1e8 })
        .get(band);
      const props = Object.assign(
        { date: img.get("system:time_start"), value: mean, id: img.get("system:index") },
        extra ? extra(img) : {}
      );
      return ee.Feature(null, props);
    })
  );
}

/** Client-side reshaping of an evaluated FeatureCollection into points sorted by date, dropping empty values. */
function featuresToPoints(fc) {
  return fc.features
    .map((f) => f.properties)
    .filter((p) => p.value !== null && p.value !== undefined && Number.isFinite(p.value))
    .sort((a, b) => a.date - b.date);
}

async function evaluateSeries(fc) {
  return featuresToPoints(await evaluate(fc));
}

module.exports = { meanSeries, featuresToPoints, evaluateSeries };
