const { ee } = require("./auth");
const { SCENE_PROPS } = require("./landsat");
const { catalogue } = require("../lib/catalogue");

/**
 * Formula band name (catalogue.json "bands") to image band name. Landsat's prepared() calls SWIR1 "swir" (the
 * composite and scene code use it); Sentinel-2's rename keeps "red2" for B6 (rededge2).
 */
const LANDSAT_BANDS = { blue: "blue", green: "green", red: "red", nir: "nir", swir1: "swir", swir2: "swir2" };
const SENTINEL2_BANDS = {
  blue: "blue", green: "green", red: "red", nir: "nir", swir1: "swir1", swir2: "swir2",
  rededge1: "rededge1", rededge2: "red2", rededge3: "rededge3",
};

/**
 * One band "index" from `img` evaluated from `formula` (already checked by lib/formula.js) over the bands of
 * `bands`, keeping SCENE_PROPS. The bands are divided by `scale` once, so formulas see 0..1 reflectance
 * (Sentinel-2 L1C is 0..10000).
 */
function indexImage(img, formula, bands, scale = 1) {
  const names = Object.keys(bands);
  const reflectance = img.select(Object.values(bands), names).divide(scale);
  const map = Object.fromEntries(names.map((n) => [n, reflectance.select(n)]));
  return ee.Image(reflectance.expression(formula, map).rename("index").copyProperties(img, SCENE_PROPS));
}

/** The formula of a named index of the catalogue; throws for an unknown name. */
function formulaOf(index) {
  if (!Object.hasOwn(catalogue.indices, index)) throw new Error(`unknown index ${index}`);
  return catalogue.indices[index];
}

module.exports = { indexImage, formulaOf, LANDSAT_BANDS, SENTINEL2_BANDS };
