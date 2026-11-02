const { ee } = require("./auth");
const { landsatPeriods, COLLECTIONS, HARMONIZED } = require("../lib/landsatPeriods");

/** Properties carried through every mapped image so the series can date, identify and label it. */
const SCENE_PROPS = ["system:time_start", "system:index", "SPACECRAFT_ID"];

/** Port of maskLandsatSR: QA_PIXEL bits 3 (cloud shadow) and 5 (cloud) must both be clear. */
function clearMask(image) {
  const qa = image.select("QA_PIXEL");
  return qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 5).eq(0));
}

/** Port of applyScaleFactors: Collection 2 Level 2 surface reflectance scaling of the SR_B* bands. */
function scaleSr(image) {
  return image.select("SR_B.").multiply(0.0000275).add(-0.2).copyProperties(image, image.propertyNames());
}

/**
 * Cloud-masked, scaled surface reflectance. copyProperties returns an ee.Element,
 * so the result is wrapped as ee.Image for ImageCollection.map/select to accept it.
 */
function maskAndScale(image) {
  return ee.Image(scaleSr(image.updateMask(clearMask(image))));
}

/**
 * Roy et al. 2016 RMA coefficients, OLI (Landsat 8/9) to ETM+ (Landsat 7).
 * Expects scaled surface reflectance (0..1): the coefficients were fitted on
 * reflectance, so callers scale first and harmonise second. charts_v2's
 * harmonizationRoy ran on the raw integer DNs before scaling; that order is a
 * fidelity bug there and is not reproduced here. Output bands carry L7 names.
 */
function harmonizeOli(oli) {
  const slopes = ee.Image.constant([0.9785, 0.9542, 0.9825, 1.0073, 1.0171, 0.9949]);
  const itcp = ee.Image.constant([-0.0095, -0.0016, -0.0022, -0.0021, -0.0030, 0.0029]);
  return oli
    .select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"], ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"])
    .subtract(itcp)
    .divide(slopes);
}

/**
 * One sensor's scenes over `plot` in [start, end) as scaled (optionally
 * harmonised, optionally cloud-masked) nir/swir/red images. After harmonizeOli
 * the OLI bands carry L7 names, so the same SR_B4/SR_B5/SR_B3 selection serves
 * every sensor.
 */
function prepared(collectionId, plot, start, end, { mask, harmonize }) {
  return ee
    .ImageCollection(collectionId)
    .filterBounds(plot)
    .filterDate(start, end)
    .map((img) => {
      let sr = img.select("SR_B.").multiply(0.0000275).add(-0.2);
      if (harmonize) sr = harmonizeOli(sr);
      let out = sr.select(["SR_B4", "SR_B5", "SR_B3"], ["nir", "swir", "red"]);
      if (mask) out = out.updateMask(clearMask(img));
      return ee.Image(out.copyProperties(img, SCENE_PROPS));
    });
}

/**
 * Landsat 5/7/8/9 scenes over the plot for [start, end), one window per sensor
 * as decided by landsatPeriods (port of charts_v2 getMergedLandsat).
 */
function mergedLandsat(plot, start, end, mask) {
  const parts = landsatPeriods(start, end).map((p) =>
    prepared(COLLECTIONS[p.sensor], plot, p.start, p.end, { mask, harmonize: HARMONIZED[p.sensor] })
  );
  if (parts.length === 0) return ee.ImageCollection([]);
  return parts.slice(1).reduce((acc, c) => acc.merge(c), parts[0]);
}

/** NDVI from the nir/red bands, keeping the scene's date, index and sensor. */
function ndvi(img) {
  return ee.Image(img.normalizedDifference(["nir", "red"]).rename("NDVI").copyProperties(img, SCENE_PROPS));
}

module.exports = { clearMask, scaleSr, maskAndScale, harmonizeOli, prepared, mergedLandsat, ndvi, SCENE_PROPS };
