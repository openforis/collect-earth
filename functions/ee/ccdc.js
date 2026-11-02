const { ee } = require("./auth");
const { evaluate } = require("./promise");
const ts = require("./vendor/temporalSegmentation");
const { shapeCcdc } = require("../lib/ccdcShape");
const { BadRequest } = require("../lib/plotRequest");

/*
 * Port of the Collect Earth GEE script WiellTemporalSegmentation/uiChart
 * (chartPlot + createLandsatCollection) on top of the vendored Wiell library.
 * Reflectance is scaled to x10000 integers before the index is added, as in
 * the original: the NDFI endmembers below are expressed in that scale.
 */

const BANDS = ["blue", "green", "red", "nir", "swir1", "swir2"];
const CCDC_BANDS = ["NDFI", "NDVI"];
const SCALE = 30;

/**
 * Pure validation of the CCDC request fields. `band` defaults to NDFI when
 * absent. Throws BadRequest (400) so the route can answer before touching
 * Earth Engine.
 */
function validateCcdcRequest(body) {
  const { band } = body || {};
  if (band === undefined) return { band: "NDFI" };
  if (!CCDC_BANDS.includes(band)) throw new BadRequest(`band must be ${CCDC_BANDS.join(" or ")}`);
  return { band };
}

function toNdfi(image) {
  const gv = [500, 900, 400, 6100, 3000, 1000];
  const shade = [0, 0, 0, 0, 0, 0];
  const npv = [1400, 1700, 2200, 3000, 5500, 3000];
  const soil = [2000, 3000, 3400, 5800, 6000, 5800];
  const cloud = [9000, 9600, 8000, 7800, 7200, 6500];
  const unmixed = ee.Image(image)
    .select(BANDS)
    .unmix({ endmembers: [gv, shade, npv, soil, cloud], sumToOne: true, nonNegative: true })
    .rename(["gv", "shade", "npv", "soil", "cloud"]);
  return unmixed
    .expression("((i.gv / (1 - i.shade)) - (i.npv + i.soil)) / ((i.gv / (1 - i.shade)) + i.npv + i.soil)", { i: unmixed })
    .multiply(10000)
    .rename("NDFI");
}

function toNdvi(image) {
  return ee.Image(image).normalizedDifference(["nir", "red"]).multiply(10000).rename("NDVI");
}

/** Bits 3 and 5 of QA_PIXEL are cloud shadow and cloud; both must be clear. */
function maskLandsat(image) {
  const qa = image.select("pixel_qa");
  return image.updateMask(qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 5).eq(0)));
}

/**
 * Landsat 7/8/9 C2 L2 over the plot in [start, end), bands renamed, cloud
 * masked, scaled to x10000 integers with the index band added, and each image
 * reduced to its plot mean as a constant image (so CCDC runs on one series).
 */
function landsatCollection(plot, start, end, band) {
  const filter = ee.Filter.and(ee.Filter.bounds(plot), ee.Filter.date(start, end));
  const named = [...BANDS, "pixel_qa"];
  const l7 = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").filter(filter)
    .select(["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7", "QA_PIXEL"], named);
  const l8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").filter(filter)
    .select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7", "QA_PIXEL"], named);
  const l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").filter(filter)
    .select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7", "QA_PIXEL"], named);
  const toIndex = band === "NDVI" ? toNdvi : toNdfi;
  return l7.merge(l8).merge(l9).map((raw) => {
    const masked = maskLandsat(raw).select(BANDS);
    const scaled = ee.Image(masked.multiply(0.0000275).add(-0.2).multiply(10000).toInt32().copyProperties(raw, raw.propertyNames()));
    const withIndex = scaled.addBands(toIndex(scaled));
    const plotMean = withIndex.reduceRegion({ reducer: ee.Reducer.mean(), geometry: plot, scale: SCALE });
    return ee.Image(plotMean.toImage().int16().copyProperties(raw, raw.propertyNames()));
  }).sort("system:time_start");
}

/**
 * CCDC temporal segmentation of the plot-mean NDFI (or NDVI) series:
 * observed points, one fitted monthly series per segment, and break dates,
 * all as epoch milliseconds with index values in [-1, 1].
 */
async function ccdcSeries(plot, start, end, band) {
  const v = validateCcdcRequest({ band });
  const collection = landsatCollection(plot, start, end, v.band);
  const ccdc = ee.Algorithms.TemporalSegmentation.Ccdc({ collection, breakpointBands: [v.band] });
  const features = ts.chartPoint({ image: ccdc, point: plot, bandName: v.band, collection, scale: SCALE, returnFeatures: true });
  const tBreak = ee.Array(
    ccdc.select("tBreak").reduceRegion({ reducer: ee.Reducer.first(), geometry: plot, scale: SCALE }).get("tBreak")
  ).toList();
  const [fc, breaks] = await Promise.all([evaluate(features), evaluate(tBreak)]);
  return { band: v.band, ...shapeCcdc(fc, breaks) };
}

module.exports = { ccdcSeries, validateCcdcRequest, landsatCollection };
