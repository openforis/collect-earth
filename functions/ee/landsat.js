const { ee } = require("./auth");

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

module.exports = { clearMask, scaleSr, maskAndScale };
