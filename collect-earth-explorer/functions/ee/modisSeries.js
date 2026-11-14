const { ee } = require("./auth");
const { meanSeries, evaluateSeries } = require("./series");
const { evaluate } = require("./promise");

/** MOD13Q1 NDVI is stored as int16 scaled by 10000. */
const NDVI_SCALE = 0.0001;

/**
 * MODIS 16-day NDVI (MOD13Q1, 250 m) mean over `plot` and MCD64A1 burned-area months
 * between `start` (inclusive) and `end` (exclusive). Port of getModis16DayNDVI and getBurnedArea.
 */
async function modisSeries(plot, start, end) {
  const ndviCol = ee
    .ImageCollection("MODIS/061/MOD13Q1")
    .filterDate(start, end)
    .select("NDVI")
    .map((img) => ee.Image(img.multiply(NDVI_SCALE).copyProperties(img, ["system:time_start", "system:index"])));
  const ndvi = evaluateSeries(meanSeries(ndviCol, "NDVI", plot, 250));

  // MCD64A1: monthly images, BurnDate = day of year of the burn, 0 = no burn.
  const burned = ee.ImageCollection("MODIS/061/MCD64A1").filterDate(start, end).select("BurnDate");
  const fireFc = ee
    .FeatureCollection(
      burned.map((img) => {
        const maxBurn = img.unmask().reduceRegion({ reducer: ee.Reducer.max(), geometry: plot, scale: 500 }).get("BurnDate");
        return ee.Feature(null, { month: img.get("system:time_start"), burnDoy: maxBurn });
      })
    )
    .filter(ee.Filter.gt("burnDoy", 0));
  const fires = evaluate(fireFc).then((fc) =>
    fc.features.map((f) => {
      const monthDate = new Date(f.properties.month);
      // Day-of-year counted from 1 Jan: Date.UTC(year, 0, doy) is Jan 0 plus doy days.
      const burnDate = Date.UTC(monthDate.getUTCFullYear(), 0, f.properties.burnDoy);
      return { month: f.properties.month, date: burnDate };
    })
  );

  const [ndviPoints, firePoints] = await Promise.all([ndvi, fires]);
  return { ndvi: ndviPoints, fires: firePoints };
}

module.exports = { modisSeries };
