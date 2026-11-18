const { ee } = require("./auth");
const { meanSeries, evaluateSeries } = require("./series");

/** ERA5-Land's grid: 0.1 degree, about 11 km. */
const SCALE = 11132;

/**
 * Monthly rainfall at `plot` in [start, end): one point per month dated at the month's start, in mm rounded to 0.1.
 * ERA5-Land monthly aggregates (global, unlike CHIRPS which stops at 50 degrees), sampled at the plot's centroid:
 * a cell is far larger than a plot, and a reduction over a plot smaller than a cell finds no pixel (null).
 */
async function precipitationSeries(plot, start, end) {
  const col = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR").filterDate(start, end);
  const points = await evaluateSeries(meanSeries(col, "total_precipitation_sum", plot.centroid(1), SCALE));
  return { points: points.map(({ date, value }) => ({ date, value: Math.round(value * 10000) / 10 })) };
}

module.exports = { precipitationSeries };
