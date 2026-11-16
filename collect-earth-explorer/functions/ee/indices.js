const { ee } = require("./auth");
const { SCENE_PROPS } = require("./landsat");

/** Band names per role: Landsat's prepared() calls swir1 "swir", Sentinel-2's rename keeps its own names. */
const LANDSAT_NAMES = { nir: "nir", red: "red", swir1: "swir", swir2: "swir2", blue: "blue" };
const SENTINEL2_NAMES = { nir: "nir", red: "red", swir1: "swir1", swir2: "swir2", blue: "blue" };

/**
 * One band named `index` (NDVI, NDMI, NBR or EVI) from `img`, keeping SCENE_PROPS. `names` maps the roles
 * to band names. `scale` turns the reflectance into 0..1 for EVI, whose constants assume it (Sentinel-2 L1C
 * is 0..10000); the normalised differences do not depend on it.
 */
function indexImage(img, index, names, scale = 1) {
  const nd = (a, b) => img.normalizedDifference([names[a], names[b]]);
  const band = (role) => img.select(names[role]).multiply(1 / scale);
  let out;
  if (index === "NDVI") out = nd("nir", "red");
  else if (index === "NDMI") out = nd("nir", "swir1");
  else if (index === "NBR") out = nd("nir", "swir2");
  else if (index === "EVI") out = img.expression("2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)", { nir: band("nir"), red: band("red"), blue: band("blue") });
  else throw new Error(`unknown index ${index}`);
  return ee.Image(out.rename(index).copyProperties(img, SCENE_PROPS));
}

module.exports = { indexImage, LANDSAT_NAMES, SENTINEL2_NAMES };
