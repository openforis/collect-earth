const { ee } = require("./auth");
const { landsatPeriods, COLLECTIONS, HARMONIZED } = require("../lib/landsatPeriods");
const { landsatClearMaskBits } = require("../lib/qaBits");

/** Properties carried through every mapped image so the series can date, identify and label it. */
const SCENE_PROPS = ["system:time_start", "system:index", "SPACECRAFT_ID"];

/** Every QA_PIXEL bit of the mask must be zero: see lib/qaBits.js for the Collection 2 bit layout. */
const CLEAR_MASK = landsatClearMaskBits();

/**
 * Port of maskLandsatSR with the Collection 2 QA_PIXEL bits: dilated cloud
 * (1), cloud (3), cloud shadow (4) and snow (5) must all be clear. charts_v2
 * tested bits 3 and 5 with Collection 1 meanings in mind, which in C2 masked
 * cloud and snow but let cloud shadow through; that is not reproduced.
 */
function clearMask(image) {
  return image.select("QA_PIXEL").bitwiseAnd(CLEAR_MASK).eq(0);
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
 * every sensor. The scaling is scaleSr's; the properties it copies are
 * narrowed to SCENE_PROPS at the end (select keeps them, the harmonisation
 * arithmetic drops them).
 */
function prepared(collectionId, plot, start, end, { mask, harmonize }) {
  return ee
    .ImageCollection(collectionId)
    .filterBounds(plot)
    .filterDate(start, end)
    .map((img) => {
      let sr = ee.Image(scaleSr(img));
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

/**
 * Sensors consulted when resolving a Landsat scene by system:time_start, in
 * chronological order. Every sensor, with no date window: a scene may come
 * from a series that applied landsatPeriods windows (L7 to 2015, L8 from
 * 2015, L9 from 2023-11) or from the CCDC collection (L7+L8+L9 over the whole
 * range, no windows), so a 2016 L7 or 2014 L8 observation must still resolve.
 * Pure, so the choice is unit-testable without Earth Engine.
 */
function landsatSceneSensors() {
  return ["L5", "L7", "L8", "L9"];
}

/** The Collection 2 Level 2 collection ids that landsatSceneCollection consults, in sensor order. */
function landsatSceneCollectionIds() {
  return landsatSceneSensors().map((sensor) => COLLECTIONS[sensor]);
}

/**
 * The unmasked, scaled (harmonised per HARMONIZED) scenes with exactly this
 * system:time_start over the plot, from every Landsat sensor. The 1 ms date
 * window of prepared() lets Earth Engine prune by the collection's date index
 * before the exact-match filter runs, as in sentinel2SceneCollection. Empty
 * when there is no such scene, so callers can evaluate size() and answer 404.
 */
function landsatSceneCollection(plot, timeStart) {
  const parts = landsatSceneSensors().map((sensor) =>
    prepared(COLLECTIONS[sensor], plot, timeStart, timeStart + 1, { mask: false, harmonize: HARMONIZED[sensor] })
  );
  return parts.slice(1).reduce((acc, c) => acc.merge(c), parts[0]).filter(ee.Filter.equals("system:time_start", timeStart));
}

/** NDVI from the nir/red bands, keeping the scene's date, index and sensor. */
function ndvi(img) {
  return ee.Image(img.normalizedDifference(["nir", "red"]).rename("NDVI").copyProperties(img, SCENE_PROPS));
}

module.exports = {
  clearMask, scaleSr, maskAndScale, harmonizeOli, prepared, mergedLandsat, ndvi, SCENE_PROPS,
  landsatSceneSensors, landsatSceneCollectionIds, landsatSceneCollection,
};
