const { ee } = require("./auth");
const { getTileUrl, evaluate } = require("./promise");
const { notFoundIfEmpty } = require("../lib/errors");
const { meanSeries, evaluateSeries } = require("./series");

/** Fixed stretches in dB; `diff` is VV minus VH. */
const STRETCH = { VV: [-20, 0], VH: [-27, -5], diff: [0, 15] };
const VIZ = {
  "false-colour": { bands: ["VV", "VH", "diff"], min: [STRETCH.VV[0], STRETCH.VH[0], STRETCH.diff[0]], max: [STRETCH.VV[1], STRETCH.VH[1], STRETCH.diff[1]] },
  vv: { bands: ["VV"], min: STRETCH.VV[0], max: STRETCH.VV[1] },
  vh: { bands: ["VH"], min: STRETCH.VH[0], max: STRETCH.VH[1] },
};

/** Sentinel-1 GRD interferometric wide-swath scenes over `plot` in [start, end) with both VV and VH (backscatter in dB). */
function sentinel1Images(plot, start, end) {
  return ee.ImageCollection("COPERNICUS/S1_GRD")
    .filterBounds(plot)
    .filterDate(start, end)
    .filter(ee.Filter.eq("instrumentMode", "IW"))
    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    .select(["VV", "VH"]);
}

/** Median VV and VH of `year` plus their difference `diff`; returns the image and the collection it reduces. */
function buildRadarComposite(plot, year) {
  const collection = sentinel1Images(plot, `${year}-01-01`, `${year + 1}-01-01`);
  const median = collection.median();
  return { image: median.addBands(median.select("VV").subtract(median.select("VH")).rename("diff")), collection };
}

/** Tile URL for the yearly Sentinel-1 composite in `bands` ("false-colour", "vv" or "vh"); 404 not_found when the year has no scene. */
async function sentinel1CompositeTiles(plot, year, { bands = "false-colour" } = {}) {
  const { image, collection } = buildRadarComposite(plot, year);
  notFoundIfEmpty(await evaluate(collection.size()), `no Sentinel-1 scenes for ${year}`);
  const tileUrl = await getTileUrl(image.visualize(VIZ[bands]));
  return { tileUrl, label: `Sentinel-1 ${year} radar composite` };
}

/**
 * Per-acquisition mean of `band` ("VH" or "VV") over `plot` at 10 m in [start, end), in dB. The mean is taken in
 * linear power (10^(dB/10)) and converted back, as averaging dB values would bias it low.
 */
async function sentinel1Series(plot, start, end, band = "VH") {
  const col = sentinel1Images(plot, start, end).map((img) =>
    ee.Image(ee.Image(10).pow(img.select(band).divide(10)).rename("power").copyProperties(img, ["system:time_start", "system:index"]))
  );
  const points = await evaluateSeries(meanSeries(col, "power", plot, 10));
  return { points: points.map((p) => ({ ...p, value: p.value > 0 ? 10 * Math.log10(p.value) : null })).filter((p) => p.value !== null) };
}

module.exports = { sentinel1CompositeTiles, sentinel1Series, sentinel1Images, buildRadarComposite, VIZ };
