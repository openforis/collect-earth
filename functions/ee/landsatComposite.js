const { ee } = require("./auth");
const { getTileUrl, evaluate } = require("./promise");
const { SENSORS, sensorsForYear } = require("../lib/sensors");
const { notFoundIfEmpty } = require("../lib/errors");
const { maskAndScale } = require("./landsat");

/** Scenes with more cloud over land than this (percent) are dropped before compositing. */
const MAX_CLOUD_COVER = 50;
const COMPOSITE_BANDS = ["nir", "swir", "red"];
/**
 * False-colour stretch shared by the yearly composite and single scenes. The
 * gamma comes from the GEE app's scene view (its composite had none); one set
 * of parameters keeps a scene and the composite it came from comparable.
 */
const LANDSAT_VIZ = { bands: COMPOSITE_BANDS, min: 0, max: 0.3, gamma: [1.3, 1.3, 1.3] };

/** One sensor's masked, scaled scenes over `plot` in `year`, with bands renamed to nir/swir/red. */
function sensorImages(id, plot, year) {
  const s = SENSORS[id];
  return ee.ImageCollection(s.collection)
    .filterBounds(plot)
    .filterDate(`${year}-01-01`, `${year + 1}-01-01`)
    .filter(ee.Filter.lt(s.cloudProperty, MAX_CLOUD_COVER))
    .map(maskAndScale)
    .select(s.falseColour, COMPOSITE_BANDS);
}

/**
 * Median of every sensor flying in `year` (port of getImageForCollection's default branch).
 * Returns the unvisualised image, the merged collection it reduces and the
 * sensor names so callers and tests can inspect them.
 */
function buildYearlyComposite(plot, year) {
  const ids = sensorsForYear(year);
  const cols = ids.map((id) => sensorImages(id, plot, year));
  const merged = cols.slice(1).reduce((acc, c) => acc.merge(c), cols[0]);
  return { image: merged.median(), collection: merged, sensorNames: ids.map((id) => SENSORS[id].name) };
}

/** Tile URL for the false-colour yearly Landsat composite; 404 not_found when the year has no scene over the plot. */
async function landsatCompositeTiles(plot, year) {
  const { image, collection, sensorNames } = buildYearlyComposite(plot, year);
  notFoundIfEmpty(await evaluate(collection.size()), `no Landsat scenes for ${year}`);
  const tileUrl = await getTileUrl(image.visualize(LANDSAT_VIZ));
  return { tileUrl, sensor: sensorNames.join(" + "), label: `${sensorNames.join("/")} ${year} composite` };
}

module.exports = { landsatCompositeTiles, buildYearlyComposite, sensorImages, LANDSAT_VIZ, MAX_CLOUD_COVER };
