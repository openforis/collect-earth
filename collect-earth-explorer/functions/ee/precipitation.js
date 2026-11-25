const { ee } = require("./auth");
const { evaluate } = require("./promise");
const { meanSeries, evaluateSeries } = require("./series");
const { monthlyTotals, mmPerMonth, round1 } = require("../lib/rainfall");

/**
 * The rainfall datasets by the `dataset` parameter: collection, band, native scale (m) and how its sampled points
 * become monthly mm. ERA5-Land: monthly totals in m, 0.1 degree, global, from 1950. CHIRPS: pentads in mm, 0.05
 * degree, 50 S to 50 N, from 1981. GPM IMERG V07: monthly mean rate in mm/h, 0.1 degree, global, from 1998.
 */
const DATASETS = {
  "era5-land": {
    id: "ECMWF/ERA5_LAND/MONTHLY_AGGR",
    band: "total_precipitation_sum",
    scale: 11132,
    // A mean per image, as before the other datasets: getRegion picks another cell for ERA5-Land, so cached answers would differ.
    perImage: true,
    toMonths: (points) => points.map(({ date, value }) => ({ date, value: Math.round(value * 10000) / 10 })),
  },
  chirps: { id: "UCSB-CHG/CHIRPS/PENTAD", band: "precipitation", scale: 5566, toMonths: monthlyTotals },
  imerg: {
    id: "NASA/GPM_L3/IMERG_MONTHLY_V07",
    band: "precipitation",
    scale: 11132,
    toMonths: (points) => points.map(({ date, value }) => ({ date, value: round1(mmPerMonth(date, value)) })),
  },
};

/**
 * Monthly rainfall at `plot` in [start, end): one point per month dated at the month's start, in mm rounded to 0.1,
 * from `dataset` (default ERA5-Land). Sampled at the plot's centroid: a cell is far larger than a plot, and a reduction
 * over a plot smaller than a cell finds no pixel (null). Outside a dataset's area (CHIRPS beyond 50 degrees) no point.
 */
async function precipitationSeries(plot, start, end, dataset = "era5-land") {
  const { id, band, scale, perImage, toMonths } = DATASETS[dataset];
  const col = ee.ImageCollection(id).filterDate(start, end).select(band);
  if (perImage) return { points: toMonths(await evaluateSeries(meanSeries(col, band, plot.centroid(1), scale))) };
  // getRegion: one table of [id, lon, lat, time, value] rows; for CHIRPS's ~3000 pentads about 8 times faster than a mean per image.
  const [, ...rows] = await evaluate(col.getRegion(plot.centroid(1), scale));
  const points = rows.map((r) => ({ date: r[3], value: r[4] })).filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date - b.date);
  return { points: toMonths(points) };
}

module.exports = { precipitationSeries };
